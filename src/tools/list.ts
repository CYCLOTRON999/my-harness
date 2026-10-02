import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentTool } from "./base.ts";

export const ListDirSchema = z.object({
  path: z.string().optional().describe("Directory path relative to repository root (default: '.')"),
  recursive: z.boolean().optional().describe("Whether to list recursively (default: false)"),
  max_depth: z.number().int().positive().optional().describe("Maximum recursion depth (default: 2)"),
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

export const listDirTool: AgentTool<typeof ListDirSchema> = {
  name: "list_dir",
  description: "List directory contents with file/folder classification. Bounded to prevent token bloat.",
  schema: ListDirSchema,
  execute: async (args, ctx) => {
    const targetRel = args.path || ".";
    const fullPath = ctx.sandbox.resolvePath(targetRel);
    const maxDepth = args.max_depth ?? 2;
    const recursive = args.recursive ?? false;

    const entries: string[] = [];

    async function scan(currentDir: string, currentDepth: number, prefix: string): Promise<void> {
      if (currentDepth > maxDepth) return;
      const items = await fs.readdir(currentDir, { withFileTypes: true });

      for (const item of items) {
        if (IGNORED_NAMES.has(item.name)) continue;

        const relItem = path.join(prefix, item.name);
        if (item.isDirectory()) {
          entries.push(`[dir]  ${relItem}/`);
          if (recursive && currentDepth < maxDepth) {
            await scan(path.join(currentDir, item.name), currentDepth + 1, relItem);
          }
        } else {
          entries.push(`[file] ${relItem}`);
        }
      }
    }

    try {
      await scan(fullPath, 1, "");
      if (entries.length === 0) {
        return `Directory '${targetRel}' is empty.`;
      }
      return `Contents of '${targetRel}':\n${entries.slice(0, 100).join("\n")}${
        entries.length > 100 ? `\n[... truncated ${entries.length - 100} items ...]` : ""
      }`;
    } catch (err: unknown) {
      return `Error listing directory '${targetRel}': ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
