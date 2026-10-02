import path from "node:path";
import crypto from "node:crypto";
import type { OpenRouterClient } from "../provider/client.ts";
import type { ChatMessage, TokenUsage } from "../provider/types.ts";
import type { AnyAgentTool, ToolExecutionContext } from "../tools/base.ts";
import { zodToJsonSchema } from "../tools/base.ts";
import { RepoMapper } from "../context/repo-map.ts";
import { LoopDetector } from "./loop-detector.ts";
import { RunTracer, type ToolExecutionRecord } from "../telemetry/tracer.ts";
import { SessionStateManager } from "./state.ts";

export interface AgentRunOptions {
  task: string;
  repoRoot: string;
  maxSteps?: number;
  testCommand?: string;
  tracesDir?: string;
  sessionId?: string;
  onTurn?: (step: number, phase: string, detail: string) => void;
}

export interface AgentRunResult {
  status: "SUCCESS" | "FAILED" | "MAX_STEPS_EXCEEDED" | "CYCLE_DETECTED" | "ABORTED";
  stepCount: number;
  totalTokens: TokenUsage;
  durationMs: number;
  summary: string;
  tracePath?: string;
  sessionId: string;
}

export class AgentLoop {
  private readonly client: OpenRouterClient;
  private readonly tools: Map<string, AnyAgentTool>;
  private readonly ctx: ToolExecutionContext;

  constructor(client: OpenRouterClient, tools: AnyAgentTool[], ctx: ToolExecutionContext) {
    this.client = client;
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.ctx = ctx;
  }

  public async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const startTime = Date.now();
    const maxSteps = options.maxSteps ?? 15;
    let stepCount = 0;
    const tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const sessionId = options.sessionId ?? crypto.randomBytes(4).toString("hex");

    const tracesDirectory = options.tracesDir ?? path.join(options.repoRoot, "traces");
    const tracer = new RunTracer(tracesDirectory);
    tracer.startRun(options.task, options.repoRoot);

    const stateManager = new SessionStateManager(options.repoRoot);
    const loopDetector = new LoopDetector(3, 4);

    // Initial files & symbol architecture map
    const mapper = new RepoMapper(options.repoRoot);
    const repoMap = await mapper.buildMap();

