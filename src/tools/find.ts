import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentTool } from "./base.ts";

export const FileSearchSchema = z.object({
  query: z.string().describe("Filename pattern or keyword to search for"),
  path: z.string().optional().describe("Directory to search in (default: '.')"),
  max_results: z.number().int().positive().optional().describe("Maximum results to return (default: 25)"),
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

export const fileSearchTool: AgentTool<typeof FileSearchSchema> = {
  name: "file_search",
  description: "Search for files by name or pattern within the repository.",
  schema: FileSearchSchema,
  execute: async (args, ctx) => {
    const targetRel = args.path || ".";
    const fullPath = ctx.sandbox.resolvePath(targetRel);
    const maxResults = args.max_results ?? 25;
    const queryLower = args.query.toLowerCase();

    const matches: string[] = [];

    async function searchDir(dir: string, relPrefix: string): Promise<void> {
      if (matches.length >= maxResults) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (IGNORED_NAMES.has(entry.name)) continue;

        const relItem = path.join(relPrefix, entry.name);
        if (entry.name.toLowerCase().includes(queryLower)) {
          matches.push(entry.isDirectory() ? `${relItem}/` : relItem);
          if (matches.length >= maxResults) return;
        }

        if (entry.isDirectory()) {
          await searchDir(path.join(dir, entry.name), relItem);
        }
      }
    }

    await searchDir(fullPath, "");

    if (matches.length === 0) {
      return `No files found matching '${args.query}' in '${targetRel}'.`;
    }

    return `Found ${matches.length} matches for '${args.query}':\n${matches.join("\n")}`;
  },
};
