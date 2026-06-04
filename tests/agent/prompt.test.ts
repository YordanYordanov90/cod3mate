import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  buildTestCredentials,
} from '../../src/agent/prompt.js';

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

  it('omits the test-credentials block when none are provided', () => {
    const prompt = buildSystemPrompt({ soulContent: 'soul' });
    expect(prompt).not.toContain('=== TEST CREDENTIALS (Browser Testing Only) ===');
    expect(prompt).not.toContain('Email:');
  });

  it('omits the test-credentials block when either field is missing', () => {
    expect(buildTestCredentials(undefined)).toBe('');
    expect(buildTestCredentials({ email: '', password: 'p' })).toBe('');
    expect(buildTestCredentials({ email: 'e@x.io', password: '' })).toBe('');
  });

  it('includes the test-credentials block between security and SOUL', () => {
    const soul = 'Soul content here.';
    const prompt = buildSystemPrompt({
      soulContent: soul,
      testCredentials: { email: 'tester@example.com', password: 'pw-secret-123' },
    });

    const securityIndex = prompt.indexOf('strict security and operational policies');
    const credsIndex = prompt.indexOf('TEST CREDENTIALS');
    const soulIndex = prompt.indexOf('OWNER PERSONALITY & OPERATING RULES');

    expect(securityIndex).toBeGreaterThan(-1);
    expect(credsIndex).toBeGreaterThan(securityIndex);
    expect(soulIndex).toBeGreaterThan(credsIndex);

    expect(prompt).toContain('tester@example.com');
    expect(prompt).toContain('pw-secret-123');
    expect(prompt).toContain('NEVER echo');
    expect(prompt).toContain('[REDACTED]');
    expect(prompt).toContain('override SOUL');
    expect(prompt).toContain('EXACT full value');
    expect(prompt).toContain('does NOT apply to these test credentials inside browser_fill');
  });

  it('supports Phase 8 multi-app credentials block listing app names (not exposing in selection but values present)', () => {
    const soul = 'soul';
    const prompt = buildSystemPrompt({
      soulContent: soul,
      appCredentials: {
        CLOUDCASTAI: { email: 'cc@ex.com', password: 'ccpw' },
        PINEFORGE: { email: 'pf@ex.com', password: 'pfpw' },
      },
    });
    expect(prompt).toContain('TEST CREDENTIALS');
    expect(prompt).toContain('Available apps with dedicated credentials: CLOUDCASTAI, PINEFORGE');
    expect(prompt).toContain('CLOUDCASTAI:');
    expect(prompt).toContain('cc@ex.com');
    expect(prompt).toContain('PINEFORGE:');
    expect(prompt).toContain('Use the appropriate credentials (legacy or per-app) silently');
  });
});