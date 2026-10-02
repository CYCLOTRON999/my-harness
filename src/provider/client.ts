import fs from "node:fs";
import path from "node:path";
import type { ChatMessage, LlmResponse, ToolCall, ToolDeclaration } from "./types.ts";

export interface LlmClientConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

function loadEnvFile(): void {
  const candidates = [".env", path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "inductionharness/.env")];
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

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: LlmClientConfig = {}) {
    loadEnvFile();

    this.apiKey =
      config.apiKey ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "";

    if (!this.apiKey) {
      throw new Error(
        "Missing API key. Set OPENROUTER_API_KEY in your environment or pass --api-key."
      );
    }

    this.model = config.model || process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
    this.baseUrl = config.baseUrl || "https://openrouter.ai/api/v1/chat/completions";
  }

  public getModel(): string {
    return this.model;
  }

  public async complete(
    messages: ChatMessage[],
    tools: ToolDeclaration[]
  ): Promise<LlmResponse> {
    const formattedTools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.1, // Low temperature for deterministic code generation
    };

    if (formattedTools.length > 0) {
      payload.tools = formattedTools;
      payload.tool_choice = "auto";
    }

    let retries = 3;
    let delayMs = 2000;

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
          retries--;
          console.warn(`[OpenRouter] Rate limited (429). Retrying in ${delayMs}ms...`);
          await new Promise((r) => setTimeout(r, delayMs));
          delayMs *= 2;
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
        }

        const data = (await response.json()) as {
          choices: Array<{
            message: {
              content: string | null;
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

        const toolCalls: ToolCall[] = [];
        if (choice.tool_calls && Array.isArray(choice.tool_calls)) {
          for (const rawCall of choice.tool_calls) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(rawCall.function.arguments);
            } catch {
              parsedArgs = { raw: rawCall.function.arguments };
            }

            toolCalls.push({
              id: rawCall.id,
              name: rawCall.function.name,
              arguments: parsedArgs,
            });
          }
        }

        return {
          content: choice.content,
          toolCalls,
          usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
          },
        };
      } catch (err: unknown) {
        if (retries <= 1) throw err;
        retries--;
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2;
      }
    }

    throw new Error("Exhausted retries calling OpenRouter API.");
  }
}
