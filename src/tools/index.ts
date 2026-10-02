import { readFileTool } from "./read.ts";
import { applyPatchTool } from "./patch.ts";
import { runCommandTool } from "./command.ts";
import { listDirTool } from "./list.ts";
import { fileSearchTool } from "./find.ts";
import { grepSearchTool } from "./grep.ts";
import { writeFileTool } from "./write.ts";
import { gitStatusTool, gitDiffTool, gitRestoreTool } from "./git.ts";
import type { AnyAgentTool } from "./base.ts";

export * from "./base.ts";
export * from "./read.ts";
export * from "./patch.ts";
export * from "./command.ts";
export * from "./list.ts";
export * from "./find.ts";
export * from "./grep.ts";
export * from "./write.ts";
export * from "./git.ts";

export const allTools: AnyAgentTool[] = [
  readFileTool,
  applyPatchTool,
  runCommandTool,
  listDirTool,
  fileSearchTool,
  grepSearchTool,
  writeFileTool,
  gitStatusTool,
  gitDiffTool,
  gitRestoreTool,
];
