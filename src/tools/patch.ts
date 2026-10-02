import fs from "node:fs/promises";
import { z } from "zod";
import type { AgentTool } from "./base.ts";

export const ApplyPatchSchema = z.object({
  path: z.string().describe("Relative path to the file to modify"),
  search_block: z.string().describe("Exact chunk of existing code to find and replace"),
  replace_block: z.string().describe("Replacement code chunk"),
});

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

export const applyPatchTool: AgentTool<typeof ApplyPatchSchema> = {
  name: "apply_patch",
  description: "Apply a targeted edit by finding an exact unique code block and replacing it. Fails if search_block is not found or matches multiple places.",
  schema: ApplyPatchSchema,
  execute: async (args, ctx) => {
    const fullPath = ctx.sandbox.resolvePath(args.path);
    const content = await fs.readFile(fullPath, "utf-8");

    const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const normalizedSearch = args.search_block.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const normalizedReplace = args.replace_block.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    let matchIdx = normalizedContent.indexOf(normalizedSearch);

    if (matchIdx === -1) {
      const fuzzyContent = normalizeText(normalizedContent);
      const fuzzySearch = normalizeText(normalizedSearch);
      const fuzzyIdx = fuzzyContent.indexOf(fuzzySearch);

      if (fuzzyIdx === -1) {
        return `Error: search_block not found in '${args.path}'. Please use 'read_file' to check the current file contents and line context before patching.`;
      }

      const count = fuzzyContent.split(fuzzySearch).length - 1;
      if (count > 1) {
        return `Error: search_block matches ${count} locations in '${args.path}'. Include more surrounding lines to make the match unique.`;
      }

      const searchLines = fuzzySearch.split("\n");
      const contentLines = normalizedContent.split("\n");
      let matchedStartLine = -1;

      for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
        let match = true;
        for (let j = 0; j < searchLines.length; j++) {
          if (contentLines[i + j].trimEnd() !== searchLines[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          matchedStartLine = i;
          break;
        }
      }

      if (matchedStartLine === -1) {
        return `Error: Unable to cleanly locate fuzzy match in '${args.path}'.`;
      }

      const before = contentLines.slice(0, matchedStartLine);
      const after = contentLines.slice(matchedStartLine + searchLines.length);
      const newLines = [...before, ...normalizedReplace.split("\n"), ...after];
      const updated = newLines.join("\n");
      await fs.writeFile(fullPath, updated, "utf-8");
      return `Successfully patched '${args.path}' (fuzzy whitespace match applied).`;
    }

    const count = normalizedContent.split(normalizedSearch).length - 1;
    if (count > 1) {
      return `Error: search_block matches ${count} locations in '${args.path}'. Include more surrounding lines to make the match unique.`;
    }

    const updated = normalizedContent.replace(normalizedSearch, normalizedReplace);
    await fs.writeFile(fullPath, updated, "utf-8");
    return `Successfully patched '${args.path}'.`;
  },
};
