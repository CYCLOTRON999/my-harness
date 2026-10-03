import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildSystemPromptSections,
  buildRules,
  renderProjectContext,
  loadProjectContextFiles,
} from "../src/engine/system-prompt.ts";
import { normalizeToolCall } from "../src/engine/agent-loop.ts";

describe("System Prompt Construction (Pi-Agent Style)", () => {
  it("should generate the default preamble matching pi-agent", () => {
    const sections = buildSystemPromptSections({
      cwd: "/repo",
      selectedTools: ["read_file", "apply_patch"],
    });

    expect(sections.preamble.startsWith("You are an expert coding assistant operating inside pi")).toBe(true);
    expect(sections.tools).toContain("<tools>");
    expect(sections.tools).toContain("- read_file:");
    expect(sections.tools).toContain("- apply_patch:");
    expect(sections.rules).toContain("<rules>");
    expect(sections.cwd).toBe("<cwd>\n/repo\n</cwd>");

    const prompt = buildSystemPrompt({
      cwd: "/repo",
      selectedTools: ["read_file", "apply_patch"],
    });

    expect(prompt.startsWith("You are an expert coding assistant operating inside pi, a coding agent harness.")).toBe(true);
    expect(prompt).toContain("<tools>");
    expect(prompt).toContain("- read_file:");
    expect(prompt).toContain("- apply_patch:");
    expect(prompt).toContain("<rules>");
    expect(prompt).toContain("<cwd>\n/repo\n</cwd>");
  });

  it("should discover AGENTS.md or CLAUDE.md context files", () => {
    const files = loadProjectContextFiles(process.cwd());
    expect(Array.isArray(files)).toBe(true);
  });

  it("should allow custom prompt preamble while preserving sections", () => {
    const prompt = buildSystemPrompt({
      cwd: "/workspace",
      customPrompt: "You are CodeForge Agent.",
      selectedTools: ["run_command"],
    });

    expect(prompt.startsWith("You are CodeForge Agent.")).toBe(true);
    expect(prompt).not.toContain("<tools>");
    expect(prompt).toContain("<cwd>\n/workspace\n</cwd>");
  });

  it("should preserve exact forced prompt without sections", () => {
    const prompt = buildSystemPrompt({
      cwd: "/repo",
      forceSystemPrompt: "EXACT_PROMPT_STRING",
    });

    expect(prompt).toBe("EXACT_PROMPT_STRING");
  });

  it("should render project context files with project_instructions tags", () => {
    const rendered = renderProjectContext([
      { path: "/repo/AGENTS.md", content: "# AGENTS rules" },
      { path: "/repo/CLAUDE.md", content: "# Claude rules" },
    ]);

    expect(rendered).toContain("Project-specific instructions and guidelines:");
    expect(rendered).toContain('<project_instructions path="/repo/AGENTS.md">\n# AGENTS rules\n</project_instructions>');
    expect(rendered).toContain('<project_instructions path="/repo/CLAUDE.md">\n# Claude rules\n</project_instructions>');
  });

  it("should assemble project context and append sections into the prompt", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test/dir",
      contextFiles: [{ path: "AGENTS.md", content: "Rule 1" }],
      appendSystemPrompt: "Verification test command: 'npm test'",
      selectedTools: ["read_file", "run_command"],
    });

    expect(prompt).toContain("<project_context>");
    expect(prompt).toContain('<project_instructions path="AGENTS.md">');
    expect(prompt).toContain("<addendum>\nVerification test command: 'npm test'\n</addendum>");
    expect(prompt).toContain("<cwd>\n/test/dir\n</cwd>");
  });

  it("should build deduplicated rules and include shell guidance when bash is sole file finder", () => {
    const rules = buildRules(["bash"], {}, ["Custom rule 1", "Custom rule 1"]);

    expect(rules).toContain("- Use bash for file operations like ls, rg, find");
    expect(rules).toContain("- Custom rule 1");
    expect(rules).toContain("- Be concise in your responses");
    expect(rules).toContain("- Show file paths clearly when working with files");
  });

  it("normalizeToolCall should adapt pi-agent tool names and signatures to harness tools", () => {
    // 1. read -> read_file
    const readCall = normalizeToolCall({
      name: "read",
      arguments: { path: "app.py", offset: 10, limit: 20 },
    });
    expect(readCall.name).toBe("read_file");
    expect(readCall.arguments.path).toBe("app.py");
    expect(readCall.arguments.start_line).toBe(10);
    expect(readCall.arguments.end_line).toBe(29);

    // 2. bash -> run_command
    const bashCall = normalizeToolCall({
      name: "bash",
      arguments: { command: "npm test", timeout: 15 },
    });
    expect(bashCall.name).toBe("run_command");
    expect(bashCall.arguments.command).toBe("npm test");
    expect(bashCall.arguments.timeout_ms).toBe(15000);

    // 3. edit -> apply_patch
    const editCall = normalizeToolCall({
      name: "edit",
      arguments: {
        path: "src/main.ts",
        edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }],
      },
    });
    expect(editCall.name).toBe("apply_patch");
    expect(editCall.arguments.path).toBe("src/main.ts");
    expect(editCall.arguments.search_block).toBe("const a = 1;");
    expect(editCall.arguments.replace_block).toBe("const a = 2;");

    // 4. write -> write_file
    const writeCall = normalizeToolCall({
      name: "write",
      arguments: { path: "notes.txt", content: "hello" },
    });
    expect(writeCall.name).toBe("write_file");
    expect(writeCall.arguments.path).toBe("notes.txt");
    expect(writeCall.arguments.content).toBe("hello");

    // 5. grep -> grep_search
    const grepCall = normalizeToolCall({
      name: "grep",
      arguments: { pattern: "Hamilton", path: "winners.csv" },
    });
    expect(grepCall.name).toBe("grep_search");
    expect(grepCall.arguments.query).toBe("Hamilton");
    expect(grepCall.arguments.path).toBe("winners.csv");
  });
});
