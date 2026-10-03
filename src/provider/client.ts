import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatMessage, LlmResponse, ToolCall, ToolDeclaration } from "./types.ts";

export interface LlmClientConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fallbackApiKey?: string;
  fallbackModel?: string;
  fallbackBaseUrl?: string;
}

export function loadEnvFile(extraDir?: string): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const harnessRoot = path.resolve(currentDir, "../..");
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(harnessRoot, ".env"),
    extraDir ? path.join(extraDir, ".env") : "",
    path.resolve(process.cwd(), "inductionharness/.env"),
  ].filter(Boolean);

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // Ignore unreadable .env
      }
      break;
    }
  }
}

function isGenericCompletion(text: string): boolean {
  return /^\s*(task\s+complete(d)?\.?|all\s+tasks?\s+complete(d)?\.?)\s*$/i.test(text);
}

export class OpenRouterClient {
  private static isOpenRouterExhausted = false;
  private static readonly exhaustedGeminiModels = new Set<string>();

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly geminiApiKey: string;
  private geminiModel: string;
  private readonly geminiBaseUrl: string;
  private activeFallback = false;

  constructor(config: LlmClientConfig = {}) {
    loadEnvFile();

    this.apiKey =
      config.apiKey ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "";

    this.geminiApiKey =
      config.fallbackApiKey ||
      process.env.GEMINI_API_KEY ||
      "";

    if (!this.apiKey && !this.geminiApiKey) {
      throw new Error(
        "Missing API key. Set OPENROUTER_API_KEY or GEMINI_API_KEY in your environment or pass --api-key."
      );
    }

    this.model = config.model || process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
    this.baseUrl = config.baseUrl || "https://openrouter.ai/api/v1/chat/completions";
    this.geminiModel = config.fallbackModel || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    this.geminiBaseUrl =
      config.fallbackBaseUrl ||
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  }

  public getModel(): string {
    return this.model;
  }

  public async complete(
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    options?: { stream?: boolean; onChunk?: (chunk: string) => void }
  ): Promise<LlmResponse> {
    const formattedTools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Direct routing to Gemini if selected model is a gemini model, fallback is active, or OpenRouter quota is exhausted
    if (
      (this.activeFallback || OpenRouterClient.isOpenRouterExhausted || this.model.startsWith("gemini-")) &&
      this.geminiApiKey
    ) {
      return await this.completeWithGemini(messages, formattedTools, options);
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.1, // Low temperature for deterministic code generation
    };

    if (formattedTools.length > 0) {
      payload.tools = formattedTools;
      payload.tool_choice = "auto";
    }

    const useStreaming = Boolean(options?.stream || options?.onChunk);
    if (useStreaming) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }

    let retries = 5;
    let delayMs = 1500;

