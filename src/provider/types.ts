export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  extra_content?: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
    extra_content?: Record<string, unknown>;
  }>;
  extra_content?: Record<string, unknown>;
  tool_call_id?: string;
  name?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmResponse {
  content: string | null;
  reasoning?: string | null;
  toolCalls: ToolCall[];
  usage: TokenUsage;
}
