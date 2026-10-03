import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pc from "picocolors";
import { OpenRouterClient, loadEnvFile } from "../src/provider/client.ts";
import { SandboxJail } from "../src/sandbox/jail.ts";
import { ProcessExecutor } from "../src/sandbox/executor.ts";
import { RollbackManager } from "../src/patch/rollback.ts";
import { allTools } from "../src/tools/index.ts";
import { AgentLoop } from "../src/engine/agent-loop.ts";

loadEnvFile();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

interface TaskDefinition {
  id: string;
  repoId: string;
  category: "bug" | "feature" | "refactor" | "test";
  title: string;
  description: string;
  testTarget: string;
  maxSteps: number;
}

interface BenchmarkSuite {
  version: string;
  benchmarkName: string;
  repositories: Array<{
    id: string;
    name: string;
    language: string;
    path: string;
    testCommand: string;
  }>;
  tasks: TaskDefinition[];
}

export interface TaskBenchmarkResult {
  taskId: string;
  repoId: string;
  category: string;
  title: string;
  status: string;
  stepCount: number;
  durationSeconds: number;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  tracePath?: string;
  error?: string;
}

export class BenchmarkRunner {
  private suiteConfig!: BenchmarkSuite;

  public async loadTasks(): Promise<BenchmarkSuite> {
    const tasksPath = path.join(PROJECT_ROOT, "benchmarks", "tasks.json");
    const raw = await fs.readFile(tasksPath, "utf-8");
    this.suiteConfig = JSON.parse(raw) as BenchmarkSuite;
    return this.suiteConfig;
  }