    const systemPrompt = `You are CodeForge, an autonomous repository-aware coding agent.
You solve coding tasks by executing structured tools, applying targeted patches, and running tests.

Available tools:
- list_dir: list files/directories with depth control.
- file_search: find files matching a name/pattern.
- grep_search: search regex or text across files.
- read_file: inspect file contents with line ranges (conserve tokens!).
- write_file: create a new file or write complete content.
- apply_patch: targeted search-and-replace for specific code blocks.
- run_command: execute shell commands (e.g. tests or build) inside the repo.
- git_status: view modified and untracked files.
- git_diff: view working tree changes.
- git_restore: revert uncommitted changes if an edit breaks tests.

Rules:
1. Always read relevant lines before patching.
2. Use 'apply_patch' with exact existing lines as search_block.
3. After making changes, ALWAYS run the test command to verify.
4. When all tests pass and the task is solved, output a final message stating task complete.
Be concise. Do not waste tokens with conversational fluff.`;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Task: ${options.task}

Target Repository Architecture Map:
${repoMap}

Inspect the files, plan the fix, apply targeted patches, run tests, and verify completion.`,
      },
    ];

    const toolDeclarations = Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.schema),
    }));

    let verified = false;

    while (stepCount < maxSteps) {
      stepCount++;
      options.onTurn?.(stepCount, "PLAN", "Consulting model...");

      // Prune history if it exceeds 10 turns to save tokens
      this.pruneHistoryToSaveTokens(messages);

      const response = await this.client.complete(messages, toolDeclarations);

      tokenUsage.promptTokens += response.usage.promptTokens;
      tokenUsage.completionTokens += response.usage.completionTokens;
      tokenUsage.totalTokens += response.usage.totalTokens;
      tracer.updateTokenUsage(tokenUsage);

      if (response.content) {
        options.onTurn?.(stepCount, "THINK", response.content);
        messages.push({ role: "assistant", content: response.content });
      }

      // If no tool calls, check if task is complete
      if (response.toolCalls.length === 0) {
        const modifiedFiles = this.ctx.rollback.getModifiedFiles();
        if (verified && modifiedFiles.length > 0) {
          const summary = response.content || "Task verified and completed successfully.";
          tracer.recordStep({
            stepNumber: stepCount,
            phase: "STOP",
            thought: summary,
          });
          const tracePath = await tracer.completeRun("SUCCESS", summary, modifiedFiles);
          await stateManager.save({
            sessionId,
            task: options.task,
            repoRoot: options.repoRoot,
            stepCount,
            status: "SUCCESS",
            messages,
            modifiedFiles,
            totalTokens: tokenUsage,
            updatedAt: new Date().toISOString(),
          });

          return {
            status: "SUCCESS",
            stepCount,
            totalTokens: tokenUsage,
            durationMs: Date.now() - startTime,
            summary,
            tracePath,
            sessionId,
          };
        }

        if (modifiedFiles.length === 0) {
          messages.push({
            role: "user",
            content:
              "No code changes have been applied yet. Please inspect the relevant files, apply the required changes using 'apply_patch' or 'write_file', and then verify with 'run_command'.",
          });
        } else {
          messages.push({
            role: "user",
            content:
              "Verification required: Code changes were made, but you have not yet verified them by running the test suite. Please execute the test command via 'run_command'.",
          });
        }
        continue;
      }

      // Check for cycles and execute tool calls
      const toolRecords: ToolExecutionRecord[] = [];

      for (const call of response.toolCalls) {
        // Cycle check
        const loopCheck = loopDetector.recordCall(call.name, call.arguments);
        if (loopCheck.status === "ABORT") {
          const summary = loopCheck.message ?? "Loop cycle detected. Execution aborted.";
          options.onTurn?.(stepCount, "STOP", summary);

          tracer.recordStep({
            stepNumber: stepCount,
            phase: "STOP",
            thought: summary,
          });

          const tracePath = await tracer.completeRun(
            "CYCLE_DETECTED",
            summary,
            this.ctx.rollback.getModifiedFiles()
          );

          await stateManager.save({
            sessionId,
            task: options.task,
            repoRoot: options.repoRoot,
            stepCount,
            status: "CYCLE_DETECTED",
            messages,
            modifiedFiles: this.ctx.rollback.getModifiedFiles(),
            totalTokens: tokenUsage,
            updatedAt: new Date().toISOString(),
          });

          return {
            status: "CYCLE_DETECTED",
            stepCount,
            totalTokens: tokenUsage,
            durationMs: Date.now() - startTime,
            summary,
            tracePath,
            sessionId,
          };
        }

        if (loopCheck.status === "WARN") {
          messages.push({
            role: "user",
            content: loopCheck.message ?? "Loop warning: repeating identical tool calls.",
          });
        }

        options.onTurn?.(stepCount, "ACT", `${call.name}(${JSON.stringify(call.arguments)})`);

        const tool = this.tools.get(call.name);
        let toolOutput: string;
        const toolStart = Date.now();

        if (!tool) {
          toolOutput = `Error: Unknown tool '${call.name}'. Available: ${Array.from(this.tools.keys()).join(", ")}`;
        } else {
          try {
            const parsed = tool.schema.parse(call.arguments);
            toolOutput = await tool.execute(parsed, this.ctx);

            // Invalidate verification on new edits
            if (call.name === "apply_patch" || call.name === "write_file") {
              if (toolOutput.includes("Successfully")) {
                verified = false;
              }
            }

            // Mark verified only if tests pass after modifications
            if (call.name === "run_command" && toolOutput.includes("exit code 0")) {
              if (this.ctx.rollback.getModifiedFiles().length > 0) {
                verified = true;
              }
            }
          } catch (err: unknown) {
            toolOutput = `Tool execution error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        const toolDuration = Date.now() - toolStart;
        toolRecords.push({
          tool: call.name,
          arguments: call.arguments,
          output: toolOutput,
          durationMs: toolDuration,
        });

        options.onTurn?.(stepCount, "OBSERVE", toolOutput);

        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            },
          ],
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: toolOutput,
        });
      }

      tracer.recordStep({
        stepNumber: stepCount,
        phase: "ACT",
        thought: response.content ?? undefined,
        toolCalls: toolRecords,
        tokens: {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
        },
      });

      // Periodic state checkpointing
      await stateManager.save({
        sessionId,
        task: options.task,
        repoRoot: options.repoRoot,
        stepCount,
        status: "IN_PROGRESS",
        messages,
        modifiedFiles: this.ctx.rollback.getModifiedFiles(),
        totalTokens: tokenUsage,
        updatedAt: new Date().toISOString(),
      });
    }

    const summary = `Halted: Step limit of ${maxSteps} reached.`;
    const tracePath = await tracer.completeRun(
      "MAX_STEPS_EXCEEDED",
      summary,
      this.ctx.rollback.getModifiedFiles()
    );

    await stateManager.save({
      sessionId,
      task: options.task,
      repoRoot: options.repoRoot,
      stepCount,
      status: "MAX_STEPS_EXCEEDED",
      messages,
      modifiedFiles: this.ctx.rollback.getModifiedFiles(),
      totalTokens: tokenUsage,
      updatedAt: new Date().toISOString(),
    });

    return {
      status: "MAX_STEPS_EXCEEDED",
      stepCount,
      totalTokens: tokenUsage,
      durationMs: Date.now() - startTime,
      summary,
      tracePath,
      sessionId,
    };
  }

  private pruneHistoryToSaveTokens(messages: ChatMessage[]): void {
    if (messages.length <= 12) return;

    // Retain system prompt (index 0) and original task (index 1)
    // Replace old intermediate tool outputs with concise summaries
    for (let i = 2; i < messages.length - 4; i++) {
      const msg = messages[i];
      if (msg.role === "tool" && msg.content && msg.content.length > 300) {
        msg.content = msg.content.slice(0, 200) + "\n[... intermediate output pruned to conserve tokens ...]";
      }
    }
  }
}
