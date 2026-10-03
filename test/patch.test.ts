import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { applyTargetedPatch } from "../src/patch/diff-engine.ts";
import { RollbackManager } from "../src/patch/rollback.ts";
import { SandboxJail } from "../src/sandbox/jail.ts";
import { ProcessExecutor } from "../src/sandbox/executor.ts";

describe("Diff Engine & Rollback Manager", () => {
  describe("applyTargetedPatch", () => {
    it("should perform exact multi-line replacements", () => {
      const original = "function hello() {\n  console.log('hi');\n}\n";
      const search = "  console.log('hi');";
      const replace = "  console.log('hello world');";

      const res = applyTargetedPatch(original, search, replace);
      expect(res.success).toBe(true);
      expect(res.patchedContent).toBe("function hello() {\n  console.log('hello world');\n}\n");
      expect(res.fuzzyMatchUsed).toBe(false);
    });

    it("should preserve CRLF line endings", () => {
      const original = "line1\r\nline2\r\nline3\r\n";
      const search = "line2";
      const replace = "line2_replaced";

      const res = applyTargetedPatch(original, search, replace);
      expect(res.success).toBe(true);
      expect(res.patchedContent).toBe("line1\r\nline2_replaced\r\nline3\r\n");
    });

    it("should reject ambiguous search blocks that appear multiple times", () => {
      const original = "const x = 1;\nconst x = 1;\n";
      const search = "const x = 1;";
      const replace = "const x = 2;";

      const res = applyTargetedPatch(original, search, replace);
      expect(res.success).toBe(false);
      expect(res.error).toContain("matches 2 locations");
    });

    it("should succeed with fuzzy match on smart quotes and trailing spaces", () => {
      const original = 'const message = "hello world";\n';
      // Model sends smart quotes and trailing spaces
      const search = "const message = “hello world”;  ";
      const replace = 'const message = "hi there";';

      const res = applyTargetedPatch(original, search, replace);
      expect(res.success).toBe(true);
      expect(res.patchedContent).toContain('const message = "hi there";');
      expect(res.fuzzyMatchUsed).toBe(true);
    });

    it("should succeed with fuzzy match on unicode dashes", () => {
      const original = "// step-by-step\nconst x = 10;\n";
      // Model sends en-dash
      const search = "// step\u2013by\u2013step\nconst x = 10;";
      const replace = "// updated step\nconst x = 20;";

      const res = applyTargetedPatch(original, search, replace);
      expect(res.success).toBe(true);
      expect(res.patchedContent).toContain("// updated step\nconst x = 20;");
      expect(res.fuzzyMatchUsed).toBe(true);
    });

    it("should succeed when search block has copied line numbers from read_file", () => {
      const original = "function calculate(x) {\n  const doubled = x * 2;\n  return doubled;\n}\n";
      // Model copied line numbers from read_file output
      const search = "2:   const doubled = x * 2;\n3:   return doubled;";
      const replace = "2:   const tripled = x * 3;\n3:   return tripled;";

      const res = applyTargetedPatch(original, search, replace);
      expect(res.success).toBe(true);
      expect(res.patchedContent).toContain("const tripled = x * 3;");
      expect(res.fuzzyMatchUsed).toBe(true);
    });

    it("should return error when search block is completely missing", () => {
      const original = "const a = 1;\n";
      const search = "const z = 999;";
      const replace = "const z = 1000;";

      const res = applyTargetedPatch(original, search, replace);
      expect(res.success).toBe(false);
      expect(res.error).toContain("was not found in target file");
    });
  });

  describe("RollbackManager", () => {
    let tempDir: string;
    let sandbox: SandboxJail;
    let executor: ProcessExecutor;
    let rollback: RollbackManager;

    beforeAll(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-rollback-test-"));
      sandbox = new SandboxJail(tempDir);
      executor = new ProcessExecutor(tempDir);
      rollback = new RollbackManager(sandbox, executor);

      await fs.writeFile(path.join(tempDir, "existing.txt"), "original content");
    });

    afterAll(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should snapshot and restore modified existing files", async () => {
      await rollback.snapshot("existing.txt");
      await fs.writeFile(path.join(tempDir, "existing.txt"), "modified content");

      expect(rollback.getModifiedFiles()).toContain("existing.txt");

      const success = await rollback.rollbackFile("existing.txt");
      expect(success).toBe(true);

      const content = await fs.readFile(path.join(tempDir, "existing.txt"), "utf-8");
      expect(content).toBe("original content");
      expect(rollback.getModifiedFiles()).not.toContain("existing.txt");
    });

    it("should snapshot and delete newly created files during rollback", async () => {
      await rollback.snapshot("new-created.txt");
      await fs.writeFile(path.join(tempDir, "new-created.txt"), "brand new content");

      const success = await rollback.rollbackFile("new-created.txt");
      expect(success).toBe(true);

      let fileExists = true;
      try {
        await fs.access(path.join(tempDir, "new-created.txt"));
      } catch {
        fileExists = false;
      }
      expect(fileExists).toBe(false);
    });

    it("rollbackAll should restore all tracked files in batch", async () => {
      await rollback.snapshot("existing.txt");
      await fs.writeFile(path.join(tempDir, "existing.txt"), "batch change 1");

      await rollback.snapshot("temp-batch.txt");
      await fs.writeFile(path.join(tempDir, "temp-batch.txt"), "batch change 2");

      const restored = await rollback.rollbackAll();
      expect(restored).toContain("existing.txt");
      expect(restored).toContain("temp-batch.txt");

      const original = await fs.readFile(path.join(tempDir, "existing.txt"), "utf-8");
      expect(original).toBe("original content");

      let tempExists = true;
      try {
        await fs.access(path.join(tempDir, "temp-batch.txt"));
      } catch {
        tempExists = false;
      }
      expect(tempExists).toBe(false);
    });
  });
});
