#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline/promises";
import { Command } from "commander";
import pc from "picocolors";
import { OpenRouterClient } from "../src/provider/client.ts";
import { SandboxJail } from "../src/sandbox/jail.ts";
import { ProcessExecutor } from "../src/sandbox/executor.ts";
import { RollbackManager } from "../src/patch/rollback.ts";
import { allTools } from "../src/tools/index.ts";
import { AgentLoop } from "../src/engine/agent-loop.ts";

function renderTurnDetail(phase: string, detail: string): void {
  const badge =
    phase === "PLAN"
      ? pc.blue("[PLAN]")
      : phase === "THINK"
        ? pc.magenta("[THINK]")
        : phase === "ACT"
          ? pc.yellow("[ACT]")
          : phase === "STOP"
            ? pc.red("[STOP]")
            : pc.green("[OBSERVE]");

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
  .description("Autonomous repository-aware coding-agent runtime")
  .version("0.2.0")
  .option("-t, --task <string>", "The coding task to perform")
  .option("-r, --repo <path>", "Path to target repository (default: current directory)", ".")
  .option("-m, --model <string>", "OpenRouter model (default: deepseek/deepseek-chat)", "deepseek/deepseek-chat")
  .option("-s, --max-steps <number>", "Maximum agent steps", "15")
  .option("-k, --api-key <string>", "OpenRouter API Key (or set OPENROUTER_API_KEY env)")
  .option("--resume <sessionId>", "Resume a previous session from .inductionharness")
  .option("-i, --interactive", "Enter interactive mode (can be launched with or without an initial --task)")
  .action(async (options) => {
    try {
      if (!options.task && !options.interactive) {
        console.error(pc.red("Error: Must provide either --task <description> or --interactive (-i).\n"));
        program.help();
        return;
      }

      console.log(pc.bold(pc.cyan("\n=== CodeForge Autonomous Coding Agent ===")));
      if (options.task) {
        console.log(`${pc.bold("Initial Task:")} ${options.task}`);
      } else {
        console.log(`${pc.bold("Mode:")} Interactive REPL`);
      }
      console.log(`${pc.bold("Target Repo:")} ${path.resolve(options.repo)}`);
      console.log(`${pc.bold("Model:")} ${options.model}`);
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

      let activeSessionId = options.resume;

      const runTurn = async (taskText: string, resumeId?: string) => {
        return await loop.run({
          task: taskText,
          repoRoot: sandbox.getRoot(),
          maxSteps: parseInt(options.maxSteps, 10),
          resumeSessionId: resumeId,
          onTurn: (step, phase, detail) => {
            console.log(pc.dim(`Step ${step}`));
            renderTurnDetail(phase, detail);
          },
        });
      };

      if (options.task) {
        const result = await runTurn(options.task, activeSessionId);
        activeSessionId = result.sessionId;

        console.log(pc.bold(pc.cyan("\n=== Execution Summary ===")));
        console.log(`Status: ${result.status === "SUCCESS" ? pc.green(result.status) : pc.red(result.status)}`);
        console.log(`Session ID: ${result.sessionId}`);
        console.log(`Steps Taken: ${result.stepCount}`);
        console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
        console.log(
          `Token Usage: ${pc.yellow(result.totalTokens.totalTokens)} total (${result.totalTokens.promptTokens} prompt, ${result.totalTokens.completionTokens} completion)`
        );
        if (result.tracePath) {
          console.log(`Run Trace: ${pc.cyan(result.tracePath)}`);
        }
        console.log(`Summary: ${result.summary}\n`);
      }

      if (options.interactive) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        console.log(pc.dim("Interactive session active. Enter prompts below. Type 'exit' or 'quit' to terminate.\n"));

        while (true) {
          const followUp = await rl.question(pc.bold(pc.magenta("codeforge > ")));
          const trimmed = followUp.trim();
          if (!trimmed || trimmed === "exit" || trimmed === "quit") {
            console.log(pc.dim("Exiting interactive mode."));
            rl.close();
            break;
          }

          const result = await runTurn(trimmed, activeSessionId);
          activeSessionId = result.sessionId;
          console.log(pc.bold(pc.cyan("\n--- Turn Summary ---")));
          console.log(`Status: ${result.status === "SUCCESS" ? pc.green(result.status) : pc.red(result.status)}`);
          console.log(`Tokens: ${result.totalTokens.totalTokens} | Steps: ${result.stepCount}`);
          console.log(`Summary: ${result.summary}\n`);
        }
      }

      process.exit(0);
    } catch (err: unknown) {
      console.error(pc.red(`\nFatal error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

program.parse(process.argv);
