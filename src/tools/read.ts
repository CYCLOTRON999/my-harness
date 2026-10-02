import fs from "node:fs/promises";
import { z } from "zod";
import type { AgentTool } from "./base.ts";

export const ReadFileSchema = z.object({
  path: z.string().describe("Relative path to the file within the repository"),
  start_line: z.number().int().positive().optional().describe("Starting line number (1-indexed, default: 1)"),
  end_line: z.number().int().positive().optional().describe("Ending line number (inclusive, default: start + 100)"),
});

export const readFileTool: AgentTool<typeof ReadFileSchema> = {
  name: "read_file",
  description: "Read file contents with line numbers. Use line ranges for large files to conserve tokens.",
  schema: ReadFileSchema,
  execute: async (args, ctx) => {
    const fullPath = ctx.sandbox.resolvePath(args.path);
    const content = await fs.readFile(fullPath, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    const start = Math.max(1, args.start_line ?? 1);
    const end = Math.min(totalLines, args.end_line ?? start + 100);

    if (start > totalLines) {
      return `File '${args.path}' only has ${totalLines} lines. Requested start_line ${start} is out of bounds.`;
    }

    const sliced = lines.slice(start - 1, end);
    const numbered = sliced.map((line, idx) => `${start + idx}: ${line}`).join("\n");

    let summary = `Showing lines ${start}-${end} of ${totalLines} in '${args.path}':\n\n${numbered}`;
    if (end < totalLines && args.end_line === undefined) {
      summary += `\n\n[Note: ${totalLines - end} lines remaining. Specify start_line=${end + 1} to view more if needed.]`;
    }

    return summary;
  },
};
