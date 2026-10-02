#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { OpenRouterClient } from "../src/provider/client.ts";
import { SandboxJail } from "../src/sandbox/jail.ts";
import { ProcessExecutor } from "../src/sandbox/executor.ts";
import { RollbackManager } from "../src/patch/rollback.ts";
import { allTools } from "../src/tools/index.ts";
import { AgentLoop } from "../src/engine/agent-loop.ts";
import { TerminalUi } from "../src/cli/terminal-ui.ts";

function renderTurnDetail(phase: string, detail: string): void {
  const badge =
    phase === "PLAN"
      ? pc.blue("[PLAN]")
      : phase === "THINK"
        ? pc.magenta("[THINK]")
        : phase === "ACT"
          ? pc.yellow("[ACT]")
          : phase === "STOP"
            ? pc.green("[STOP]")
            : pc.dim("[OBSERVE]");

  // Color unified diff lines if output is a diff
  if (phase === "OBSERVE" && (detail.includes("--- ") || detail.includes("+++ "))) {
    const colored = detail
      .split("\n")
      .map((line) => {
        if (line.startsWith("+") && !line.startsWith("+++")) return pc.green(line);
        if (line.startsWith("-") && !line.startsWith("---")) return pc.red(line);
        return line;
      })
      .join("\n");
    console.log(`  ${badge}\n${colored}`);
    return;
  }

  console.log(`  ${badge} ${detail}`);
}

const program = new Command();

program
  .name("codeforge")
  .description("Autonomous repository-aware coding-agent runtime and interactive terminal CLI")
  .version("0.2.0")
  .option("-t, --task <string>", "Single-shot coding task (launches interactive terminal if omitted)")
  .option("-r, --repo <path>", "Path to target repository (default: current directory)", ".")
  .option("-m, --model <string>", "OpenRouter model (default: deepseek/deepseek-chat)", "deepseek/deepseek-chat")
  .option("-s, --max-steps <number>", "Maximum agent steps per task", "15")
  .option("-k, --api-key <string>", "OpenRouter API Key (or set OPENROUTER_API_KEY env)")
  .option("--resume <sessionId>", "Resume a previous session from .inductionharness")
  .option("-i, --interactive", "Force interactive terminal mode")
  .action(async (options) => {
    try {
      // Default to Terminal UI if no task specified, or if interactive flag is present
      if (!options.task || options.interactive) {
        const ui = new TerminalUi({
          repo: options.repo,
          model: options.model,
          apiKey: options.apiKey,
          resumeSessionId: options.resume,
          maxSteps: parseInt(options.maxSteps, 10),
        });
        await ui.start();
        process.exit(0);
      }

      // Single-shot task execution
      console.log(pc.bold(pc.cyan("\n=== CodeForge Autonomous Coding Agent ===")));
      console.log(`${pc.bold("Task:")}        ${options.task}`);
      console.log(`${pc.bold("Target Repo:")} ${path.resolve(options.repo)}`);
      console.log(`${pc.bold("Model:")}       ${options.model}`);
      if (options.resume) {
        console.log(`${pc.bold("Resuming Session:")} ${options.resume}`);
      }
      console.log("");

      const sandbox = new SandboxJail(options.repo);
      const executor = new ProcessExecutor(sandbox.getRoot());
      const rollback = new RollbackManager(sandbox, executor);
      const client = new OpenRouterClient({
        apiKey: options.apiKey,
        model: options.model,
      });

      const loop = new AgentLoop(client, allTools, { sandbox, executor, rollback });

      const result = await loop.run({
        task: options.task,
        repoRoot: sandbox.getRoot(),
        maxSteps: parseInt(options.maxSteps, 10),
        resumeSessionId: options.resume,
        onTurn: (step, phase, detail) => {
          console.log(pc.dim(`Step ${step}`));
          renderTurnDetail(phase, detail);
        },
      });

      console.log(pc.bold(pc.cyan("\n=== Execution Summary ===")));
      console.log(`Status:      ${result.status === "SUCCESS" ? pc.green(result.status) : pc.red(result.status)}`);
      console.log(`Session ID:  ${result.sessionId}`);
      console.log(`Steps Taken: ${result.stepCount}`);
      console.log(`Duration:    ${(result.durationMs / 1000).toFixed(1)}s`);
      console.log(
        `Token Usage: ${pc.yellow(result.totalTokens.totalTokens)} total (${result.totalTokens.promptTokens} prompt, ${result.totalTokens.completionTokens} completion)`
      );
      if (result.tracePath) {
        console.log(`Run Trace:   ${pc.cyan(result.tracePath)}`);
      }
      console.log(`Summary:     ${result.summary}\n`);

      process.exit(result.status === "SUCCESS" ? 0 : 1);
    } catch (err: unknown) {
      console.error(pc.red(`\nFatal error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

program.parse(process.argv);