    while (retries > 0) {
      try {
        const response = await fetch(this.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "HTTP-Referer": "https://github.com/CYCLOTRON999/my-harness",
            "X-Title": "CodeForge-InductionHarness",
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 429) {
          const errText = await response.text().catch(() => "");
          if (this.geminiApiKey) {
            this.activeFallback = true;
            OpenRouterClient.isOpenRouterExhausted = true;
            console.warn(
              `[Provider] OpenRouter rate limit hit (${errText.slice(0, 70)}). Automatically switching to Gemini fallback (${this.geminiModel})...`
            );
            return await this.completeWithGemini(messages, formattedTools, options);
          }

          const retryAfterSec = parseInt(response.headers.get("retry-after") ?? "", 10);
          const waitTimeMs = !isNaN(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : delayMs;
          retries--;
          console.warn(`[OpenRouter] Rate limited (429): ${errText.slice(0, 100) || "Rate limit reached"}. Retrying in ${waitTimeMs}ms...`);
          await new Promise((r) => setTimeout(r, waitTimeMs));
          delayMs = Math.min(delayMs * 2, 30000);
          continue;
        }

        if (response.status === 402 && this.geminiApiKey) {
          const errText = await response.text().catch(() => "");
          this.activeFallback = true;
          OpenRouterClient.isOpenRouterExhausted = true;
          console.warn(
            `[Provider] OpenRouter credits exhausted (${errText.slice(0, 70)}). Automatically switching to Gemini fallback (${this.geminiModel})...`
          );
          return await this.completeWithGemini(messages, formattedTools, options);
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
        }

        if (payload.stream && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8");
          let buffer = "";
          let accumulatedContent = "";
          let accumulatedReasoning = "";
          const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
          let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(":")) continue;
              if (trimmed === "data: [DONE]") continue;
              if (trimmed.startsWith("data: ")) {
                try {
                  const json = JSON.parse(trimmed.slice(6));
                  if (json.usage) {
                    usage = {
                      promptTokens: json.usage.prompt_tokens ?? usage.promptTokens,
                      completionTokens: json.usage.completion_tokens ?? usage.completionTokens,
                      totalTokens: json.usage.total_tokens ?? usage.totalTokens,
                    };
                  }
                  const delta = json.choices?.[0]?.delta;
                  if (delta?.content) {
                    accumulatedContent += delta.content;
                    options?.onChunk?.(delta.content);
                  }
                  const deltaReasoning = delta?.reasoning ?? delta?.reasoning_content;
                  if (typeof deltaReasoning === "string" && deltaReasoning) {
                    accumulatedReasoning += deltaReasoning;
                  }
                  if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                      const idx = tc.index ?? 0;
                      const current = toolCallsMap.get(idx) ?? { id: "", name: "", arguments: "" };
                      if (tc.id) current.id = tc.id;
                      if (tc.function?.name) current.name += tc.function.name;
                      if (tc.function?.arguments) current.arguments += tc.function.arguments;
                      toolCallsMap.set(idx, current);
                    }
                  }
                } catch {
                  // Ignore JSON parse errors on malformed chunks
                }
              }
            }
          }

          const toolCalls: ToolCall[] = [];
          for (const entry of Array.from(toolCallsMap.values())) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(entry.arguments);
            } catch {
              parsedArgs = { raw: entry.arguments };
            }

            toolCalls.push({
              id: entry.id,
              name: entry.name,
              arguments: parsedArgs,
            });
          }

          let resolvedContent: string | null = null;
          if (accumulatedContent.trim() && !isGenericCompletion(accumulatedContent)) {
            resolvedContent = accumulatedContent;
          } else if (accumulatedReasoning.trim()) {
            resolvedContent = accumulatedReasoning.trim();
          } else if (accumulatedContent.trim()) {
            resolvedContent = accumulatedContent;
          }

          if (usage.totalTokens === 0) {
            const estCompletion = Math.ceil(
              ((accumulatedContent || "") + (accumulatedReasoning || "")).length / 4
            );
            usage = {
              promptTokens: 0,
              completionTokens: estCompletion,
              totalTokens: estCompletion,
            };
          }

          return {
            content: resolvedContent,
            reasoning: accumulatedReasoning.trim() || null,
            toolCalls,
            usage,
          };
        }

        const data = (await response.json()) as {
          choices: Array<{
            message: {
              content: string | null;
              reasoning?: string | null;
              reasoning_content?: string | null;
              tool_calls?: Array<{
                id: string;
                type: "function";
                function: {
                  name: string;
                  arguments: string;
                };
              }>;
            };
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };

        const choice = data.choices?.[0]?.message;
        if (!choice) {
          throw new Error("Invalid response format from OpenRouter: missing choices[0].message");
        }

        const choiceReasoning = (choice.reasoning ?? choice.reasoning_content ?? "").trim() || null;
        let nonStreamContent = choice.content;
        if (
          (!nonStreamContent || !nonStreamContent.trim() || isGenericCompletion(nonStreamContent)) &&
          choiceReasoning
        ) {
          nonStreamContent = choiceReasoning;
        }

        const toolCalls: ToolCall[] = [];
        if (choice.tool_calls && Array.isArray(choice.tool_calls)) {
          for (const rawCall of choice.tool_calls) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(rawCall.function.arguments);
            } catch {
              parsedArgs = { raw: rawCall.function.arguments };
            }

            const rawExtra = (rawCall as { extra_content?: Record<string, unknown> }).extra_content;
            toolCalls.push({
              id: rawCall.id,
              name: rawCall.function.name,
              arguments: parsedArgs,
              ...(rawExtra ? { extra_content: rawExtra } : {}),
            });
          }
        }

        return {
          content: nonStreamContent,
          reasoning: choiceReasoning,
          toolCalls,
          usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
          },
        };
      } catch (err: unknown) {
        // Fall back to non-streaming if streaming payload fails
        if (payload.stream) {
          delete payload.stream;
          delete payload.stream_options;
        }
        if (retries <= 1) {
          if (this.geminiApiKey) {
            this.activeFallback = true;
            console.warn(
              `[Provider] OpenRouter call failed (${err instanceof Error ? err.message : String(err)}). Switching to Gemini fallback (${this.geminiModel})...`
            );
            return await this.completeWithGemini(messages, formattedTools, options);
          }
          throw err;
        }
        retries--;
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2;
      }
    }

    if (this.geminiApiKey) {
      this.activeFallback = true;
      console.warn(`[Provider] Exhausted OpenRouter retries. Activating Gemini fallback (${this.geminiModel})...`);
      return await this.completeWithGemini(messages, formattedTools, options);
    }

    throw new Error("Exhausted retries calling OpenRouter API.");
  }

  public async completeWithGemini(
    messages: ChatMessage[],
    formattedTools: Array<{ type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }>,
    options?: { stream?: boolean; onChunk?: (chunk: string) => void }
  ): Promise<LlmResponse> {
    const sanitizedMessages = messages.map((msg) => {
      if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        return {
          ...msg,
          tool_calls: msg.tool_calls.map((tc) => {
            const hasSignature = Boolean(
              tc.extra_content &&
                typeof tc.extra_content === "object" &&
                (tc.extra_content as { google?: { thought_signature?: unknown } }).google?.thought_signature
            );
            return {
              ...tc,
              extra_content: hasSignature
                ? tc.extra_content
                : {
                    google: {
                      thought_signature: "skip_thought_signature_validator",
                    },
                  },
            };
          }),
        };
      }
      return msg;
    });

    const candidateModels = Array.from(
      new Set([
        this.geminiModel,
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-3.7-flash",
        "gemini-3.8-flash",
      ])
    ).filter((m) => !OpenRouterClient.exhaustedGeminiModels.has(m));

    let lastError: Error | null = null;

    for (const modelCandidate of candidateModels) {
      const payload: Record<string, unknown> = {
        model: modelCandidate,
        messages: sanitizedMessages,
        temperature: 0.1,
      };

      if (formattedTools.length > 0) {
        payload.tools = formattedTools;
        payload.tool_choice = "auto";
      }

      let geminiRetries = 2;
      let geminiDelayMs = 1000;
      let response: Response | undefined;
      let isQuotaError = false;

      while (geminiRetries > 0) {
        try {
          response = await fetch(this.geminiBaseUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.geminiApiKey}`,
            },
            body: JSON.stringify(payload),
          });

          if (response.status === 429) {
            const errText = await response.text();
            if (
              errText.includes("RESOURCE_EXHAUSTED") ||
              errText.includes("Quota exceeded") ||
              errText.includes("free_tier_requests") ||
              errText.includes("quota")
            ) {
              console.warn(`[Gemini] Quota limit reached for ${modelCandidate}. Cascading to alternate model...`);
              isQuotaError = true;
              OpenRouterClient.exhaustedGeminiModels.add(modelCandidate);
              lastError = new Error(`Gemini API error (429): ${errText}`);
              break;
            }
            geminiRetries--;
            if (geminiRetries > 0) {
              await new Promise((r) => setTimeout(r, geminiDelayMs));
              geminiDelayMs *= 2;
              continue;
            }
            lastError = new Error(`Gemini API error (429): ${errText}`);
          }

          if (response.status === 503 && geminiRetries > 1) {
            geminiRetries--;
            await new Promise((r) => setTimeout(r, geminiDelayMs));
            geminiDelayMs *= 2;
            continue;
          }
          break;
        } catch (fetchErr) {
          lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
          geminiRetries--;
          if (geminiRetries > 0) {
            await new Promise((r) => setTimeout(r, geminiDelayMs));
            geminiDelayMs *= 2;
          }
        }
      }

      if (isQuotaError) {
        continue;
      }

      if (!response || !response.ok) {
        const errText = response ? await response.text().catch(() => "") : "No response";
        lastError = new Error(`Gemini API error (${response?.status ?? 0}): ${errText}`);
        continue;
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            role: string;
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: {
                name: string;
                arguments: string;
              };
              extra_content?: Record<string, unknown>;
            }>;
            extra_content?: Record<string, unknown>;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const choice = data.choices?.[0]?.message;
      if (!choice) {
        throw new Error("Invalid response format from Gemini: missing choices[0].message");
      }

      this.geminiModel = modelCandidate;

      const content = choice.content ?? null;
      if (content && options?.onChunk) {
        options.onChunk(content);
      }

      const toolCalls: ToolCall[] = [];
      if (choice.tool_calls && Array.isArray(choice.tool_calls)) {
        for (const rawCall of choice.tool_calls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(rawCall.function.arguments);
          } catch {
            parsedArgs = { raw: rawCall.function.arguments };
          }

          const rawExtra = (rawCall as { extra_content?: Record<string, unknown> }).extra_content;
          toolCalls.push({
            id: rawCall.id || `gemini_call_${Date.now()}`,
            name: rawCall.function.name,
            arguments: parsedArgs,
            ...(rawExtra ? { extra_content: rawExtra } : {}),
          });
        }
      }

      return {
        content,
        toolCalls,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
      };
    }

    throw lastError || new Error("All Gemini candidate models failed.");
  }
}

