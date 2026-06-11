import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { OpenAIClient } from './client.js';
import { sanitizeString } from '../security/sanitize.js';

export interface CompactionOptions {
  thresholdChars: number;
  keepRecent: number;
  /** Messages from session history (excluding the system prompt). */
  initialHistoryCount: number;
  model: string;
}

const COMPACTION_SUMMARY_PREFIX = '[Compaction summary of earlier progress]';

function messageContentChars(msg: ChatCompletionMessageParam): number {
  if (msg.role === 'tool') {
    return String((msg as { content?: string }).content ?? '').length;
  }
  const content = (msg as { content?: string | null }).content;
  if (typeof content === 'string') return content.length;
  if (content == null) {
    const toolCalls = (msg as { tool_calls?: unknown[] }).tool_calls;
    return Array.isArray(toolCalls) ? toolCalls.length * 80 : 0;
  }
  return JSON.stringify(content).length;
}

export function estimateMessagesChars(messages: ChatCompletionMessageParam[]): number {
  return messages.reduce((sum, msg) => sum + messageContentChars(msg), 0);
}

function truncateToolMessages(
  messages: ChatCompletionMessageParam[],
  maxCharsPerTool: number
): ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.role !== 'tool') return msg;
    const content = String((msg as { content?: string }).content ?? '');
    if (content.length <= maxCharsPerTool) return msg;
    return {
      ...msg,
      content:
        content.slice(0, maxCharsPerTool) +
        `\n[Compaction: tool output truncated from ${content.length} chars]`,
    };
  });
}

async function summarizeSegment(
  openai: OpenAIClient,
  model: string,
  segment: ChatCompletionMessageParam[]
): Promise<string> {
  const lines: string[] = [];
  for (const msg of segment) {
    if (msg.role === 'assistant') {
      const content = (msg as { content?: string | null }).content;
      if (content) lines.push(`Assistant: ${content}`);
      const toolCalls = (msg as { tool_calls?: Array<{ function?: { name?: string } }> }).tool_calls;
      if (toolCalls?.length) {
        lines.push(
          `Tool calls: ${toolCalls.map((tc) => tc.function?.name ?? 'unknown').join(', ')}`
        );
      }
    } else if (msg.role === 'tool') {
      const content = String((msg as { content?: string }).content ?? '');
      lines.push(`Tool result: ${content.slice(0, 2000)}`);
    } else if (msg.role === 'user') {
      const content = String((msg as { content?: string }).content ?? '');
      lines.push(`User: ${content}`);
    }
  }

  const response = await openai.chat({
    model,
    messages: [
      {
        role: 'system',
        content:
          'Summarize the agent progress so far in under 2000 characters. Include pages visited, actions taken, assertion outcomes, and blockers. Never include secrets, tokens, or passwords.',
      },
      {
        role: 'user',
        content: lines.join('\n\n').slice(0, 24_000),
      },
    ],
  });

  return sanitizeString(response.content?.trim() || 'Earlier steps were compacted.');
}

/**
 * Compact in-loop messages when history exceeds the threshold.
 * Preserves system prompt, session history, and the most recent loop messages.
 */
export async function compactMessagesIfNeeded(
  messages: ChatCompletionMessageParam[],
  options: CompactionOptions,
  openai: OpenAIClient
): Promise<ChatCompletionMessageParam[]> {
  if (options.thresholdChars <= 0) return messages;
  if (estimateMessagesChars(messages) <= options.thresholdChars) return messages;

  const system = messages[0];
  if (!system || system.role !== 'system') return messages;

  const initialEnd = 1 + Math.max(0, options.initialHistoryCount);
  const initialBlock = messages.slice(1, initialEnd);
  const loopBlock = messages.slice(initialEnd);

  if (loopBlock.length <= options.keepRecent) {
    return truncateOldestToolOutputs(messages, options.thresholdChars);
  }

  const toSummarize = loopBlock.slice(0, loopBlock.length - options.keepRecent);
  const toKeep = loopBlock.slice(loopBlock.length - options.keepRecent);

  let summaryText: string;
  try {
    summaryText = await summarizeSegment(openai, options.model, toSummarize);
  } catch {
    const truncated = truncateToolMessages(toSummarize, 500);
    summaryText = sanitizeString(
      `${COMPACTION_SUMMARY_PREFIX}\n${truncated
        .filter((m) => m.role === 'tool')
        .map((m) => String((m as { content?: string }).content ?? '').slice(0, 300))
        .join('\n---\n')}`
    );
  }

  const compacted: ChatCompletionMessageParam[] = [
    system,
    ...initialBlock,
    { role: 'assistant', content: `${COMPACTION_SUMMARY_PREFIX}\n${summaryText}` },
    ...toKeep,
  ];

  if (estimateMessagesChars(compacted) > options.thresholdChars) {
    return truncateOldestToolOutputs(compacted, options.thresholdChars);
  }

  return compacted;
}

function truncateOldestToolOutputs(
  messages: ChatCompletionMessageParam[],
  thresholdChars: number
): ChatCompletionMessageParam[] {
  let current = messages;
  let maxTool = 4000;

  while (estimateMessagesChars(current) > thresholdChars && maxTool > 200) {
    const system = current[0];
    const rest = current.slice(1);
    const truncatedRest = truncateToolMessages(rest, maxTool);
    current = system ? [system, ...truncatedRest] : truncatedRest;
    maxTool = Math.floor(maxTool * 0.6);
  }

  return current;
}

export { COMPACTION_SUMMARY_PREFIX };