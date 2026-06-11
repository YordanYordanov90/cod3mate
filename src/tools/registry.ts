import { z } from 'zod';
import type { Tool, ToolDefinition, ToolResult, JsonSchema } from './types.js';
import { sanitizeToolResult } from '../security/sanitize.js';
import {
  isToolInSet,
  resolveToolSet,
  type AgentToolSet,
} from '../agent/tool-sets.js';

/**
 * Tool Registry
 *
 * Responsibilities (M5):
 * - Register tools by name
 * - Provide tool definitions for OpenAI (with JSON Schema parameters)
 * - Validate inputs using the tool's Zod schema
 * - Execute tools through a safe wrapper (timeout, truncation, sanitization)
 */

export interface ToolRegistryOptions {
  /** Per-tool execution timeout in ms. Defaults to 60_000. */
  timeoutMs?: number;
  /** Max characters of `content` returned to the agent. Defaults to 12_000. */
  maxOutputChars?: number;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private timeoutMs = 60_000;
  private maxOutputChars = 12_000;

  /**
   * Configure runtime limits used by every tool execution.
   * Safe to call multiple times; later calls override earlier ones.
   */
  configure(options: ToolRegistryOptions): void {
    if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) {
      this.timeoutMs = options.timeoutMs;
    }
    if (typeof options.maxOutputChars === 'number' && options.maxOutputChars > 0) {
      this.maxOutputChars = options.maxOutputChars;
    }
  }

  /**
   * Register a new tool. Throws if a tool with the same name already exists.
   */
  register(tool: Tool<any>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool as Tool);
  }

  /**
   * Get a tool by name. Returns undefined if not found.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tool names.
   */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Convert registered tools into the format expected by OpenAI's tools parameter.
   */
  getToolDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      defs.push({
        name: tool.name,
        description: tool.description,
        parameters: this.zodToJsonSchema(tool.inputSchema),
      });
    }

    return defs;
  }

  /**
   * Tool definitions scoped by run mode (Roadmap v2 Phase 2).
   * `all` exposes every registered tool (debug escape hatch).
   */
  getToolDefinitionsForSet(
    toolSet: AgentToolSet | undefined,
    exposeAllTools = false
  ): ToolDefinition[] {
    const resolved = resolveToolSet(toolSet, exposeAllTools);
    return this.getToolDefinitions().filter((def) => isToolInSet(def.name, resolved));
  }

  /**
   * Execute a tool by name with raw (untrusted) arguments from the model.
   * - Validates input with Zod
   * - Runs through safe execution wrapper (timeout + truncation + sanitization)
   */
  async execute(name: string, rawInput: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        error: `Unknown tool: ${name}. Available tools: ${this.listNames().join(', ') || 'none'}`,
      };
    }

    // Validate input
    const parseResult = tool.inputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      return {
        ok: false,
        error: `Invalid arguments for tool "${name}": ${parseResult.error.message}`,
      };
    }

    // Delegate to safe execution
    return this.safeExecute(tool, parseResult.data);
  }

  /**
   * Safe execution wrapper.
   * Applies: timeout, output truncation, and sanitization.
   * This is the central place where all tool results are normalized and secured.
   */
  private async safeExecute(tool: Tool<any>, input: any): Promise<ToolResult> {
    const timeoutMs = this.timeoutMs;
    const maxOutputChars = this.maxOutputChars;

    try {
      const resultPromise = tool.execute(input);

      // Timeout protection
      const timeoutPromise = new Promise<ToolResult>((_, reject) => {
        setTimeout(() => reject(new Error(`Tool "${tool.name}" timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      const result = await Promise.race([resultPromise, timeoutPromise]);

      // Normalize and truncate
      let normalized = this.normalizeResult(result);

      // Truncate if too long
      if (normalized.ok && normalized.content.length > maxOutputChars) {
        normalized.content =
          normalized.content.slice(0, maxOutputChars) +
          `\n\n[Output truncated to ${maxOutputChars} characters]`;
      }

      // Always sanitize before returning to the agent
      normalized = sanitizeToolResult(normalized);

      return normalized;
    } catch (err: any) {
      return {
        ok: false,
        error: `Tool "${tool.name}" failed: ${err?.message || String(err)}`,
      };
    }
  }

  private normalizeResult(result: ToolResult): ToolResult {
    if (result.ok) {
      const out: any = {
        ok: true,
        content: String(result.content ?? ''),
      };
      if (result.metadata) out.metadata = result.metadata;
      return out;
    }
    const out: any = {
      ok: false,
      error: String(result.error ?? 'Unknown error'),
    };
    if (result.metadata) out.metadata = result.metadata;
    return out;
  }

  /**
   * Basic Zod → JSON Schema converter (sufficient for M5 tool schemas).
   * Supports: object, string, number, boolean, array, optional.
   */
  private zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
    // Handle ZodObject directly
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape as Record<string, z.ZodTypeAny>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = this.zodTypeToJsonSchema(value);

        // Check if field is required (not optional)
        if (!(value instanceof z.ZodOptional || value instanceof z.ZodDefault)) {
          required.push(key);
        }
      }

      const schemaObj: any = {
        type: 'object',
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) schemaObj.required = required;
      return schemaObj;
    }

    // Fallback for non-object schemas (rare for tools)
    return {
      type: 'object',
      properties: {},
      additionalProperties: true,
    };
  }

  private zodTypeToJsonSchema(zodType: z.ZodTypeAny): Record<string, unknown> {
    if (zodType instanceof z.ZodString) {
      return { type: 'string' };
    }
    if (zodType instanceof z.ZodNumber) {
      return { type: 'number' };
    }
    if (zodType instanceof z.ZodBoolean) {
      return { type: 'boolean' };
    }
    if (zodType instanceof z.ZodOptional) {
      return this.zodTypeToJsonSchema(zodType.unwrap());
    }
    if (zodType instanceof z.ZodDefault) {
      return this.zodTypeToJsonSchema(zodType._def.innerType);
    }
    if (zodType instanceof z.ZodArray) {
      return {
        type: 'array',
        items: this.zodTypeToJsonSchema(zodType.element),
      };
    }
    if (zodType instanceof z.ZodObject) {
      return this.zodToJsonSchema(zodType);
    }
    // Fallback
    return { type: 'string' };
  }
}

// Singleton registry for the application
export const toolRegistry = new ToolRegistry();