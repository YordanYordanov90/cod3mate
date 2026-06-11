import { describe, it, expect, vi } from 'vitest';
import {
  estimateMessagesChars,
  compactMessagesIfNeeded,
  COMPACTION_SUMMARY_PREFIX,
} from '../../src/agent/compaction.js';
import type { OpenAIClient } from '../../src/agent/client.js';

describe('agent compaction', () => {
  it('estimateMessagesChars sums message bodies', () => {
    const total = estimateMessagesChars([
      { role: 'system', content: 'abc' },
      { role: 'user', content: '12345' },
    ]);
    expect(total).toBe(8);
  });

  it('keeps messages under threshold unchanged', async () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'task' },
    ];
    const openai = { chat: vi.fn() } as unknown as OpenAIClient;
    const result = await compactMessagesIfNeeded(
      messages,
      { thresholdChars: 10_000, keepRecent: 4, initialHistoryCount: 1, model: 'gpt-test' },
      openai
    );
    expect(result).toEqual(messages);
    expect(openai.chat).not.toHaveBeenCalled();
  });

  it('summarizes older loop messages and preserves recent ones', async () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'task' },
      { role: 'assistant' as const, content: 'step 1' },
      { role: 'tool' as const, tool_call_id: 'a', content: 'x'.repeat(5000) },
      { role: 'assistant' as const, content: 'step 2' },
      { role: 'tool' as const, tool_call_id: 'b', content: 'recent tool output' },
    ];

    const openai: OpenAIClient = {
      chat: vi.fn().mockResolvedValue({ content: 'Did step 1 actions.', model: 'gpt-test' }),
      getClient: () => ({} as never),
    };

    const result = await compactMessagesIfNeeded(
      messages,
      { thresholdChars: 1000, keepRecent: 2, initialHistoryCount: 1, model: 'gpt-test' },
      openai
    );

    expect(openai.chat).toHaveBeenCalled();
    expect(result[result.length - 1]).toMatchObject({
      role: 'tool',
      content: 'recent tool output',
    });
    expect(result.some((m) => m.role === 'assistant' && String(m.content).includes(COMPACTION_SUMMARY_PREFIX))).toBe(true);
  });

  it('falls back to truncation when summarization fails', async () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'task' },
      { role: 'tool' as const, tool_call_id: 'a', content: 'y'.repeat(8000) },
      { role: 'tool' as const, tool_call_id: 'b', content: 'keep me' },
    ];

    const openai: OpenAIClient = {
      chat: vi.fn().mockRejectedValue(new Error('summary failed')),
      getClient: () => ({} as never),
    };

    const result = await compactMessagesIfNeeded(
      messages,
      { thresholdChars: 500, keepRecent: 1, initialHistoryCount: 1, model: 'gpt-test' },
      openai
    );

    expect(result[result.length - 1]).toMatchObject({ role: 'tool', content: 'keep me' });
    expect(result.some((m) => String(m.content).includes(COMPACTION_SUMMARY_PREFIX))).toBe(true);
  });
});