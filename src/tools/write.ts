import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentTool } from "./base.ts";

export const WriteFileSchema = z.object({
  path: z.string().describe("Relative path to the file to create or overwrite"),
  content: z.string().describe("Complete file content to write"),
  overwrite: z.boolean().optional().describe("Whether to overwrite if file already exists (default: true)"),
});

export const writeFileTool: AgentTool<typeof WriteFileSchema> = {
  name: "write_file",
  description: "Create a new file or write complete content to a file. Auto-creates parent directories.",
  schema: WriteFileSchema,
  execute: async (args, ctx) => {
    const fullPath = ctx.sandbox.resolvePath(args.path);
    const overwrite = args.overwrite ?? true;

    try {
      const exists = await fs
        .access(fullPath)
        .then(() => true)
        .catch(() => false);

      if (exists && !overwrite) {
        return `File '${args.path}' already exists and overwrite is set to false.`;
      }

      await ctx.rollback.snapshot(args.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, args.content, "utf-8");

      return `Successfully wrote ${Buffer.byteLength(args.content, "utf-8")} bytes to '${args.path}'.`;
    } catch (err: unknown) {
      return `Error writing file '${args.path}': ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
