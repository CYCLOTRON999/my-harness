import { z } from "zod";
import type { AgentTool } from "./base.ts";

export const RunCommandSchema = z.object({
  command: z.string().describe("Shell command to run (e.g. 'node test.js' or 'npm test')"),
  timeout_seconds: z.number().int().positive().optional().describe("Timeout in seconds (default: 30)"),
});

export const runCommandTool: AgentTool<typeof RunCommandSchema> = {
  name: "run_command",
  description: "Execute a shell command within the repository root (e.g. running tests or linters). Outputs are bounded to save tokens.",
  schema: RunCommandSchema,
  execute: async (args, ctx) => {
    const timeoutMs = args.timeout_seconds ? args.timeout_seconds * 1000 : 30000;
    const result = await ctx.executor.execute(args.command, { timeoutMs });
    return result.outputSummary;
  },
};
