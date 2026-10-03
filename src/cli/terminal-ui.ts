import readline from "node:readline/promises";
import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { OpenRouterClient, loadEnvFile } from "../provider/client.ts";
import { SandboxJail } from "../sandbox/jail.ts";
import { ProcessExecutor } from "../sandbox/executor.ts";
import { RollbackManager } from "../patch/rollback.ts";
import { allTools } from "../tools/index.ts";
import { AgentLoop } from "../engine/agent-loop.ts";
import { renderCyberBanner, renderStatusCard, renderTurnDetail } from "./banner.ts";

export interface TerminalUiOptions {
  repo?: string;
  model?: string;
  apiKey?: string;
  resumeSessionId?: string;
  maxSteps?: number;
}

export class TerminalUi {
  private repoRoot: string;
  private model: string;
  private apiKey?: string;
  private sessionId?: string;
  private maxSteps: number;
  private sandbox!: SandboxJail;
  private executor!: ProcessExecutor;
  private rollback!: RollbackManager;
  private client!: OpenRouterClient;
  private loop!: AgentLoop;
  private cumulativeTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private turnCount = 0;

  constructor(options: TerminalUiOptions = {}) {
    this.repoRoot = path.resolve(options.repo || process.cwd());
    loadEnvFile(this.repoRoot);
    this.model = options.model || process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
    this.apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    this.sessionId = options.resumeSessionId;
    this.maxSteps = options.maxSteps || 15;
    this.initSubsystems();
  }

  private initSubsystems(): void {
    if (!fs.existsSync(this.repoRoot)) {
      throw new Error(`Repository root does not exist: ${this.repoRoot}`);
    }
    this.sandbox = new SandboxJail(this.repoRoot);
    this.executor = new ProcessExecutor(this.sandbox.getRoot());
    this.rollback = new RollbackManager(this.sandbox, this.executor);
    this.client = new OpenRouterClient({
      apiKey: this.apiKey,
      model: this.model,
    });
    this.loop = new AgentLoop(this.client, allTools, {
      sandbox: this.sandbox,
      executor: this.executor,
      rollback: this.rollback,
    });
  }

  private renderBanner(): void {
    renderCyberBanner();
    renderStatusCard({
      repo: this.repoRoot,
      model: this.model,
      sessionId: this.sessionId,
    });
    console.log(
      pc.dim("  Commands: ") +
        pc.cyan("/help") +
        pc.dim(" • ") +
        pc.cyan("/status") +
        pc.dim(" • ") +
        pc.cyan("/diff") +
        pc.dim(" • ") +
        pc.cyan("/rollback") +
        pc.dim(" • ") +
        pc.cyan("/clear") +
        pc.dim(" • ") +
        pc.cyan("/exit\n")
    );
  }

  private renderTurnDetail(phase: string, detail: string): void {
    renderTurnDetail(phase, detail);
  }

  private async handleCommand(cmd: string): Promise<boolean> {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");

    switch (command) {
      case "/help":
        console.log(pc.bold("\nAvailable Commands:"));
        console.log(`  ${pc.cyan("/help")}            - Display this help reference`);
        console.log(`  ${pc.cyan("/status")}          - Show active session statistics and token metrics`);
        console.log(`  ${pc.cyan("/diff")}            - Show uncommitted working tree diff`);
        console.log(`  ${pc.cyan("/rollback")}        - Revert all file modifications in current session`);
        console.log(`  ${pc.cyan("/repo <path>")}     - Switch target repository`);
        console.log(`  ${pc.cyan("/model <name>")}    - Switch active model`);
        console.log(`  ${pc.cyan("/clear")}           - Clear terminal screen`);
        console.log(`  ${pc.cyan("/exit, /quit")}     - Exit interactive session\n`);
        return true;

      case "/status":
        console.log(pc.bold("\n--- Session Status ---"));
        console.log(`Repository:    ${pc.green(this.repoRoot)}`);
        console.log(`Model:         ${pc.yellow(this.model)}`);
        console.log(`Session ID:    ${pc.magenta(this.sessionId || "None (fresh)")}`);
        console.log(`Turns Run:     ${this.turnCount}`);
        console.log(
          `Tokens Used:   ${pc.yellow(this.cumulativeTokens.totalTokens)} total (${this.cumulativeTokens.promptTokens} prompt, ${this.cumulativeTokens.completionTokens} completion)`
        );
        const modified = this.rollback.getModifiedFiles();
        console.log(`Modified Files: ${modified.length > 0 ? pc.green(modified.join(", ")) : pc.dim("none")}\n`);
        return true;

      case "/diff": {
        const diffRes = await this.executor.execute("git diff");
        if (!diffRes.stdout.trim()) {
          console.log(pc.dim("\nNo working tree diff found.\n"));
          return true;
        }
        console.log(pc.bold("\n--- Working Tree Diff ---"));
        const coloredDiff = diffRes.stdout
          .split("\n")
          .map((line) => {
            if (line.startsWith("+") && !line.startsWith("+++")) return pc.green(line);
            if (line.startsWith("-") && !line.startsWith("---")) return pc.red(line);
            return line;
          })
          .join("\n");
        console.log(coloredDiff + "\n");
        return true;
      }

      case "/rollback": {
        const count = this.rollback.rollbackAll();
        console.log(pc.yellow(`\nRestored ${count} modified file(s) to pristine state.\n`));
        return true;
      }

      case "/repo": {
        if (!arg) {
          console.log(pc.red("Error: Must specify repository path. Example: /repo ./my-project"));
          return true;
        }
        const newPath = path.resolve(arg);
        if (!fs.existsSync(newPath)) {
          console.log(pc.red(`Error: Path does not exist: ${newPath}`));
          return true;
        }
        this.repoRoot = newPath;
        this.sessionId = undefined;
        this.initSubsystems();
        console.log(pc.green(`Switched target repository to: ${newPath}\n`));
        return true;
      }

      case "/model": {
        if (!arg) {
          console.log(pc.red("Error: Must specify model. Example: /model deepseek/deepseek-chat"));
          return true;
        }
        this.model = arg;
        this.initSubsystems();
        console.log(pc.green(`Switched active model to: ${arg}\n`));
        return true;
      }

      case "/clear":
        console.clear();
        this.renderBanner();
        return true;

      case "/exit":
      case "/quit":
        return false;

      default:
        console.log(pc.red(`Unknown command: ${command}. Type /help for available commands.\n`));
        return true;
    }
  }

