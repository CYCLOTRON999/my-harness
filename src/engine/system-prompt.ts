/**
 * System prompt construction and project context loading for the agent harness.
 * Matches the system prompt structure of packages/coding-agent (pi-agent).
 */

import path from "node:path";
import fs from "node:fs";

export interface BuildSystemPromptOptions {
  /** Custom system prompt (replaces default preamble). */
  customPrompt?: string;
  /** Exact full prompt replacement. */
  forceSystemPrompt?: string;
  /** Tools to include in prompt. */
  selectedTools?: string[];
  /** Optional one-line tool snippets keyed by tool name. */
  toolSnippets?: Record<string, string>;
  /** Guideline bullets contributed by each tool, keyed by tool name. */
  toolGuidelines?: Record<string, string[]>;
  /** Additional guideline bullets appended to the default system prompt rules. */
  promptGuidelines?: string[];
  /** Text appended before project context and cwd. */
  appendSystemPrompt?: string;
  /** Additional XML-wrapped prompt sections keyed by tag name. */
  sections?: Record<string, string>;
  /** Working directory. */
  cwd: string;
  /** Pre-loaded context files (e.g. AGENTS.md or CLAUDE.md). */
  contextFiles?: Array<{ path: string; content: string }>;
}

export type SystemPromptSections = Record<string, string>;

export const DEFAULT_TOOL_SNIPPETS: Record<string, string> = {
  read: "Read file contents",
  read_file: "Read file contents with line ranges",
  bash: "Execute bash commands (ls, grep, find, etc.)",
  run_command: "Execute shell commands (ls, git, tests, build) inside the repo",
  edit: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
  apply_patch: "Targeted search-and-replace for specific code blocks",
  write: "Create or overwrite files",
  write_file: "Create or overwrite files",
  grep: "Search file contents for patterns (respects .gitignore)",
  grep_search: "Search file contents for regex or text across files",
  find: "Find files by glob pattern (respects .gitignore)",
  file_search: "Find files matching a name or pattern",
  ls: "List directory contents",
  list_dir: "List files and directories with depth control",
  git_status: "View modified and untracked files",
  git_diff: "View working tree changes",
  git_restore: "Revert uncommitted changes if an edit breaks tests",
};

export const DEFAULT_TOOL_GUIDELINES: Record<string, string[]> = {
  read: ["Use read to examine files instead of cat or sed."],
  read_file: ["Use read_file to examine files before editing."],
  bash: ["Use bash for file operations like ls, rg, find."],
  run_command: ["Use run_command to execute commands, tests, or build commands inside the repo."],
  edit: [
    "Use edit for precise changes (edits[].oldText must match exactly)",
    "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
  ],
  apply_patch: [
    "Use apply_patch for precise changes (search_block must match exact lines in the file).",
  ],
  write: ["Use write only for new files or complete rewrites."],
  write_file: ["Use write_file only for new files or complete rewrites."],
  grep: ["Use grep to search file contents."],
  grep_search: ["Use grep_search to find symbols or text patterns across files."],
  find: ["Use find to locate files by glob pattern."],
  file_search: ["Use file_search to locate files matching a name or pattern."],
  ls: ["Use ls to list directory contents."],
  list_dir: ["Use list_dir to inspect directory structure."],
};

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
  "Be concise in your responses",
  "Show file paths clearly when working with files",
  "If the user's message is a greeting (e.g. 'hi', 'hello', 'hey bro'), acknowledgment, or casual statement, reply directly to the user without calling any tools.",
  "If the user asks a general question, world knowledge, or conversational question that does not require inspecting files in the repository, answer directly and concisely without calling any repository tools.",
  "For queries, questions, audits, counts, or analysis, your final response MUST directly answer the user's question with specific numbers, names, and findings.",
  "Never execute long-running or interactive server processes via run_command/bash, as they do not exit.",
];

export function renderProjectContext(contextFiles: Array<{ path: string; content: string }>): string {
  return [
    "Project-specific instructions and guidelines:",
    ...contextFiles.map(
      ({ path: filePath, content }) => `<project_instructions path="${filePath}">\n${content}\n</project_instructions>`,
    ),
  ].join("\n\n");
}

