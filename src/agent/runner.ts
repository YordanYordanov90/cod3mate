import type { OpenAIClient } from './client.js';
import { buildSystemPrompt, type TestCredentials } from './prompt.js';
import { isRetryableForFallback } from './client.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { toolRegistry } from '../tools/registry.js';
import type { ToolResult } from '../tools/types.js';
import { compactMessagesIfNeeded } from './compaction.js';
import type { AgentToolSet } from './tool-sets.js';
import { buildQaStateSnapshot, replaceQaStateMessage } from './qa-state.js';
import {
  drainSteering,
  requestCancel,
  shouldCancelRun,
} from '../telegram/run-control.js';
import { sanitizeString } from '../security/sanitize.js';
import {
  isQaTranscriptCollecting,
  recordTranscriptModelResponse,
  recordTranscriptSteering,
  recordTranscriptToolCall,
  recordTranscriptToolResult,
} from '../tools/qa/transcript.js';

/**
 * Agent runner with multi-round tool loop support.
 *
 * Behavior:
 * - System prompt = security rules + optional test creds + SOUL.
 * - Each round: call model. If model returns tool_calls, execute them,
 *   append results, and call again. If no tool_calls, return content.
 * - Bounded by `maxIterations` (default 8 from env; 25 for /qa-test QA runs).
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
   * Optional legacy test credentials for browser-based login flows.
   * Sourced from env (TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD).
   * Never pass values that originated from chat input.
   */
  testCredentials?: TestCredentials | undefined;
  /**
   * Phase 8 multi-app credentials (app name -> {email, password}).
   */
  appCredentials?: Record<string, TestCredentials> | undefined;
  /**
   * Maximum tool-call rounds. Each round is one (model -> tools) pair.
   * Defaults to 8 (from env MAX_AGENT_ITERATIONS). /qa-test passes 25 for long flows.
   */
  maxIterations?: number;
  /** Tool set for this run (Roadmap v2 Phase 2). */
  toolSet?: AgentToolSet;
  /** When true, expose every registered tool regardless of toolSet. */
  exposeAllTools?: boolean;
  /** Compaction threshold in chars (0 disables). */
  compactionThresholdChars?: number;
  /** Recent in-loop messages to keep verbatim during compaction. */
  compactionKeepRecent?: number;
  /** Inject live QA state before each iteration (QA mode only). */
  injectQaState?: boolean;
  /** Chat id for steering/cancel hooks (Roadmap v2 Phase 3). */
  chatId?: number;
}

export interface AgentResult {
  content: string;
  modelUsed: string;
  usedFallback: boolean;
  toolCallsExecuted?: Array<{ name: string; success: boolean }>;
  /** True if the loop exited because maxIterations was reached. */
  iterationLimitHit?: boolean;
  /** True if the owner cancelled via /stop or steering "stop". */
  cancelled?: boolean;
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

function appendSteeringMessages(
  messages: ChatCompletionMessageParam[],
  steering: string[]
): ChatCompletionMessageParam[] {
  if (steering.length === 0) return messages;
  const next = [...messages];
  for (const text of steering) {
    next.push({
      role: 'user',
      content: sanitizeString(`[Steering] ${text}`),
    });
  }
  return next;
}

export async function runAgent(
  input: AgentInput,
  deps: AgentDependencies
): Promise<AgentResult> {
  const registry = deps.registry ?? toolRegistry;
  const systemPrompt = buildSystemPrompt({
    soulContent: input.soulContent,
    testCredentials: input.testCredentials,
    appCredentials: input.appCredentials,
  });

  const initialHistoryMessages = toOpenAIMessages(input.history);

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...initialHistoryMessages,
  ];

  const primary = input.selectedModel || input.primaryModel;
  const fallback = input.fallbackModel;
  const toolsEnabled = input.enableTools ?? true;
  const maxIterations = Math.max(1, input.maxIterations ?? 8);
  const compactionThreshold = input.compactionThresholdChars ?? 0;
  const compactionKeepRecent = Math.max(2, input.compactionKeepRecent ?? 8);

