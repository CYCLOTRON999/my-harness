import path from "node:path";
import crypto from "node:crypto";
import type { OpenRouterClient } from "../provider/client.ts";
import type { ChatMessage, TokenUsage } from "../provider/types.ts";
import type { AnyAgentTool, ToolExecutionContext } from "../tools/base.ts";
import { zodToJsonSchema } from "../tools/base.ts";
import { RepoMapper } from "../context/repo-map.ts";
import { ContextSelector } from "../context/selector.ts";
import { LoopDetector } from "./loop-detector.ts";
import { RunTracer, type ToolExecutionRecord } from "../telemetry/tracer.ts";
import { SessionStateManager } from "./state.ts";
import { buildSystemPrompt, loadProjectContextFiles } from "./system-prompt.ts";

export interface AgentRunOptions {
  task: string;
  repoRoot: string;
  maxSteps?: number;
  testCommand?: string;
  tracesDir?: string;
  sessionId?: string;
  resumeSessionId?: string;
  disableRepoMap?: boolean;
  skipVerificationGate?: boolean;
  customPrompt?: string;
  appendSystemPrompt?: string;
  stream?: boolean;
  onChunk?: (chunk: string) => void;
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

export function isVerificationCommand(command: string, testCommand?: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (testCommand) {
    const exp = testCommand.trim().toLowerCase();
    if (normalized.includes(exp) || exp.includes(normalized)) {
      return true;
    }
  }
  const testPatterns = [
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/,
    /\b(node|bun)\s+(--test|--test-only)\b/,
    /\b(pytest|py\.test)\b/,
    /\bpython\d*\s+-m\s+unittest\b/,
    /\b(vitest|jest|mocha|ava)\b/,
    /\b(cargo\s+test|go\s+test)\b/,
  ];
  return testPatterns.some((pattern) => pattern.test(normalized));
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
    let stepsThisRun = 0;
    const tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let sessionId = options.sessionId ?? crypto.randomBytes(4).toString("hex");
    const stateManager = new SessionStateManager(options.repoRoot);
    let messages: ChatMessage[] = [];

    if (options.resumeSessionId) {
      const saved = await stateManager.load(options.resumeSessionId);
      if (saved) {
        sessionId = saved.sessionId;
        stepCount = saved.stepCount;
        tokenUsage.promptTokens = saved.totalTokens.promptTokens;
        tokenUsage.completionTokens = saved.totalTokens.completionTokens;
        tokenUsage.totalTokens = saved.totalTokens.totalTokens;
        messages = [...saved.messages, { role: "user", content: `Follow-up task: ${options.task}` }];
      }
    }

    const tracesDirectory = options.tracesDir ?? path.join(options.repoRoot, "traces");
    const tracer = new RunTracer(tracesDirectory);
    tracer.startRun(options.task, options.repoRoot);

    const loopDetector = new LoopDetector(3, 4);

    const greeting = isGreeting(options.task);

    // Initial files & symbol architecture map using ContextSelector
    let repoMapSection = "";
    if (!options.disableRepoMap && !greeting) {
      const mapper = new RepoMapper(options.repoRoot);
      const outlines = await mapper.getOutlines(50);
      const selector = new ContextSelector();
      const ranked = selector.rankFiles(options.task, outlines);

      const mapContent = ranked.length > 0
        ? mapper.buildTargetedMap(outlines, ranked, 8)
        : await mapper.buildMap(25);

      repoMapSection = mapContent;
    }

    // Load project-specific context files (AGENTS.md, CLAUDE.md)
    const contextFiles = loadProjectContextFiles(options.repoRoot);
    if (repoMapSection) {
      contextFiles.push({
        path: "Target Repository Architecture",
        content: repoMapSection.trim(),
      });
    }

    const testCmdInstruction = options.testCommand
      ? `Verification test command: '${options.testCommand}'. You must execute this command via 'run_command' after making code modifications.`
      : undefined;

    const appendSystemPrompt = [options.appendSystemPrompt, testCmdInstruction]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join("\n\n");

    const systemPrompt = buildSystemPrompt({
      cwd: options.repoRoot,
      customPrompt: options.customPrompt,
      appendSystemPrompt: appendSystemPrompt || undefined,
      selectedTools: Array.from(this.tools.keys()),
      contextFiles,
    });

    const isReadOnly = this.isReadOnlyTask(options.task);

    if (messages.length === 0) {
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: options.task },
      ];
    }

    if (greeting) {
      const greetingResponse =
        "Hello! I am ready to help you inspect, query, or edit this repository. What task would you like to run?";
      options.onTurn?.(1, "STOP", greetingResponse);
      tracer.recordStep({
        stepNumber: 1,
        phase: "STOP",
        thought: greetingResponse,
      });
      const tracePath = await tracer.completeRun("SUCCESS", greetingResponse, []);
      await stateManager.save({
        sessionId,
        task: options.task,
        repoRoot: options.repoRoot,
        stepCount: 1,
        status: "SUCCESS",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: options.task },
          { role: "assistant", content: greetingResponse },
        ],
        modifiedFiles: [],
        totalTokens: tokenUsage,
        updatedAt: new Date().toISOString(),
      });

      return {
        status: "SUCCESS",
        stepCount: 1,
        totalTokens: tokenUsage,
        durationMs: Date.now() - startTime,
        summary: greetingResponse,
        tracePath,
        sessionId,
      };
    }

    const toolDeclarations = Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.schema),
    }));

    let verified = false;
    let unmodifiedNudgeCount = 0;
    const readHistory = new Set<string>();

    while (stepsThisRun < maxSteps) {
      stepsThisRun++;
      stepCount++;
      options.onTurn?.(stepsThisRun, "PLAN", "Consulting model...");

      // Prune history to save tokens and compact turn 1 repo map
      this.pruneHistoryToSaveTokens(messages, stepsThisRun);

      const response = await this.client.complete(messages, toolDeclarations, {
        stream: options.stream,
        onChunk: options.onChunk,
      });

      tokenUsage.promptTokens += response.usage.promptTokens;
      tokenUsage.completionTokens += response.usage.completionTokens;
      tokenUsage.totalTokens += response.usage.totalTokens;
      tracer.updateTokenUsage(tokenUsage);

      if (response.content) {
        options.onTurn?.(stepsThisRun, "THINK", response.content);
      }

      // If no tool calls, check if task is complete
      if (response.toolCalls.length === 0) {
        if (response.content) {
          messages.push({ role: "assistant", content: response.content });
        }
        const modifiedFiles = this.ctx.rollback.getModifiedFiles();
        const contentStr = (response.content || "").trim();
        const isGenericComplete = /^\s*(task\s+complete(d)?\.?|all\s+tasks?\s+complete(d)?\.?)\s*$/i.test(contentStr);
        const isExplicitComplete = /\b(task\s+complete(d)?|all\s+tasks?\s+complete(d)?|investigation\s+complete(d)?|question\s+answered)\b/i.test(
          contentStr
        );

        // If it is a question or read-only task and the model returned generic "Task completed." or empty, nudge for the actual answer
        if (isReadOnly && modifiedFiles.length === 0 && (isGenericComplete || !contentStr) && unmodifiedNudgeCount < 1) {
          unmodifiedNudgeCount++;
          messages.push({
            role: "user",
            content: `Please provide the specific factual answer to the user's question: "${options.task}". State the exact numbers, counts, or findings directly rather than a generic completion message.`,
          });
          continue;
        }

        if (
          options.skipVerificationGate ||
          (verified && modifiedFiles.length > 0) ||
          (isReadOnly && modifiedFiles.length === 0) ||
          (isExplicitComplete && modifiedFiles.length === 0) ||
          (unmodifiedNudgeCount >= 1 && modifiedFiles.length === 0)
        ) {
          const summary = response.content && response.content.trim() ? response.content.trim() : "Task completed.";
          options.onTurn?.(stepsThisRun, "STOP", summary);
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
            stepCount: stepsThisRun,
            totalTokens: tokenUsage,
            durationMs: Date.now() - startTime,
            summary,
            tracePath,
            sessionId,
          };
        }

        if (modifiedFiles.length === 0) {
          unmodifiedNudgeCount++;
          messages.push({
            role: "user",
            content:
              "No code changes have been applied yet. If this task requires code changes, please inspect the relevant files, apply the required changes using 'apply_patch' or 'write_file', and then verify with 'run_command'. If no code changes are required, provide your final direct answer with all facts and findings.",
          });
        } else {
          const verifyHint = options.testCommand ? ` '${options.testCommand}'` : "";
          messages.push({
            role: "user",
            content: `Verification required: Code changes were made, but you have not yet verified them by running the test suite${verifyHint}. Please execute the test command via 'run_command'.`,
          });
        }
        continue;
      }

      // Filter duplicate identical tool calls within the same turn
      const seenInTurn = new Set<string>();
      const callsToExecute = response.toolCalls.filter((call) => {
        const key = `${call.name}:${JSON.stringify(call.arguments)}`;
        if (seenInTurn.has(key)) return false;
        seenInTurn.add(key);
        return true;
      }).slice(0, 5); // Max 5 distinct tool calls per turn

      // Single assistant message declaring content and all executed tool calls (OpenAI spec compliant)
      messages.push({
        role: "assistant",
        content: response.content ?? null,
        tool_calls: callsToExecute.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
          ...(call.extra_content ? { extra_content: call.extra_content } : {}),
        })),
      });

      const toolRecords: ToolExecutionRecord[] = [];

      for (const call of callsToExecute) {
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

        const normalizedCall = normalizeToolCall(call);
        options.onTurn?.(stepCount, "ACT", `${normalizedCall.name}(${JSON.stringify(normalizedCall.arguments)})`);

        const tool = this.tools.get(normalizedCall.name) ?? this.tools.get(call.name);
        let toolOutput: string;
        const toolStart = Date.now();

        if (!tool) {
          toolOutput = `Error: Unknown tool '${call.name}'. Available: ${Array.from(this.tools.keys()).join(", ")}`;
        } else {
          try {
            const parsed = tool.schema.parse(normalizedCall.arguments);

            if (normalizedCall.name === "read_file") {
              const rArgs = parsed as { path: string; start_line?: number; end_line?: number };
              const rKey = `${rArgs.path}:${rArgs.start_line ?? 1}:${rArgs.end_line ?? ""}`;
              const modifiedFiles = this.ctx.rollback.getModifiedFiles();
              if (readHistory.has(rKey) && !modifiedFiles.includes(rArgs.path)) {
                toolOutput = `[Notice: You have already read lines ${rArgs.start_line ?? 1}-${rArgs.end_line ?? "end"} of '${rArgs.path}'. The file has not been modified since. Proceed with your response or code edits without re-reading.]`;
              } else {
                readHistory.add(rKey);
                toolOutput = await tool.execute(parsed, this.ctx);
              }
            } else {
              toolOutput = await tool.execute(parsed, this.ctx);
            }

            // Invalidate verification on new edits and clear cached reads for modified file
            if (normalizedCall.name === "apply_patch" || normalizedCall.name === "write_file") {
              if (toolOutput.includes("Successfully")) {
                verified = false;
                const pArgs = parsed as { path: string };
                for (const key of Array.from(readHistory.keys())) {
                  if (key.startsWith(`${pArgs.path}:`)) {
                    readHistory.delete(key);
                  }
                }
              }
            }

            // Mark verified only if actual test suite passes after modifications
            if (normalizedCall.name === "run_command" && toolOutput.includes("exit code 0")) {
              const cmd = typeof normalizedCall.arguments.command === "string" ? normalizedCall.arguments.command : "";
              if (isVerificationCommand(cmd, options.testCommand) && this.ctx.rollback.getModifiedFiles().length > 0) {
                verified = true;
              }
            }
          } catch (err: unknown) {
            toolOutput = `Tool execution error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        const toolDuration = Date.now() - toolStart;
        toolRecords.push({
          tool: normalizedCall.name,
          arguments: normalizedCall.arguments,
          output: toolOutput,
          durationMs: toolDuration,
        });

        options.onTurn?.(stepsThisRun, "OBSERVE", toolOutput);

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
      stepCount: stepsThisRun,
      totalTokens: tokenUsage,
      durationMs: Date.now() - startTime,
      summary,
      tracePath,
      sessionId,
    };
  }

  private pruneHistoryToSaveTokens(messages: ChatMessage[], stepCount: number): void {
    // 1. After turn 1, compact the initial repository architecture map in system prompt
    if (stepCount >= 2 && messages.length >= 1 && messages[0].role === "system") {
      const content = messages[0].content;
      if (typeof content === "string" && content.includes("<project_context>")) {
        messages[0].content = content.replace(
          /<project_context>[\s\S]*?<\/project_context>/,
          "<project_context>\n[Target repository architecture map provided on turn 1. Context focused on active files.]\n</project_context>"
        );
      }
    }

    if (messages.length <= 8) return;

    // 2. Prune old intermediate tool outputs older than the last 4 messages
    for (let i = 2; i < messages.length - 4; i++) {
      const msg = messages[i];
      if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > 250) {
        msg.content = msg.content.slice(0, 150) + "\n[... intermediate output pruned to conserve tokens ...]";
      }
    }
  }

  private isReadOnlyTask(task: string): boolean {
    return isReadOnlyTask(task);
  }
}

export function normalizeToolCall(call: { name: string; arguments: Record<string, unknown> }): {
  name: string;
  arguments: Record<string, unknown>;
} {
  const name = call.name.toLowerCase();
  const raw = { ...call.arguments };

  if (name === "read" || name === "read_file") {
    const offset = typeof raw.offset === "number" ? raw.offset : (raw.start_line as number | undefined);
    const limit = typeof raw.limit === "number" ? raw.limit : undefined;
    const endLine =
      typeof raw.end_line === "number"
        ? raw.end_line
        : offset && limit
        ? offset + limit - 1
        : limit;
    return {
      name: "read_file",
      arguments: {
        path: String(raw.path ?? ""),
        start_line: offset,
        end_line: endLine,
      },
    };
  }

  if (name === "bash" || name === "run_command") {
    const timeout =
      typeof raw.timeout === "number"
        ? raw.timeout * 1000
        : (raw.timeout_ms as number | undefined);
    return {
      name: "run_command",
      arguments: {
        command: String(raw.command ?? ""),
        timeout_ms: timeout,
      },
    };
  }

  if (name === "edit" || name === "apply_patch") {
    let searchBlock = typeof raw.search_block === "string" ? raw.search_block : "";
    let replaceBlock = typeof raw.replace_block === "string" ? raw.replace_block : "";

    if (Array.isArray(raw.edits) && raw.edits.length > 0) {
      const firstEdit = raw.edits[0] as { oldText?: string; newText?: string };
      searchBlock = firstEdit.oldText ?? "";
      replaceBlock = firstEdit.newText ?? "";
    } else if (typeof raw.oldText === "string") {
      searchBlock = raw.oldText;
      replaceBlock = typeof raw.newText === "string" ? raw.newText : "";
    }

    return {
      name: "apply_patch",
      arguments: {
        path: String(raw.path ?? ""),
        search_block: searchBlock,
        replace_block: replaceBlock,
      },
    };
  }

  if (name === "write" || name === "write_file") {
    return {
      name: "write_file",
      arguments: {
        path: String(raw.path ?? ""),
        content: String(raw.content ?? ""),
      },
    };
  }

  if (name === "grep" || name === "grep_search") {
    return {
      name: "grep_search",
      arguments: {
        query: String(raw.pattern ?? raw.query ?? ""),
        path: raw.path ? String(raw.path) : undefined,
        case_sensitive: typeof raw.case_sensitive === "boolean" ? raw.case_sensitive : undefined,
      },
    };
  }

  if (name === "find" || name === "file_search") {
    return {
      name: "file_search",
      arguments: {
        pattern: String(raw.pattern ?? ""),
        path: raw.path ? String(raw.path) : undefined,
      },
    };
  }

  if (name === "ls" || name === "list_dir") {
    return {
      name: "list_dir",
      arguments: {
        path: raw.path ? String(raw.path) : undefined,
        max_depth: typeof raw.max_depth === "number" ? raw.max_depth : undefined,
      },
    };
  }

  return { name: call.name, arguments: raw };
}

export function isGreeting(task: string): boolean {
  const normalized = task.trim().toLowerCase().replace(/[!?.,;]+$/, "");
  return /^(hi|hey|hello|hy|yo|sup|wassup|what's\s+up|whats\s+up|howdy|how\s+are\s+you|how\s+r\s+u|good\s+(morning|afternoon|evening)|hi\s+there|hey\s+there|hy\s+bro|hey\s+bro|hello\s+bro|thanks|thank\s+you)$/i.test(
    normalized
  );
}

export function isReadOnlyTask(task: string): boolean {
  if (isGreeting(task)) return false;
  const normalized = task.toLowerCase();
  const editKeywords = [
    "fix",
    "add",
    "implement",
    "update",
    "create",
    "modify",
    "patch",
    "refactor",
    "write",
    "delete",
    "remove",
    "change",
    "build",
  ];

  const hasEdit = editKeywords.some((k) => {
    const regex = new RegExp(`\\b${k}\\b`, "i");
    return regex.test(normalized);
  });

  if (hasEdit) return false;

  if (normalized.includes("?")) return true;

  const queryKeywords = [
    "inspect",
    "summarize",
    "summary",
    "overview",
    "explain",
    "describe",
    "what",
    "how",
    "hw",
    "why",
    "who",
    "which",
    "where",
    "when",
    "audit",
    "review",
    "analyze",
    "find",
    "search",
    "explore",
    "count",
    "list",
    "show",
    "tell",
    "check",
    "does",
  ];

  const hasQuery = queryKeywords.some((k) => {
    const regex = new RegExp(`\\b${k}\\b`, "i");
    return regex.test(normalized);
  });

  if (hasQuery) return true;

  if (/\b(ins|info|help|stat|status|desc)\b/i.test(normalized)) {
    return true;
  }

  if (normalized.trim().length <= 6 && !hasEdit) {
    return true;
  }

  if (/\b(give me a summary|what is this|tell me about|how it works)\b/i.test(normalized)) {
    return true;
  }
  return false;
}
