import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SandboxJail } from "../src/sandbox/jail.ts";
import { ProcessExecutor } from "../src/sandbox/executor.ts";
import { readFileTool } from "../src/tools/read.ts";
import { applyPatchTool } from "../src/tools/patch.ts";
import { writeFileTool } from "../src/tools/write.ts";
import { listDirTool } from "../src/tools/list.ts";
import { fileSearchTool } from "../src/tools/find.ts";
import { grepSearchTool } from "../src/tools/grep.ts";
import { runCommandTool } from "../src/tools/command.ts";
import { RollbackManager } from "../src/patch/rollback.ts";
import type { ToolExecutionContext } from "../src/tools/base.ts";

describe("Structured Tool Suite", () => {
  let tempDir: string;
  let ctx: ToolExecutionContext;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-tools-test-"));
    const sandbox = new SandboxJail(tempDir);
    const executor = new ProcessExecutor(tempDir);
    const rollback = new RollbackManager(sandbox, executor);
    ctx = { sandbox, executor, rollback };

    // Seed test files
    await fs.writeFile(
      path.join(tempDir, "math.ts"),
      "function add(a, b) {\n  return a + b;\n}\n\nfunction sub(a, b) {\n  return a - b;\n}\n"
    );
    await fs.mkdir(path.join(tempDir, "nested"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "nested", "helper.ts"), "export const PI = 3.14159;\n");
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("read_file should slice line ranges correctly with numbers", async () => {
    const res = await readFileTool.execute({ path: "math.ts", start_line: 1, end_line: 3 }, ctx);
    expect(res).toContain("1: function add(a, b) {");
    expect(res).toContain("2:   return a + b;");
    expect(res).toContain("3: }");
    expect(res).not.toContain("function sub");
  });

  it("apply_patch should replace exact blocks cleanly", async () => {
    const patchRes = await applyPatchTool.execute(
      {
        path: "math.ts",
        search_block: "function sub(a, b) {\n  return a - b;\n}",
        replace_block: "function sub(a, b) {\n  // updated\n  return a - b;\n}",
      },
      ctx
    );
    expect(patchRes).toContain("Successfully patched");

    const content = await fs.readFile(path.join(tempDir, "math.ts"), "utf-8");
    expect(content).toContain("// updated");
  });

  it("apply_patch should fail with descriptive error if block is not found", async () => {
    const patchRes = await applyPatchTool.execute(
      {
        path: "math.ts",
        search_block: "function nonexistent() {}",
        replace_block: "function replacement() {}",
      },
      ctx
    );
    expect(patchRes).toContain("was not found");
  });

  it("write_file should create new files and parent directories", async () => {
    const writeRes = await writeFileTool.execute(
      {
        path: "subfolder/deep/new-file.txt",
        content: "created from test",
        overwrite: true,
      },
      ctx
    );
    expect(writeRes).toContain("Successfully wrote");

    const readBack = await fs.readFile(path.join(tempDir, "subfolder/deep/new-file.txt"), "utf-8");
    expect(readBack).toBe("created from test");
  });

  it("list_dir should enumerate files and directories with depth controls", async () => {
    const listRes = await listDirTool.execute({ path: ".", recursive: true, max_depth: 2 }, ctx);
    expect(listRes).toContain("[file] math.ts");
    expect(listRes).toContain("[dir]  nested/");
  });

  it("file_search should locate files matching query", async () => {
    const searchRes = await fileSearchTool.execute({ query: "helper", path: "." }, ctx);
    expect(searchRes).toContain("nested/helper.ts");
  });

  it("grep_search should return line numbers and matching line content", async () => {
    const grepRes = await grepSearchTool.execute({ query: "3.14159", path: "." }, ctx);
    expect(grepRes).toContain("nested/helper.ts:1: export const PI = 3.14159;");
  });

  it("run_command should execute shell commands and capture output", async () => {
    const cmdRes = await runCommandTool.execute({ command: "node -e 'console.log(\"cmd tool ok\")'" }, ctx);
    expect(cmdRes).toContain("exit code 0");
    expect(cmdRes).toContain("cmd tool ok");
  });
});
