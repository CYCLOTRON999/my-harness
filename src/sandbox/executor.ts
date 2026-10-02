import { spawn } from "node:child_process";
import { truncateOutput } from "./truncator.ts";

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  outputSummary: string;
}

export interface CommandExecutionOptions {
  timeoutMs?: number;
  maxBufferBytes?: number;
  env?: Record<string, string>;
}

export class ProcessExecutor {
  constructor(private readonly repoRoot: string) {}

  public async execute(
    command: string,
    options: CommandExecutionOptions = {}
  ): Promise<CommandExecutionResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? 30000;
    const maxBuffer = options.maxBufferBytes ?? 64 * 1024; // 64 KB

    return new Promise<CommandExecutionResult>((resolve) => {
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let timedOut = false;
      let killed = false;

      const child = spawn(command, {
        cwd: this.repoRoot,
        shell: true,
        detached: true, // Create a process group so we can terminate child trees
        env: {
          ...process.env,
          ...options.env,
          PAGER: "cat",
          CI: "true",
        },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        if (child.pid) {
          try {
            // Kill entire process tree
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdoutBuffer.length < maxBuffer) {
          stdoutBuffer += chunk.toString("utf-8");
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderrBuffer.length < maxBuffer) {
          stderrBuffer += chunk.toString("utf-8");
        }
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        let combined = "";
        if (stdoutBuffer.trim().length > 0) {
          combined += `STDOUT:\n${stdoutBuffer.trim()}\n`;
        }
        if (stderrBuffer.trim().length > 0) {
          combined += `STDERR:\n${stderrBuffer.trim()}\n`;
        }

        const truncated = truncateOutput(combined.trim() || "[No output produced]");

        let outputSummary = "";
        if (timedOut) {
          outputSummary = `Command timed out after ${(timeoutMs / 1000).toFixed(1)}s and was killed.\n${truncated}`;
        } else if (code !== 0) {
          outputSummary = `Command exited with non-zero code ${code ?? 1}.\n${truncated}`;
        } else {
          outputSummary = `Command succeeded (exit code 0):\n${truncated}`;
        }

        resolve({
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          exitCode: killed ? 137 : code ?? 1,
          timedOut,
          durationMs,
          outputSummary,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          stdout: "",
          stderr: err.message,
          exitCode: 1,
          timedOut: false,
          durationMs: Date.now() - startTime,
          outputSummary: `Execution error: ${err.message}`,
        });
      });
    });
  }
}