export function buildRules(
  selectedTools: string[],
  toolGuidelines: Record<string, string[]>,
  promptGuidelines: string[],
): string {
  const rules: string[] = [];
  const seen = new Set<string>();
  const addRule = (rule: string): void => {
    const normalized = rule.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    rules.push(normalized);
  };

  const hasBash = selectedTools.includes("bash") || selectedTools.includes("run_command");
  const hasGrep = selectedTools.includes("grep") || selectedTools.includes("grep_search");
  const hasFind = selectedTools.includes("find") || selectedTools.includes("file_search");
  const hasLs = selectedTools.includes("ls") || selectedTools.includes("list_dir");

  if (hasBash && !hasGrep && !hasFind && !hasLs) {
    addRule("Use bash for file operations like ls, rg, find");
  }

  for (const name of selectedTools) {
    for (const rule of toolGuidelines[name] ?? []) {
      addRule(rule);
    }
  }

  for (const rule of promptGuidelines) {
    addRule(rule);
  }

  addRule("Be concise in your responses");
  addRule("Show file paths clearly when working with files");

  return rules.map((rule) => `- ${rule}`).join("\n");
}

export function loadProjectContextFiles(cwd: string): Array<{ path: string; content: string }> {
  const contextFiles: Array<{ path: string; content: string }> = [];
  const seenPaths = new Set<string>();

  let currentDir = path.resolve(cwd);
  const candidates = ["AGENTS.md", "CLAUDE.md"];

  while (true) {
    for (const candidate of candidates) {
      const filePath = path.join(currentDir, candidate);
      if (fs.existsSync(filePath) && !seenPaths.has(filePath)) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          contextFiles.unshift({ path: filePath, content });
          seenPaths.add(filePath);
          break; // Prefer AGENTS.md over CLAUDE.md in same directory
        } catch {
          // ignore unreadable files
        }
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return contextFiles;
}

export function buildSystemPromptSections(input: BuildSystemPromptOptions): SystemPromptSections {
  const customPrompt = input.customPrompt;
  const selectedTools = input.selectedTools ?? [
    "read_file",
    "apply_patch",
    "run_command",
    "write_file",
    "list_dir",
    "file_search",
    "grep_search",
    "git_status",
    "git_diff",
    "git_restore",
  ];
  const toolSnippets = { ...DEFAULT_TOOL_SNIPPETS, ...(input.toolSnippets ?? {}) };
  const toolGuidelines = { ...DEFAULT_TOOL_GUIDELINES, ...(input.toolGuidelines ?? {}) };
  const promptGuidelines = [...DEFAULT_PROMPT_GUIDELINES, ...(input.promptGuidelines ?? [])];
  const customSections = input.sections ?? {};
  const cwd = input.cwd;
  const contextFiles = input.contextFiles ?? [];

  const promptSections: Record<string, string> = {};

  if (customPrompt) {
    promptSections.preamble = customPrompt;
  } else {
    promptSections.preamble =
      "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

    const visibleTools = selectedTools.filter((name) => !!toolSnippets[name]);
    const tools =
      visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n") : "(none)";
    promptSections.tools = `${tools}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`;
    promptSections.rules = buildRules(selectedTools, toolGuidelines, promptGuidelines);
  }

  if (input.appendSystemPrompt) {
    promptSections.addendum = input.appendSystemPrompt;
  }

  if (contextFiles.length > 0) {
    promptSections.project_context = renderProjectContext(contextFiles);
  }

  promptSections.cwd = cwd.replace(/\\/g, "/");

  for (const [name, content] of Object.entries(customSections)) {
    if (content) {
      promptSections[name] = content;
    }
  }

  const sections: SystemPromptSections = { preamble: promptSections.preamble };
  for (const [name, content] of Object.entries(promptSections)) {
    if (name !== "preamble") {
      sections[name] = `<${name}>\n${content}\n</${name}>`;
    }
  }

  return sections;
}

export function buildSystemPrompt(input: BuildSystemPromptOptions): string {
  if (input.forceSystemPrompt !== undefined) {
    return input.forceSystemPrompt;
  }

  const sections = buildSystemPromptSections(input);
  const parts: string[] = [sections.preamble];

  for (const [name, text] of Object.entries(sections)) {
    if (name !== "preamble" && text) {
      parts.push(text);
    }
  }

  return parts.filter((part) => part.length > 0).join("\n\n");
}
