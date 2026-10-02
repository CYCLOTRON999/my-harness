import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { TokenUsage } from "../provider/types.ts";

export type RunStatus =
  | "SUCCESS"
  | "FAILED"
  | "CYCLE_DETECTED"
  | "MAX_STEPS_EXCEEDED"
  | "ERROR";

export interface ToolExecutionRecord {
  tool: string;
  arguments: Record<string, unknown>;
  output: string;
  durationMs?: number;
}

export interface TraceStep {
  stepNumber: number;
  phase: "PLAN" | "ACT" | "OBSERVE" | "VERIFY" | "STOP";
  thought?: string;
  toolCalls?: ToolExecutionRecord[];
  tokens?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface RunTrace {
  runId: string;
  task: string;
  repoRoot: string;
  startTime: string;
  endTime?: string;
  durationMs: number;
  status: RunStatus;
  tokenUsage: TokenUsage;
  stepCount: number;
  modifiedFiles: string[];
  summary: string;
  steps: TraceStep[];
}

export class RunTracer {
  private trace: RunTrace | null = null;
  private startTimestamp = 0;

  constructor(private readonly tracesDir: string) {}

  public startRun(task: string, repoRoot: string): string {
    const runId = `run_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    this.startTimestamp = Date.now();

    this.trace = {
      runId,
      task,
      repoRoot,
      startTime: new Date(this.startTimestamp).toISOString(),
      durationMs: 0,
      status: "FAILED",
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      stepCount: 0,
      modifiedFiles: [],
      summary: "",
      steps: [],
    };

    return runId;
  }

  public recordStep(step: TraceStep): void {
    if (!this.trace) {
      throw new Error("Tracer error: startRun() must be called before recording steps.");
    }
    this.trace.steps.push(step);
    this.trace.stepCount = this.trace.steps.length;
  }

  public updateTokenUsage(usage: TokenUsage): void {
    if (this.trace) {
      this.trace.tokenUsage = { ...usage };
    }
  }

  public async completeRun(
    status: RunStatus,
    summary: string,
    modifiedFiles: string[]
  ): Promise<string> {
    if (!this.trace) {
      throw new Error("Tracer error: startRun() must be called before completeRun().");
    }

    const endTimestamp = Date.now();
    this.trace.endTime = new Date(endTimestamp).toISOString();
    this.trace.durationMs = endTimestamp - this.startTimestamp;
    this.trace.status = status;
    this.trace.summary = summary;
    this.trace.modifiedFiles = modifiedFiles;

    await fs.mkdir(this.tracesDir, { recursive: true });
    const tracePath = path.join(this.tracesDir, `${this.trace.runId}.json`);
    await fs.writeFile(tracePath, JSON.stringify(this.trace, null, 2), "utf-8");

    return tracePath;
  }

  public getTrace(): RunTrace | null {
    return this.trace;
  }
}
