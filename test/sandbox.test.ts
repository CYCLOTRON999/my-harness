import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SandboxJail, SandboxSecurityError } from "../src/sandbox/jail.ts";
import { ProcessExecutor } from "../src/sandbox/executor.ts";
import { truncateOutput } from "../src/sandbox/truncator.ts";

describe("Sandbox Security & Confinement", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-sandbox-test-"));
    await fs.writeFile(path.join(tempDir, "sample.txt"), "hello world");
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should permit resolution of files strictly inside repository root", () => {
    const jail = new SandboxJail(tempDir);
    const resolved = jail.resolvePath("sample.txt");
    expect(resolved).toBe(path.join(jail.getRoot(), "sample.txt"));
  });

  it("should reject parent directory traversal attacks (../)", () => {
    const jail = new SandboxJail(tempDir);
    expect(() => jail.resolvePath("../etc/passwd")).toThrow(SandboxSecurityError);
    expect(() => jail.resolvePath("../../something")).toThrow(SandboxSecurityError);
  });

  it("should reject absolute paths pointing outside repository", () => {
    const jail = new SandboxJail(tempDir);
    expect(() => jail.resolvePath("/etc/hosts")).toThrow(SandboxSecurityError);
  });

  it("should reject paths containing null bytes", () => {
    const jail = new SandboxJail(tempDir);
    expect(() => jail.resolvePath("sample.txt\0.js")).toThrow(SandboxSecurityError);
  });

  it("should kill subprocesses that exceed timeout", async () => {
    const executor = new ProcessExecutor(tempDir);
    const res = await executor.execute("node -e 'while(true){}'", { timeoutMs: 1500 });
    expect(res.timedOut).toBe(true);
    expect(res.outputSummary).toContain("timed out");
  });

  it("should successfully capture exit code 0 and stdout for valid commands", async () => {
    const executor = new ProcessExecutor(tempDir);
    const res = await executor.execute("node -e 'console.log(\"sandbox test pass\")'");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("sandbox test pass");
  });
});

describe("Output Truncator", () => {
  it("should leave short outputs untouched", () => {
    const short = "Line 1\nLine 2\nLine 3";
    expect(truncateOutput(short)).toBe(short);
  });

  it("should truncate long multi-line outputs preserving head and tail", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Line number ${i + 1}`);
    const content = lines.join("\n");
    const truncated = truncateOutput(content, { headLines: 10, tailLines: 15 });

    expect(truncated).toContain("Line number 1");
    expect(truncated).toContain("Line number 10");
    expect(truncated).toContain("Line number 200");
    expect(truncated).toContain("[... truncated 175 lines");
  });
});
