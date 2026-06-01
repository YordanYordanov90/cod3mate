import { describe, it, expect, vi } from 'vitest';
import { runAgent } from '../../src/agent/runner.js';
import type { OpenAIClient } from '../../src/agent/client.js';

const fakeSoul = 'You are a test assistant.';

const baseInput = {
  soulContent: fakeSoul,
  history: [
    { role: 'user' as const, content: 'Hello there' },
  ],
  primaryModel: 'gpt-primary-test',
  fallbackModel: 'gpt-fallback-test',
};

describe('agent runner (M4 no-tools)', () => {
  it('calls primary model and returns response', async () => {
    const mockChat = vi.fn().mockResolvedValue({
      content: 'Hi! How can I help?',
      model: 'gpt-primary-test',
    });

    const mockClient: OpenAIClient = {
      chat: mockChat,
      getClient: () => ({} as any),
    };

    const result = await runAgent(baseInput, { openai: mockClient });

    expect(result.content).toBe('Hi! How can I help?');
    expect(result.usedFallback).toBe(false);
    expect(result.modelUsed).toBe('gpt-primary-test');
    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-primary-test' })
    );
  });

  it('falls back on retryable errors', async () => {
    const primaryError = { status: 429, message: 'Rate limit' };
    const mockChat = vi
      .fn()
      .mockRejectedValueOnce(primaryError)
      .mockResolvedValueOnce({
        content: 'Fallback response',
        model: 'gpt-fallback-test',
      });

    const mockClient: OpenAIClient = {
      chat: mockChat,
      getClient: () => ({} as any),
    };

    const result = await runAgent(baseInput, { openai: mockClient });

    expect(result.content).toBe('Fallback response');
    expect(result.usedFallback).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it('includes system prompt with security rules + soul', async () => {
    const mockChat = vi.fn().mockResolvedValue({ content: 'ok', model: 'x' });

    const mockClient: OpenAIClient = {
      chat: mockChat,
      getClient: () => ({} as any),
    };

    await runAgent(baseInput, { openai: mockClient });

    const calledMessages = mockChat.mock.calls[0][0].messages;
    const systemMsg = calledMessages.find((m: any) => m.role === 'system');

    expect(systemMsg.content).toContain('strict security and operational policies');
    expect(systemMsg.content).toContain(fakeSoul);
  });
});