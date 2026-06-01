import type { z } from 'zod';

/**
 * Normalized result from any tool execution.
 * All tool outputs must be converted to this shape before sanitization and returning to the agent.
 */
export type ToolResult =
  | { ok: true; content: string; metadata?: Record<string, unknown> }
  | { ok: false; error: string; metadata?: Record<string, unknown> };

/**
 * The core interface every tool must implement.
 *
 * - `name`: Stable identifier used by the model (e.g. "file_read", "browser_navigate")
 * - `description`: Human-readable description shown to the model for tool selection
 * - `inputSchema`: Zod schema used for validation of arguments chosen by the model
 * - `execute`: The actual implementation. Receives validated input.
 */
export interface Tool<TInput extends Record<string, any> = Record<string, any>> {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>; // loosened for strict TS + .default() inference
  execute: (input: TInput) => Promise<ToolResult>;
}

/**
 * JSON Schema representation suitable for OpenAI tool calling `parameters`.
 * We keep this simple for M5 (basic object support).
 */
export interface JsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * Extended tool definition that includes the JSON Schema for the model.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}