import { describe, it, expect, beforeEach } from "vitest";
import { LoopDetector } from "../src/engine/loop-detector.ts";
import { isVerificationCommand, isReadOnlyTask, isGreeting } from "../src/engine/agent-loop.ts";

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

  it("isVerificationCommand should recognize genuine test suites and reject trivial commands", () => {
    // Should match configured test commands
    expect(isVerificationCommand("npm test", "npm test")).toBe(true);
    expect(isVerificationCommand("npm test -- test/params.test.ts", "npm test")).toBe(true);
    expect(isVerificationCommand("pytest tests/test_machine.py", "pytest")).toBe(true);
    expect(isVerificationCommand("node --test test/router.test.js")).toBe(true);
    expect(isVerificationCommand("python3 -m unittest discover tests")).toBe(true);

    // Should reject non-test commands (closing verification loophole)
    expect(isVerificationCommand("git status", "npm test")).toBe(false);
    expect(isVerificationCommand("ls -la", "npm test")).toBe(false);
    expect(isVerificationCommand("echo 'done'", "npm test")).toBe(false);
    expect(isVerificationCommand("git diff")).toBe(false);
  });

  it("isReadOnlyTask should accurately detect read-only queries vs code edit tasks", () => {
    // Read-only questions and queries
    expect(isReadOnlyTask("hw many championship does lewis hamilton have")).toBe(true);
    expect(isReadOnlyTask("how many championships does lewis hamilton have?")).toBe(true);
    expect(isReadOnlyTask("who is the author of this package")).toBe(true);
    expect(isReadOnlyTask("summarize what this project does")).toBe(true);
    expect(isReadOnlyTask("inspect the repo structure and explain app.py")).toBe(true);
    expect(isReadOnlyTask("what is the main purpose of this library?")).toBe(true);
    expect(isReadOnlyTask("count how many files are in src/")).toBe(true);

    // Code editing / fixing tasks (should not be read-only)
    expect(isReadOnlyTask("Fix parameter parsing for routes")).toBe(false);
    expect(isReadOnlyTask("Add sequential middleware pipeline")).toBe(false);
    expect(isReadOnlyTask("Implement wildcard catch-all route support")).toBe(false);
    expect(isReadOnlyTask("Refactor URL parser into dedicated module")).toBe(false);
    expect(isReadOnlyTask("Update drivers_updated.csv with 7 titles")).toBe(false);
  });

  it("isGreeting should accurately recognize greetings vs tasks", () => {
    expect(isGreeting("hy bro")).toBe(true);
    expect(isGreeting("hi")).toBe(true);
    expect(isGreeting("hello")).toBe(true);
    expect(isGreeting("hey")).toBe(true);
    expect(isGreeting("yo")).toBe(true);
    expect(isGreeting("howdy")).toBe(true);
    expect(isGreeting("good morning")).toBe(true);
    expect(isGreeting("thanks")).toBe(true);

    expect(isGreeting("how many championships does lewis hamilton have?")).toBe(false);
    expect(isGreeting("Fix parameter parsing for routes")).toBe(false);
    expect(isGreeting("app.py")).toBe(false);
  });
});
