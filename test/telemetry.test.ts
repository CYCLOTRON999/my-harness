import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RunTracer } from "../src/telemetry/tracer.ts";
import { SessionStateManager } from "../src/engine/state.ts";

describe("Telemetry & Checkpointing", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-telemetry-test-"));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("RunTracer", () => {
    it("should record execution steps and write a structured JSON trace file", async () => {
      const tracesDir = path.join(tempDir, "traces");
      const tracer = new RunTracer(tracesDir);

      const runId = tracer.startRun("Add feature X", tempDir);
      expect(runId).toContain("run_");

      tracer.updateTokenUsage({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      tracer.recordStep({
        stepNumber: 1,
        phase: "ACT",
        thought: "Inspecting files",
        toolCalls: [
          {
            tool: "read_file",
            arguments: { path: "index.ts" },
            output: "content of index.ts",
            durationMs: 12,
          },
        ],
      });

      const traceFile = await tracer.completeRun("SUCCESS", "Completed feature X", ["index.ts"]);
      expect(traceFile).toContain(runId);

      const raw = await fs.readFile(traceFile, "utf-8");
      const traceData = JSON.parse(raw);

      expect(traceData.runId).toBe(runId);
      expect(traceData.status).toBe("SUCCESS");
      expect(traceData.task).toBe("Add feature X");
      expect(traceData.steps).toHaveLength(1);
      expect(traceData.steps[0].toolCalls[0].tool).toBe("read_file");
      expect(traceData.modifiedFiles).toEqual(["index.ts"]);
      expect(traceData.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("SessionStateManager", () => {
    it("should save and reload session state checkpoints accurately", async () => {
      const stateManager = new SessionStateManager(tempDir);
      const sessionId = "test-session-123";

      const savedPath = await stateManager.save({
        sessionId,
        task: "Fix broken division",
        repoRoot: tempDir,
        stepCount: 3,
        status: "IN_PROGRESS",
        messages: [
          { role: "system", content: "You are CodeForge" },
          { role: "user", content: "Fix bug" },
        ],
        modifiedFiles: ["calculator.ts"],
        totalTokens: { promptTokens: 300, completionTokens: 120, totalTokens: 420 },
        updatedAt: new Date().toISOString(),
      });

      expect(savedPath).toContain("session_test-session-123.json");

      const loaded = await stateManager.load(sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded?.sessionId).toBe(sessionId);
      expect(loaded?.task).toBe("Fix broken division");
      expect(loaded?.stepCount).toBe(3);
      expect(loaded?.modifiedFiles).toEqual(["calculator.ts"]);
      expect(loaded?.messages).toHaveLength(2);

      const sessions = await stateManager.listSessions();
      expect(sessions).toContain(sessionId);
    });
  });
});
