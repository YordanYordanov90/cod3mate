import { afterEach, describe, it, expect } from 'vitest';
import {
  sanitizeString,
  sanitizeToolResult,
  registerSecret,
  getRegisteredSecrets,
  clearRegisteredSecrets,
} from '../../src/security/sanitize.js';

describe('Sanitization (M5)', () => {
  it('redacts OpenAI-style keys', () => {
    const input = 'My key is sk-1234567890abcdef1234567890abcdef';
    const output = sanitizeString(input);
    expect(output).not.toContain('sk-1234');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts Telegram bot tokens', () => {
    const input = 'Token: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567890';
    const output = sanitizeString(input);
    expect(output).toContain('[REDACTED]');
  });

  it('redacts extra provided secrets', () => {
    const input = 'Secret value: my-super-secret-123';
    const output = sanitizeString(input, { extraSecrets: ['my-super-secret-123'] });
    expect(output).toContain('[REDACTED]');
  });

  it('sanitizes tool results', () => {
    const result = {
      ok: true as const,
      content: 'Used key sk-abc123def456',
      metadata: { token: '123456789:ABCDEF' },
    };
    const sanitized = sanitizeToolResult(result);
    expect(sanitized.content).toContain('[REDACTED]');
    expect((sanitized.metadata as any).token).toContain('[REDACTED]');
  });

  describe('registered secrets', () => {
    afterEach(() => {
      clearRegisteredSecrets();
    });

    it('redacts globally registered secrets without per-call options', () => {
      registerSecret('tester@example.com');
      registerSecret('pw-secret-123');

      const out = sanitizeString(
        'I will log in as tester@example.com using pw-secret-123 now.'
      );

      expect(out).not.toContain('tester@example.com');
      expect(out).not.toContain('pw-secret-123');
      expect(out).toContain('[REDACTED]');
    });

    it('combines registered secrets with per-call extraSecrets', () => {
      registerSecret('global-value-abcd');

      const out = sanitizeString(
        'global-value-abcd and per-call-zxyw',
        { extraSecrets: ['per-call-zxyw'] }
      );

      expect(out).not.toContain('global-value-abcd');
      expect(out).not.toContain('per-call-zxyw');
    });

    it('ignores empty / too-short / null values', () => {
      registerSecret(undefined);
      registerSecret(null as unknown as string);
      registerSecret('');
      registerSecret('abc'); // length 3 — too risky
      expect(getRegisteredSecrets()).toEqual([]);
    });

    it('redacts registered secrets inside tool results too', () => {
      registerSecret('owner-test-mail@example.io');

      const sanitized = sanitizeToolResult({
        ok: true,
        content: 'Logged in with owner-test-mail@example.io successfully.',
      });

      expect(sanitized.ok).toBe(true);
      if (sanitized.ok) {
        expect(sanitized.content).not.toContain('owner-test-mail');
        expect(sanitized.content).toContain('[REDACTED]');
      }
    });
  });
});