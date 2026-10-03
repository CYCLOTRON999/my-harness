import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentTool } from "./base.ts";

export const GrepSearchSchema = z.object({
  query: z.string().describe("Exact string or regex pattern to search for in files"),
  path: z.string().optional().describe("Directory or file to search in (default: '.')"),
  is_regex: z.boolean().optional().describe("Whether query is a regex pattern (default: false)"),
  max_results: z.number().int().positive().optional().describe("Maximum matching lines (default: 100)"),
});

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".pnpm-store",
  ".DS_Store",
  "coverage",
]);

export const grepSearchTool: AgentTool<typeof GrepSearchSchema> = {
  name: "grep_search",
  description: "Search for text or regex patterns within file contents. Returns file, line number, and matching content.",
  schema: GrepSearchSchema,
  execute: async (args, ctx) => {
    const targetRel = args.path || ".";
    const fullPath = ctx.sandbox.resolvePath(targetRel);
    const maxResults = args.max_results ?? 100;

    let regex: RegExp;
    try {
      regex = args.is_regex ? new RegExp(args.query, "i") : new RegExp(buildSearchPattern(args.query), "i");
    } catch (err: unknown) {
      return `Invalid regular expression '${args.query}': ${err instanceof Error ? err.message : String(err)}`;
    }

    const matches: string[] = [];
    let totalMatchCount = 0;

    async function grepFile(filePath: string, relPath: string): Promise<void> {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            totalMatchCount++;
            if (matches.length < maxResults) {
              matches.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
            }
          }
        }
      } catch {
        // Skip binary or unreadable files
      }
    }

    async function walk(currentPath: string, relPrefix: string): Promise<void> {
      if (totalMatchCount >= 5000) return;
      let stat;
      try {
        stat = await fs.stat(currentPath);
      } catch {
        return;
      }

      if (!stat.isDirectory()) {
        await grepFile(currentPath, relPrefix || path.basename(currentPath));
        return;
      }

      let entries;
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (IGNORED_NAMES.has(entry.name)) continue;

        const nextFull = path.join(currentPath, entry.name);
        const nextRel = path.join(relPrefix, entry.name);

        if (entry.isDirectory()) {
          await walk(nextFull, nextRel);
        } else {
          await grepFile(nextFull, nextRel);
        }
      }
    }

    await walk(fullPath, targetRel === "." ? "" : targetRel);

    if (totalMatchCount === 0) {
      return `No matches found for '${args.query}' in '${targetRel}'.`;
    }

    if (totalMatchCount > matches.length) {
      return `Found ${totalMatchCount} matching lines (showing first ${matches.length}):\n${matches.join("\n")}`;
    }

    return `Found ${matches.length} matching lines:\n${matches.join("\n")}`;
  },
};

function buildSearchPattern(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return escapeRegex(query);

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return escapeRegex(query);

  const escapedTokens = tokens.map(escapeRegex);
  let pattern = escapedTokens.join("\\s+");
  // Allow optional whitespace around commas: "1, Lewis" or "1,Lewis" matches "1,Lewis" or "1,  Lewis"
  pattern = pattern.replace(/,\\s\+/g, ",").replace(/,/g, ",\\s*");
  return pattern;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
