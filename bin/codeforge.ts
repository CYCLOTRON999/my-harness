#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { OpenRouterClient, loadEnvFile } from "../src/provider/client.ts";
import { SandboxJail } from "../src/sandbox/jail.ts";
import { ProcessExecutor } from "../src/sandbox/executor.ts";
import { RollbackManager } from "../src/patch/rollback.ts";
import { allTools } from "../src/tools/index.ts";
import { AgentLoop } from "../src/engine/agent-loop.ts";
import { TerminalUi } from "../src/cli/terminal-ui.ts";
import { renderCyberBanner, renderStatusCard, renderTurnDetail } from "../src/cli/banner.ts";

loadEnvFile();

const program = new Command();

program
  .name("codeforge")
  .description("Autonomous repository-aware coding-agent runtime and interactive terminal CLI")
  .version("0.2.0")
  .option("-t, --task <string>", "Single-shot coding task (launches interactive terminal if omitted)")
  .option("-r, --repo <path>", "Path to target repository (default: current directory)", ".")
  .option("-m, --model <string>", "OpenRouter model (default: env OPENROUTER_MODEL or deepseek/deepseek-chat)")
  .option("-s, --max-steps <number>", "Maximum agent steps per task", "15")
  .option("-c, --test-cmd <string>", "Verification test command (e.g. 'npm test')")
  .option("-k, --api-key <string>", "OpenRouter API Key (or set OPENROUTER_API_KEY env)")
  .option("--resume <sessionId>", "Resume a previous session from .inductionharness")
  .option("-i, --interactive", "Force interactive terminal mode")
  .option("--no-stream", "Disable real-time response streaming")
  .action(async (options) => {
    try {
      loadEnvFile(options.repo);
      const selectedModel = options.model || process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";

      // Default to Terminal UI if no task specified, or if interactive flag is present
      if (!options.task || options.interactive) {
        const ui = new TerminalUi({
          repo: options.repo,
          model: selectedModel,
          apiKey: options.apiKey,
          resumeSessionId: options.resume,
          maxSteps: parseInt(options.maxSteps, 10),
        });
        await ui.start();
        process.exit(0);
      }

      // Single-shot task execution
      renderCyberBanner();
      renderStatusCard({
        repo: path.resolve(options.repo),
        model: selectedModel,
        task: options.task,
        testCmd: options.testCmd,
        sessionId: options.resume,
      });

      const sandbox = new SandboxJail(options.repo);
      const executor = new ProcessExecutor(sandbox.getRoot());
      const rollback = new RollbackManager(sandbox, executor);
      const client = new OpenRouterClient({
        apiKey: options.apiKey,
        model: selectedModel,
      });

      const loop = new AgentLoop(client, allTools, { sandbox, executor, rollback });

      let lastLoggedStep = 0;
      const result = await loop.run({
        task: options.task,
        repoRoot: sandbox.getRoot(),
        maxSteps: parseInt(options.maxSteps, 10),
        testCommand: options.testCmd,
        resumeSessionId: options.resume,
        stream: options.stream !== false,
        onTurn: (step, phase, detail) => {
          if (step !== lastLoggedStep) {
            console.log(pc.dim(`\nStep ${step}`));
            lastLoggedStep = step;
          }
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
