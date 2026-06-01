import { describe, it, expect } from 'vitest';
import { sanitizeString, sanitizeToolResult } from '../../src/security/sanitize.js';

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
});