  public async runTask(
    task: TaskDefinition,
    options: {
      model?: string;
      mode?: "standard" | "baseline";
    } = {}
  ): Promise<TaskBenchmarkResult> {
    const repoMeta = this.suiteConfig.repositories.find((r) => r.id === task.repoId);
    if (!repoMeta) {
      throw new Error(`Repository metadata not found for repoId '${task.repoId}'`);
    }

    const repoPath = path.resolve(PROJECT_ROOT, repoMeta.path);

    // Create isolated backup of repo before task run
    const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), `bench-snap-${task.repoId}-`));
    await fs.cp(repoPath, snapshotDir, { recursive: true });

    const sandbox = new SandboxJail(repoPath);
    const executor = new ProcessExecutor(repoPath);
    const rollback = new RollbackManager(sandbox, executor);
    const client = new OpenRouterClient({ model: options.model });

    const loop = new AgentLoop(client, allTools, { sandbox, executor, rollback });

    const tracesDir = path.join(PROJECT_ROOT, "benchmarks", "traces");
    const startTime = Date.now();

    try {
      const result = await loop.run({
        task: `${task.title}\n\nDetails: ${task.description}\nVerification command: ${repoMeta.testCommand}`,
        repoRoot: repoPath,
        maxSteps: task.maxSteps,
        testCommand: repoMeta.testCommand,
        tracesDir,
        onTurn: (step, phase, detail) => {
          const badge =
            phase === "PLAN"
              ? pc.blue("[PLAN]")
              : phase === "THINK"
                ? pc.magenta("[THINK]")
                : phase === "ACT"
                  ? pc.yellow("[ACT]")
                  : pc.green("[OBSERVE]");
          console.log(`  Step ${step} ${badge} ${detail.slice(0, 100)}`);
        },
      });

      return {
        taskId: task.id,
        repoId: task.repoId,
        category: task.category,
        title: task.title,
        status: result.status,
        stepCount: result.stepCount,
        durationSeconds: parseFloat((result.durationMs / 1000).toFixed(2)),
        tokens: {
          prompt: result.totalTokens.promptTokens,
          completion: result.totalTokens.completionTokens,
          total: result.totalTokens.totalTokens,
        },
        tracePath: result.tracePath,
      };
    } catch (err: unknown) {
      return {
        taskId: task.id,
        repoId: task.repoId,
        category: task.category,
        title: task.title,
        status: "ERROR",
        stepCount: 0,
        durationSeconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(2)),
        tokens: { prompt: 0, completion: 0, total: 0 },
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      // Revert test repo back to pristine baseline from snapshot
      try {
        await fs.rm(repoPath, { recursive: true, force: true });
        await fs.cp(snapshotDir, repoPath, { recursive: true });
        await fs.rm(snapshotDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
  }

  public async generateReport(results: TaskBenchmarkResult[]): Promise<string> {
    const totalTasks = results.length;
    const passedTasks = results.filter((r) => r.status === "SUCCESS").length;
    const passRate = totalTasks > 0 ? ((passedTasks / totalTasks) * 100).toFixed(1) : "0";

    const totalTokens = results.reduce((acc, r) => acc + r.tokens.total, 0);
    const avgTokens = totalTasks > 0 ? Math.round(totalTokens / totalTasks) : 0;
    const totalDuration = results.reduce((acc, r) => acc + r.durationSeconds, 0);
    const avgDuration = totalTasks > 0 ? (totalDuration / totalTasks).toFixed(1) : "0";

    const lines: string[] = [
      `# Benchmark Evaluation Report: InductionHarness (CodeForge)`,
      ``,
      `## Executive Summary`,
      `- **Total Evaluated Tasks**: ${totalTasks}`,
      `- **Passed Tasks**: ${passedTasks} / ${totalTasks} (${passRate}%)`,
      `- **Average Duration per Task**: ${avgDuration}s`,
      `- **Average Tokens per Task**: ${avgTokens}`,
      `- **Total Benchmark Tokens**: ${totalTokens}`,
      ``,
      `## Detailed Task Breakdown`,
      `| Task ID | Repo | Category | Title | Status | Steps | Duration | Tokens |`,
      `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`,
    ];

    for (const r of results) {
      const statusBadge = r.status === "SUCCESS" ? "PASS" : r.status;
      lines.push(
        `| \`${r.taskId}\` | ${r.repoId} | ${r.category} | ${r.title} | **${statusBadge}** | ${r.stepCount} | ${r.durationSeconds}s | ${r.tokens.total} |`
      );
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated autonomously by InductionHarness Benchmark Suite on ${new Date().toISOString()}*`);

    const reportContent = lines.join("\n");
    const reportPath = path.join(PROJECT_ROOT, "benchmarks", "REPORT.md");
    await fs.writeFile(reportPath, reportContent, "utf-8");

    const jsonPath = path.join(PROJECT_ROOT, "benchmarks", "results.json");
    await fs.writeFile(jsonPath, JSON.stringify(results, null, 2), "utf-8");

    return reportPath;
  }
}

// CLI entry point
const program = new Command();

program
  .name("benchmark-runner")
  .description("Execute InductionHarness 15-task benchmark suite")
  .option("--task <id>", "Execute single task ID (e.g. task-01)")
  .option("--limit <n>", "Limit execution to first N tasks")
  .option("--model <model>", "OpenRouter model override")
  .action(async (options) => {
    try {
      const runner = new BenchmarkRunner();
      const suite = await runner.loadTasks();

      let targetTasks = suite.tasks;
      if (options.task) {
        targetTasks = suite.tasks.filter((t) => t.id === options.task);
        if (targetTasks.length === 0) {
          console.error(pc.red(`Task '${options.task}' not found in tasks.json.`));
          process.exit(1);
        }
      } else if (options.limit) {
        targetTasks = suite.tasks.slice(0, parseInt(options.limit, 10));
      }

      console.log(pc.bold(pc.cyan(`\n=== Running InductionHarness Benchmark Suite (${targetTasks.length} tasks) ===\n`)));

      const results: TaskBenchmarkResult[] = [];

      for (let i = 0; i < targetTasks.length; i++) {
        const task = targetTasks[i];
        console.log(pc.bold(`\n[${i + 1}/${targetTasks.length}] Task ${task.id}: ${task.title} (${task.repoId})`));

        const res = await runner.runTask(task, { model: options.model });
        results.push(res);

        const statusColor = res.status === "SUCCESS" ? pc.green : pc.red;
        console.log(`Result: ${statusColor(res.status)} | Steps: ${res.stepCount} | Time: ${res.durationSeconds}s | Tokens: ${res.tokens.total}`);
      }

      const reportPath = await runner.generateReport(results);
      console.log(pc.bold(pc.green(`\nBenchmark complete! Report saved to: ${reportPath}\n`)));
    } catch (err: unknown) {
      console.error(pc.red(`\nBenchmark runner error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

if (process.argv[1] && process.argv[1].endsWith("runner.ts")) {
  program.parse(process.argv);
}
