import { describe, it, expect } from 'vitest';
import {
  buildChatCompletionParams,
  isReasoningStyleModel,
} from '../../src/agent/client.js';

describe('OpenAI client params', () => {
  it('detects GPT-5.x and o-series as reasoning-style models', () => {
    expect(isReasoningStyleModel('gpt-5.4-nano')).toBe(true);
    expect(isReasoningStyleModel('gpt-5-mini')).toBe(true);
    expect(isReasoningStyleModel('o3-mini')).toBe(true);
    expect(isReasoningStyleModel('gpt-4o')).toBe(false);
  });

  it('omits max_tokens and temperature for GPT-5.4 models', () => {
    const params = buildChatCompletionParams({
      model: 'gpt-5.4-nano',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(params).not.toHaveProperty('max_tokens');
    expect(params).not.toHaveProperty('temperature');
    expect(params.model).toBe('gpt-5.4-nano');
  });

  it('uses max_completion_tokens when set on reasoning models', () => {
    const params = buildChatCompletionParams({
      model: 'gpt-5.4-nano',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 1024,
    });

    expect(params.max_completion_tokens).toBe(1024);
    expect(params).not.toHaveProperty('max_tokens');
  });

  it('uses max_tokens and temperature for classic models', () => {
    const params = buildChatCompletionParams({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 512,
    });

    expect(params.max_tokens).toBe(512);
    expect(params.temperature).toBe(0.7);
    expect(params).not.toHaveProperty('max_completion_tokens');
  });
});
