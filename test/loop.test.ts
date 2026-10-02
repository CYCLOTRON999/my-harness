import { describe, it, expect, beforeEach } from "vitest";
import { LoopDetector } from "../src/engine/loop-detector.ts";

describe("LoopDetector Safety & Cycle Prevention", () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector(3, 4);
  });

  it("should permit normal distinct tool calls", () => {
    const r1 = detector.recordCall("read_file", { path: "a.ts" });
    const r2 = detector.recordCall("read_file", { path: "b.ts" });
    const r3 = detector.recordCall("apply_patch", { path: "a.ts", search: "x" });

    expect(r1.status).toBe("OK");
    expect(r2.status).toBe("OK");
    expect(r3.status).toBe("OK");
  });

  it("should trigger a WARN status on 3 consecutive identical calls", () => {
    const callArgs = { command: "npm test" };
    expect(detector.recordCall("run_command", callArgs).status).toBe("OK");
    expect(detector.recordCall("run_command", callArgs).status).toBe("OK");

    const warnRes = detector.recordCall("run_command", callArgs);
    expect(warnRes.status).toBe("WARN");
    expect(warnRes.consecutiveCount).toBe(3);
    expect(warnRes.message).toContain("invoked tool 'run_command' with identical arguments 3 times");
  });

  it("should trigger an ABORT status on 4 consecutive identical calls", () => {
    const callArgs = { command: "npm test" };
    detector.recordCall("run_command", callArgs);
    detector.recordCall("run_command", callArgs);
    detector.recordCall("run_command", callArgs);

    const abortRes = detector.recordCall("run_command", callArgs);
    expect(abortRes.status).toBe("ABORT");
    expect(abortRes.consecutiveCount).toBe(4);
    expect(abortRes.message).toContain("Cycle Detected");
  });

  it("should detect periodic ping-pong cycles (A -> B -> A -> B -> A -> B)", () => {
    const toolA = { tool: "read_file", args: { path: "a.ts" } };
    const toolB = { tool: "read_file", args: { path: "b.ts" } };

    // 2 cycles
    expect(detector.recordCall(toolA.tool, toolA.args).status).toBe("OK");
    expect(detector.recordCall(toolB.tool, toolB.args).status).toBe("OK");
    expect(detector.recordCall(toolA.tool, toolA.args).status).toBe("OK");
    expect(detector.recordCall(toolB.tool, toolB.args).status).toBe("OK");

    // 3rd cycle: A is ok, B triggers periodic loop abort
    expect(detector.recordCall(toolA.tool, toolA.args).status).toBe("OK");
    const pingPongRes = detector.recordCall(toolB.tool, toolB.args);

    expect(pingPongRes.status).toBe("ABORT");
    expect(pingPongRes.message).toContain("Periodic Loop Detected");
  });
});