  public async start(): Promise<void> {
    this.renderBanner();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      while (true) {
        const input = await rl.question(pc.bold(pc.blue("claw") + pc.cyan(" ❯ ")));
        const trimmed = input.trim();

        if (!trimmed) continue;

        if (trimmed === "exit" || trimmed === "quit") {
          console.log(pc.dim("Exiting CodeForge. Goodbye.\n"));
          break;
        }

        if (/^(npm\s+|npx\s+|cd\s+|node\s+|python\s+|python3\s+)/i.test(trimmed)) {
          console.log(
            pc.yellow(
              `\nNotice: '${trimmed.split(" ")[0]}' is a shell command. You are currently inside the CodeForge interactive agent session.`
            ) +
            pc.dim("\nType '/exit' to return to your normal terminal, or enter an agent task/question.\n")
          );
          continue;
        }

        if (trimmed.startsWith("/")) {
          const keepGoing = await this.handleCommand(trimmed);
          if (!keepGoing) {
            console.log(pc.dim("Exiting CodeForge. Goodbye.\n"));
            break;
          }
          continue;
        }

        console.log("");
        const startTime = Date.now();

        let lastLoggedTurn = 0;
        try {
          const result = await this.loop.run({
            task: trimmed,
            repoRoot: this.repoRoot,
            maxSteps: this.maxSteps,
            resumeSessionId: this.sessionId,
            stream: true,
            onTurn: (step, phase, detail) => {
              if (step !== lastLoggedTurn) {
                console.log(pc.dim(`\nTurn ${step}`));
                lastLoggedTurn = step;
              }
              this.renderTurnDetail(phase, detail);
            },
          });

          this.sessionId = result.sessionId;
          this.turnCount++;
          this.cumulativeTokens.promptTokens += result.totalTokens.promptTokens;
          this.cumulativeTokens.completionTokens += result.totalTokens.completionTokens;
          this.cumulativeTokens.totalTokens += result.totalTokens.totalTokens;

          const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(pc.bold(pc.cyan("\n--- Execution Summary ---")));
          const statusColored =
            result.status === "SUCCESS"
              ? pc.green(result.status)
              : pc.red(result.status);
          console.log(`Status:   ${statusColored}`);
          console.log(`Duration: ${durationSec}s`);
          console.log(
            `Tokens:   ${pc.yellow(result.totalTokens.totalTokens)} (${result.totalTokens.promptTokens} in, ${result.totalTokens.completionTokens} out)`
          );
          if (result.tracePath) {
            console.log(`Trace:    ${pc.dim(result.tracePath)}`);
          }
          console.log(pc.bold("\nResponse:"));
          console.log(result.summary + "\n");
        } catch (err: unknown) {
          console.error(pc.red(`\nTurn error: ${err instanceof Error ? err.message : String(err)}\n`));
        }
      }
    } finally {
      rl.close();
    }
  }
}