  const toolDefs = toolsEnabled
    ? registry.getToolDefinitionsForSet(input.toolSet, input.exposeAllTools ?? false)
    : [];
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
    if (input.chatId != null && shouldCancelRun(input.chatId)) {
      return {
        content:
          lastContent && lastContent.trim().length > 0
            ? `${lastContent}\n\n(Run stopped by owner request.)`
            : 'Run stopped by owner request before a final answer was produced.',
        modelUsed: lastModelUsed,
        usedFallback,
        cancelled: true,
        ...(executedTools.length > 0 ? { toolCallsExecuted: executedTools } : {}),
      };
    }

    if (input.chatId != null) {
      const steering = drainSteering(input.chatId);
      if (steering.length > 0) {
        if (isQaTranscriptCollecting()) {
          for (const text of steering) {
            recordTranscriptSteering(text);
          }
        }
        const merged = appendSteeringMessages(messages, steering);
        messages.length = 0;
        messages.push(...merged);
        if (steering.some((s) => /^stop$/i.test(s.trim()))) {
          requestCancel(input.chatId);
        }
      }
    }

    if (input.injectQaState) {
      const snapshot = await buildQaStateSnapshot();
      const replaced = replaceQaStateMessage(messages, snapshot);
      messages.length = 0;
      messages.push(...(replaced as ChatCompletionMessageParam[]));
    }

    if (compactionThreshold > 0) {
      const compacted = await compactMessagesIfNeeded(
        messages,
        {
          thresholdChars: compactionThreshold,
          keepRecent: compactionKeepRecent,
          initialHistoryCount: initialHistoryMessages.length,
          model: activeModel,
        },
        deps.openai
      );
      messages.length = 0;
      messages.push(...compacted);
    }

    let response;
    try {
      response = await deps.openai.chat({
        messages,
        model: activeModel,
        ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
      });
    } catch (err) {
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

    if (isQaTranscriptCollecting()) {
      const modelRecord: {
        iteration: number;
        model: string;
        content: string;
        toolNames?: string[];
      } = {
        iteration: iter,
        model: lastModelUsed,
        content: lastContent,
      };
      if (hasToolCalls) {
        modelRecord.toolNames = response.toolCalls!.map((tc) => tc.name);
      }
      recordTranscriptModelResponse(modelRecord);
    }

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
    } as ChatCompletionMessageParam);

    for (const tc of response.toolCalls!) {
      try {
        const rawArgs = JSON.parse(tc.arguments || '{}');
        if (isQaTranscriptCollecting()) {
          recordTranscriptToolCall({
            iteration: iter,
            toolName: tc.name,
            toolCallId: tc.id,
            toolArgs: rawArgs,
          });
        }

        const toolResult: ToolResult = await registry.execute(tc.name, rawArgs);

        executedTools.push({ name: tc.name, success: toolResult.ok });

        const toolContent = toolResult.ok
          ? toolResult.content
          : `Error: ${toolResult.error}`;

        if (isQaTranscriptCollecting()) {
          recordTranscriptToolResult({
            iteration: iter,
            toolName: tc.name,
            toolCallId: tc.id,
            content: toolContent,
            success: toolResult.ok,
            ...(tc.name === 'browser_screenshot' && toolResult.ok
              ? { screenshotPath: toolResult.content }
              : {}),
          });
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolContent,
        } as ChatCompletionMessageParam);
      } catch (toolErr: unknown) {
        const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
        executedTools.push({ name: tc.name, success: false });
        if (isQaTranscriptCollecting()) {
          recordTranscriptToolResult({
            iteration: iter,
            toolName: tc.name,
            toolCallId: tc.id,
            content: `Error executing tool: ${errMsg}`,
            success: false,
          });
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Error executing tool: ${errMsg}`,
        } as ChatCompletionMessageParam);
      }

      if (input.chatId != null && shouldCancelRun(input.chatId)) {
        return {
          content:
            lastContent && lastContent.trim().length > 0
              ? `${lastContent}\n\n(Run stopped by owner request after the current tool finished.)`
              : 'Run stopped by owner request after the current tool finished.',
          modelUsed: lastModelUsed,
          usedFallback,
          cancelled: true,
          ...(executedTools.length > 0 ? { toolCallsExecuted: executedTools } : {}),
        };
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

