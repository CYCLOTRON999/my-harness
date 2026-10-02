import fs from "node:fs/promises";
import path from "node:path";
import type { ChatMessage, TokenUsage } from "../provider/types.ts";

export interface SessionState {
  sessionId: string;
  task: string;
  repoRoot: string;
  stepCount: number;
  status: "IN_PROGRESS" | "SUCCESS" | "FAILED" | "CYCLE_DETECTED" | "MAX_STEPS_EXCEEDED";
  messages: ChatMessage[];
  modifiedFiles: string[];
  totalTokens: TokenUsage;
  updatedAt: string;
}

export class SessionStateManager {
  private readonly stateDir: string;

  constructor(repoRoot: string) {
    this.stateDir = path.join(repoRoot, ".inductionharness");
  }

  public async save(state: SessionState): Promise<string> {
    await fs.mkdir(this.stateDir, { recursive: true });
    const filePath = path.join(this.stateDir, `session_${state.sessionId}.json`);
    state.updatedAt = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
    return filePath;
  }

  public async load(sessionId: string): Promise<SessionState | null> {
    const filePath = path.join(this.stateDir, `session_${sessionId}.json`);
    try {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data) as SessionState;
    } catch {
      return null;
    }
  }

  public async listSessions(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.stateDir);
      return files
        .filter((f) => f.startsWith("session_") && f.endsWith(".json"))
        .map((f) => f.replace(/^session_/, "").replace(/\.json$/, ""));
    } catch {
      return [];
    }
  }
}
