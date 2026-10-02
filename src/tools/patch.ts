import fs from "node:fs/promises";
import { z } from "zod";
import type { AgentTool } from "./base.ts";
import { applyTargetedPatch } from "../patch/diff-engine.ts";

export const ApplyPatchSchema = z.object({
  path: z.string().describe("Relative path to the file to modify"),
  search_block: z.string().describe("Exact chunk of existing code to find and replace"),
  replace_block: z.string().describe("Replacement code chunk"),
});

export const applyPatchTool: AgentTool<typeof ApplyPatchSchema> = {
  name: "apply_patch",
  description: "Apply a targeted edit by finding an exact unique code block and replacing it. Automatically backs up file for rollback.",
  schema: ApplyPatchSchema,
  execute: async (args, ctx) => {
    const fullPath = ctx.sandbox.resolvePath(args.path);
    let content: string;
    try {
      content = await fs.readFile(fullPath, "utf-8");
    } catch {
      return `Error: File '${args.path}' does not exist. Use 'write_file' to create new files.`;
    }

    const res = applyTargetedPatch(content, args.search_block, args.replace_block);

    if (!res.success || !res.patchedContent) {
      return `Patch failed: ${res.error}`;
    }

    // Snapshot pre-modification content for single-command rollback
    await ctx.rollback.snapshot(args.path);

    await fs.writeFile(fullPath, res.patchedContent, "utf-8");

    const fuzzyMsg = res.fuzzyMatchUsed ? " (applied via fuzzy whitespace/quote normalization)" : "";
    return `Successfully patched '${args.path}'${fuzzyMsg}.`;
  },
};
