import type { OpenAIClient } from './client.js';
import { buildSystemPrompt } from './prompt.js';
import { isRetryableForFallback } from './client.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { toolRegistry } from '../tools/registry.js';
import type { ToolResult } from '../tools/types.js';

/**
 * Agent runner (Milestone 5 — with tool registry support).
 */

export interface AgentInput {
  soulContent: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  primaryModel: string;
  fallbackModel: string;
  /** Optional per-chat model override */
  selectedModel?: string | null | undefined;
  /** Whether to enable tool calling in this run */
  enableTools?: boolean;
}

export interface AgentResult {
  content: string;
  modelUsed: string;
  usedFallback: boolean;
  toolCallsExecuted?: Array<{ name: string; success: boolean }>;
}

export interface AgentDependencies {
  openai: OpenAIClient;
  /** Optional registry override (defaults to the global one) */
  registry?: typeof toolRegistry;
}

/**
 * Convert our internal history to OpenAI message format.
 */
function toOpenAIMessages(
  history: AgentInput['history']
): ChatCompletionMessageParam[] {
  return history.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

/**
 * Run the agent, with optional tool support (M5+).
 */
export async function runAgent(
  input: AgentInput,
  deps: AgentDependencies
): Promise<AgentResult> {
  const registry = deps.registry ?? toolRegistry;
  const systemPrompt = buildSystemPrompt({ soulContent: input.soulContent });

  let messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...toOpenAIMessages(input.history),
  ];

  const primary = input.selectedModel || input.primaryModel;
  const fallback = input.fallbackModel;
  const toolsEnabled = input.enableTools ?? true;

  const toolDefs = toolsEnabled ? registry.getToolDefinitions() : [];
  const openaiTools = toolDefs.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const executedTools: Array<{ name: string; success: boolean }> = [];

  try {
    // Primary attempt (with tools if enabled)
    let response = await deps.openai.chat({
      messages,
      model: primary,
      ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
    });

    // Handle tool calls if the model requested any
    if (response.toolCalls && response.toolCalls.length > 0) {
      // Append the assistant message with tool_calls
      messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      } as any);

      // Execute each requested tool
      for (const tc of response.toolCalls) {
        try {
          const rawArgs = JSON.parse(tc.arguments || '{}');
          const toolResult: ToolResult = await registry.execute(tc.name, rawArgs);

          executedTools.push({
            name: tc.name,
            success: toolResult.ok,
          });

          // Append tool result back into the conversation
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolResult.ok ? toolResult.content : `Error: ${toolResult.error}`,
          } as any);
        } catch (toolErr: any) {
          executedTools.push({ name: tc.name, success: false });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `Error executing tool: ${toolErr?.message || toolErr}`,
          } as any);
        }
      }

      // Second call to the model with tool results (final answer expected)
      response = await deps.openai.chat({
        messages,
        model: primary,
      });
    }

    return {
      content: response.content || '(no response)',
      modelUsed: response.model || primary,
      usedFallback: false,
      ...(executedTools.length > 0 ? { toolCallsExecuted: executedTools } : {}),
    };
  } catch (err) {
    if (!isRetryableForFallback(err)) {
      throw err;
    }

    console.warn(`[agent] Primary model "${primary}" failed with retryable error. Trying fallback "${fallback}".`);

    const response = await deps.openai.chat({
      messages,
      model: fallback,
    });

    return {
      content: response.content || '(no response from fallback)',
      modelUsed: response.model || fallback,
      usedFallback: true,
      ...(executedTools.length > 0 ? { toolCallsExecuted: executedTools } : {}),
    };
  }
}