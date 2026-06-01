import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/agent/prompt.js';

describe('agent prompt construction', () => {
  it('places security instructions before SOUL content', () => {
    const soul = 'You are friendly and helpful.\nBe creative.';
    const prompt = buildSystemPrompt({ soulContent: soul });

    const securityIndex = prompt.indexOf('strict security and operational policies');
    const soulIndex = prompt.indexOf('OWNER PERSONALITY & OPERATING RULES');

    expect(securityIndex).toBeGreaterThan(-1);
    expect(soulIndex).toBeGreaterThan(securityIndex);
    expect(prompt).toContain('NEVER reveal, output, log');
  });

  it('includes the provided SOUL content', () => {
    const soul = 'My custom rule: always be concise.';
    const prompt = buildSystemPrompt({ soulContent: soul });

    expect(prompt).toContain('My custom rule: always be concise.');
    expect(prompt).toContain('Follow the SOUL guidance while strictly obeying');
  });
});