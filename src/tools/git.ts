import { z } from "zod";
import type { AgentTool } from "./base.ts";

export const GitStatusSchema = z.object({});

export const gitStatusTool: AgentTool<typeof GitStatusSchema> = {
  name: "git_status",
  description: "Check working directory status: modified, untracked, and staged files.",
  schema: GitStatusSchema,
  execute: async (_args, ctx) => {
    const res = await ctx.executor.execute("git status --short");
    return res.outputSummary;
  },
};

export const GitDiffSchema = z.object({
  path: z.string().optional().describe("Optional specific file path to inspect diff for"),
});

export const gitDiffTool: AgentTool<typeof GitDiffSchema> = {
  name: "git_diff",
  description: "Inspect unstaged and staged Git diffs in the repository or for a specific file.",
  schema: GitDiffSchema,
  execute: async (args, ctx) => {
    const cmd = args.path ? `git diff ${args.path}` : "git diff";
    const res = await ctx.executor.execute(cmd);
    return res.outputSummary;
  },
};

export const GitRestoreSchema = z.object({
  path: z.string().describe("Relative file path to restore/revert to clean Git state"),
});

export const gitRestoreTool: AgentTool<typeof GitRestoreSchema> = {
  name: "git_restore",
  description: "Revert uncommitted modifications to a file, restoring it to the last clean Git commit.",
  schema: GitRestoreSchema,
  execute: async (args, ctx) => {
    ctx.sandbox.resolvePath(args.path);
    const res = await ctx.executor.execute(`git checkout -- "${args.path}" || git restore "${args.path}"`);
    if (res.exitCode === 0) {
      return `Successfully restored '${args.path}' to clean Git state.`;
    }
    return `Failed to restore '${args.path}':\n${res.outputSummary}`;
  },
};
