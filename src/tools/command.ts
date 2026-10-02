import { z } from "zod";
import type { AgentTool } from "./base.ts";

const BLOCKED_DAEMON_PATTERNS = [
  /\bstreamlit\s+run\b/i,
  /\bflask\s+run\b/i,
  /\buvicorn\b/i,
  /\bgunicorn\b/i,
  /\bpython\s+-m\s+http\.server\b/i,
  /\b(vite|next)\s+dev\b/i,
];

export const RunCommandSchema = z.object({
  command: z.string().describe("Shell command to run (e.g. 'node test.js' or 'npm test'). Do NOT run blocking server processes."),
  timeout_seconds: z.number().int().positive().optional().describe("Timeout in seconds (default: 30)"),
});

export const runCommandTool: AgentTool<typeof RunCommandSchema> = {
  name: "run_command",
  description: "Execute a shell command within the repository root (e.g. running tests, linters, or single-shot scripts). Daemon servers like 'streamlit run' or 'flask run' are blocked because they do not terminate.",
  schema: RunCommandSchema,
  execute: async (args, ctx) => {
    for (const pattern of BLOCKED_DAEMON_PATTERNS) {
      if (pattern.test(args.command)) {
        return `Execution blocked: '${args.command}' is a long-running interactive server process that will not terminate. Run test scripts (e.g. 'pytest', 'python test.py', 'npm test') instead.`;
      }
    }
    const timeoutMs = Math.min(args.timeout_seconds ? args.timeout_seconds * 1000 : 30000, 30000);
    const result = await ctx.executor.execute(args.command, { timeoutMs });
    return result.outputSummary;
  },
};
