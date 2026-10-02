import path from "node:path";
import fs from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { BenchmarkRunner } from "../benchmarks/runner.ts";
import { ProcessExecutor } from "../src/sandbox/executor.ts";

describe("Benchmark Suite & Target Repositories", () => {
  it("tasks.json should define 15 well-formed tasks across repo-a and repo-b", async () => {
    const runner = new BenchmarkRunner();
    const suite = await runner.loadTasks();

    expect(suite.tasks).toHaveLength(15);
    expect(suite.repositories).toHaveLength(2);

    const repoIds = suite.repositories.map((r) => r.id);
    expect(repoIds).toContain("repo-a");
    expect(repoIds).toContain("repo-b");

    for (const task of suite.tasks) {
      expect(task.id).toMatch(/^task-\d{2}$/);
      expect(["repo-a", "repo-b"]).toContain(task.repoId);
      expect(["bug", "feature", "refactor", "test"]).toContain(task.category);
      expect(task.title.length).toBeGreaterThan(10);
      expect(task.description.length).toBeGreaterThan(20);
      expect(task.maxSteps).toBeGreaterThanOrEqual(10);
    }
  });

  it("repo-a (nano-router) baseline test suite should pass", async () => {
    const repoAPath = path.resolve(__dirname, "../benchmarks/test-repos/repo-a");
    const executor = new ProcessExecutor(repoAPath);
    const res = await executor.execute("node --test test/*.test.js");

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("pass 2");
  });

  it("repo-b (state-flow) baseline test suite should pass", async () => {
    const repoBPath = path.resolve(__dirname, "../benchmarks/test-repos/repo-b");
    const executor = new ProcessExecutor(repoBPath);
    const res = await executor.execute("python3 -m unittest discover tests");

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain("OK");
  });

  it("BenchmarkRunner should generate structured report files", async () => {
    const runner = new BenchmarkRunner();
    await runner.loadTasks();

    const mockResults = [
      {
        taskId: "task-01",
        repoId: "repo-a",
        category: "bug",
        title: "Fix parameter parsing",
        status: "SUCCESS",
        stepCount: 4,
        durationSeconds: 15.2,
        tokens: { prompt: 4000, completion: 200, total: 4200 },
      },
      {
        taskId: "task-09",
        repoId: "repo-b",
        category: "bug",
        title: "Support None payload",
        status: "SUCCESS",
        stepCount: 3,
        durationSeconds: 11.5,
        tokens: { prompt: 3000, completion: 150, total: 3150 },
      },
    ];

    const reportPath = await runner.generateReport(mockResults);
    const content = await fs.readFile(reportPath, "utf-8");

    expect(content).toContain("Benchmark Evaluation Report");
    expect(content).toContain("Passed Tasks**: 2 / 2 (100.0%)");
    expect(content).toContain("task-01");
    expect(content).toContain("task-09");
  });

  it("ABExperimentRunner should format comparative evaluation metrics cleanly", async () => {
    const { ABExperimentRunner } = await import("../benchmarks/experiment-ab.ts");
    const runner = new ABExperimentRunner();

    const mockComparison = {
      taskId: "task-01",
      taskTitle: "Fix parameter parsing",
      designA: {
        status: "SUCCESS",
        steps: 4,
        durationSeconds: 15.2,
        tokens: 4200,
        verifiedPass: true,
      },
      designB: {
        status: "SUCCESS",
        steps: 6,
        durationSeconds: 22.1,
        tokens: 6800,
        verifiedPass: false,
      },
      findings: "Design A successfully passed all tests, while Design B declared completion prematurely without verifying code correctness.",
    };

    // Test writing report
    await (runner as any).writeReport(mockComparison);

    const reportPath = path.resolve(__dirname, "../benchmarks/EXPERIMENT_AB.md");
    const content = await fs.readFile(reportPath, "utf-8");

    expect(content).toContain("Comparative A/B Evaluation Report");
    expect(content).toContain("Design A (CodeForge)");
    expect(content).toContain("Design B (Baseline)");
    expect(content).toContain("Design A Superior");
  });
});
