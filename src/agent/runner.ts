import type { OpenAIClient } from './client.js';
import { buildSystemPrompt, type TestCredentials } from './prompt.js';
import { isRetryableForFallback } from './client.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { toolRegistry } from '../tools/registry.js';
import type { ToolResult } from '../tools/types.js';

/**
 * Agent runner with multi-round tool loop support.
 *
 * Behavior:
 * - System prompt = security rules + optional test creds + SOUL.
 * - Each round: call model. If model returns tool_calls, execute them,
 *   append results, and call again. If no tool_calls, return content.
 * - Bounded by `maxIterations` (default 8, sourced from MAX_AGENT_ITERATIONS).
 * - If the very first model call throws a retryable error, the runner
 *   transparently switches to the fallback model and continues the loop.
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
  /**
   * Optional test credentials for browser-based login flows.
   * Sourced from env (TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD).
   * Never pass values that originated from chat input.
   */
  testCredentials?: TestCredentials | undefined;
  /**
   * Maximum tool-call rounds. Each round is one (model -> tools) pair.
   * Defaults to 8. Pass MAX_AGENT_ITERATIONS from env at the call site.
   */
  maxIterations?: number;
}

export interface AgentResult {
  content: string;
  modelUsed: string;
  usedFallback: boolean;
  toolCallsExecuted?: Array<{ name: string; success: boolean }>;
  /** True if the loop exited because maxIterations was reached. */
  iterationLimitHit?: boolean;
}

export interface AgentDependencies {
  openai: OpenAIClient;
  /** Optional registry override (defaults to the global one) */
  registry?: typeof toolRegistry;
}

function toOpenAIMessages(
  history: AgentInput['history']
): ChatCompletionMessageParam[] {
  return history.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

export async function runAgent(
  input: AgentInput,
  deps: AgentDependencies
): Promise<AgentResult> {
  const registry = deps.registry ?? toolRegistry;
  const systemPrompt = buildSystemPrompt({
    soulContent: input.soulContent,
    testCredentials: input.testCredentials,
  });

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...toOpenAIMessages(input.history),
  ];

  const primary = input.selectedModel || input.primaryModel;
  const fallback = input.fallbackModel;
  const toolsEnabled = input.enableTools ?? true;
  const maxIterations = Math.max(1, input.maxIterations ?? 8);

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
  let usedFallback = false;
  let activeModel = primary;
  let lastContent = '';
  let lastModelUsed = primary;

  for (let iter = 0; iter < maxIterations; iter++) {
    let response;
    try {
      response = await deps.openai.chat({
        messages,
        model: activeModel,
        ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
      });
    } catch (err) {
      // Only the first call can switch to the fallback model.
      // After we have any conversation state (tool results), retrying with
      // a different model on each iteration would be unsafe and confusing.
      if (iter === 0 && !usedFallback && isRetryableForFallback(err)) {
        console.warn(
          `[agent] Primary model "${primary}" failed with retryable error. Trying fallback "${fallback}".`
        );
        usedFallback = true;
        activeModel = fallback;
        iter--;
        continue;
      }
      throw err;
    }

    lastContent = response.content || '';
    lastModelUsed = response.model || activeModel;

    const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;

    if (!hasToolCalls) {
      return {
        content: lastContent || '(no response)',
        modelUsed: lastModelUsed,
        usedFallback,
        ...(executedTools.length > 0
          ? { toolCallsExecuted: executedTools }
          : {}),
      };
    }

    messages.push({
      role: 'assistant',
      content: response.content || null,
      tool_calls: response.toolCalls!.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    } as any);

    for (const tc of response.toolCalls!) {
      try {
        const rawArgs = JSON.parse(tc.arguments || '{}');
        const toolResult: ToolResult = await registry.execute(tc.name, rawArgs);

        executedTools.push({ name: tc.name, success: toolResult.ok });

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
  }

  return {
    content:
      (lastContent && lastContent.trim().length > 0
        ? lastContent
        : 'Stopped: maximum tool iteration limit reached before producing a final answer.'),
    modelUsed: lastModelUsed,
    usedFallback,
    iterationLimitHit: true,
    ...(executedTools.length > 0 ? { toolCallsExecuted: executedTools } : {}),
  };
}
