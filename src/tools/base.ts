import { z } from "zod";
import type { SandboxJail } from "../sandbox/jail.ts";
import type { ProcessExecutor } from "../sandbox/executor.ts";

export interface ToolExecutionContext {
  sandbox: SandboxJail;
  executor: ProcessExecutor;
}

export interface AnyAgentTool {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  execute: (input: any, ctx: ToolExecutionContext) => Promise<string>;
}

export interface AgentTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: TSchema;
  execute: (input: z.infer<TSchema>, ctx: ToolExecutionContext) => Promise<string>;
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const field = value as z.ZodTypeAny;
      properties[key] = extractFieldDetails(field);
      if (!field.isOptional()) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: "object" };
}

function extractFieldDetails(field: z.ZodTypeAny): Record<string, unknown> {
  let inner: z.ZodTypeAny = field;
  if (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) {
    inner = inner.unwrap();
  }

  let type = "string";
  if (inner instanceof z.ZodNumber) type = "number";
  if (inner instanceof z.ZodBoolean) type = "boolean";
  if (inner instanceof z.ZodArray) type = "array";

  const description = field.description ?? inner.description;

  return {
    type,
    description: description || undefined,
  };
}
