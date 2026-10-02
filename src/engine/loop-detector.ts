import crypto from "node:crypto";

export interface LoopCheckResult {
  status: "OK" | "WARN" | "ABORT";
  message?: string;
  consecutiveCount?: number;
}

export class LoopDetector {
  private readonly callHistory: string[] = [];
  private lastHash: string | null = null;
  private consecutiveCount = 0;

  constructor(
    private readonly warnThreshold = 3,
    private readonly abortThreshold = 4
  ) {}

  public recordCall(toolName: string, args: Record<string, unknown>): LoopCheckResult {
    const hash = this.computeCallHash(toolName, args);
    this.callHistory.push(hash);

    // 1. Check consecutive identical tool calls
    if (hash === this.lastHash) {
      this.consecutiveCount++;
    } else {
      this.consecutiveCount = 1;
      this.lastHash = hash;
    }

    if (this.consecutiveCount >= this.abortThreshold) {
      return {
        status: "ABORT",
        consecutiveCount: this.consecutiveCount,
        message: `Cycle Detected: Tool '${toolName}' called with identical arguments ${this.consecutiveCount} times consecutively. Aborting execution to prevent infinite loop.`,
      };
    }

    if (this.consecutiveCount === this.warnThreshold) {
      return {
        status: "WARN",
        consecutiveCount: this.consecutiveCount,
        message: `Loop Warning: You have invoked tool '${toolName}' with identical arguments ${this.consecutiveCount} times. Re-evaluate your strategy and change your approach instead of repeating failed actions.`,
      };
    }

    // 2. Check periodic repeating patterns (e.g., A -> B -> A -> B -> A -> B)
    const periodicCheck = this.detectPeriodicCycle();
    if (periodicCheck) {
      return {
        status: "ABORT",
        message: periodicCheck,
      };
    }

    return { status: "OK" };
  }

  public reset(): void {
    this.callHistory.length = 0;
    this.lastHash = null;
    this.consecutiveCount = 0;
  }

  private computeCallHash(toolName: string, args: Record<string, unknown>): string {
    const canonicalArgs = this.canonicalizeObject(args);
    return crypto
      .createHash("sha256")
      .update(`${toolName}:${canonicalArgs}`)
      .digest("hex");
  }

  private canonicalizeObject(obj: unknown): string {
    if (obj === null || typeof obj !== "object") {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return "[" + obj.map((item) => this.canonicalizeObject(item)).join(",") + "]";
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map((key) => {
      const val = (obj as Record<string, unknown>)[key];
      return `${JSON.stringify(key)}:${this.canonicalizeObject(val)}`;
    });
    return "{" + pairs.join(",") + "}";
  }

  private detectPeriodicCycle(): string | null {
    const historyLen = this.callHistory.length;
    // Check cycle periods of length 2 and 3
    for (const period of [2, 3]) {
      const minLengthNeeded = period * 3; // Needs 3 full cycles to confirm
      if (historyLen < minLengthNeeded) continue;

      const recent = this.callHistory.slice(-minLengthNeeded);
      let isCycle = true;
      for (let i = 0; i < minLengthNeeded; i++) {
        if (recent[i] !== recent[i % period]) {
          isCycle = false;
          break;
        }
      }

      if (isCycle) {
        return `Periodic Loop Detected: An alternating cycle of length ${period} repeated 3 times. Aborting execution.`;
      }
    }

    return null;
  }
}
