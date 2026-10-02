import { exec } from "node:child_process";
import { z } from "zod";
import type { AgentTool } from "./base.ts";
import { truncateOutput } from "../sandbox/truncator.ts";

export const RunCommandSchema = z.object({
  command: z.string().describe("Shell command to run (e.g. 'node test.js' or 'npm test')"),
  timeout_seconds: z.number().int().positive().optional().describe("Timeout in seconds (default: 30)"),
});

export const runCommandTool: AgentTool<typeof RunCommandSchema> = {
  name: "run_command",
  description: "Execute a shell command within the repository root (e.g. running tests or linters). Outputs are bounded to save tokens.",
  schema: RunCommandSchema,
  execute: async (args, ctx) => {
    const cwd = ctx.sandbox.getRoot();
    const timeoutMs = (args.timeout_seconds ?? 30) * 1000;

    return new Promise<string>((resolve) => {
      exec(
        args.command,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 1024 * 128, // 128 KB
        },
        (error, stdout, stderr) => {
          let output = "";
          if (stdout.trim().length > 0) {
            output += `STDOUT:\n${stdout.trim()}\n`;
          }
          if (stderr.trim().length > 0) {
            output += `STDERR:\n${stderr.trim()}\n`;
          }

          const truncated = truncateOutput(output.trim() || "[No output produced]");

          if (error) {
            if (error.killed) {
              resolve(`Command timed out after ${args.timeout_seconds ?? 30} seconds.\n${truncated}`);
              return;
            }
            resolve(`Command exited with code ${error.code ?? 1}.\n${truncated}`);
            return;
          }

          resolve(`Command succeeded (exit code 0):\n${truncated}`);
        }
      );
    });
  },
};
