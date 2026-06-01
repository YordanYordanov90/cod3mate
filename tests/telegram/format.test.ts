import { describe, it, expect } from 'vitest';
import { chunkMessage } from '../../src/telegram/format.js';

describe('telegram chunkMessage', () => {
  it('returns original text when under limit', () => {
    const text = 'short message';
    expect(chunkMessage(text, { maxChunkSize: 100 })).toEqual([text]);
  });

  it('returns empty array for empty input', () => {
    expect(chunkMessage('', { maxChunkSize: 100 })).toEqual([]);
  });

  it('splits on paragraph boundaries when possible', () => {
    const text = 'Paragraph one.\n\nParagraph two is longer.\n\nParagraph three.';
    const chunks = chunkMessage(text, { maxChunkSize: 30 });

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be reasonably sized
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(30));
    // Content preserved
    expect(chunks.join('\n\n')).toContain('Paragraph one');
  });

  it('falls back to hard split when no good boundaries exist', () => {
    const long = 'a'.repeat(100);
    const chunks = chunkMessage(long, { maxChunkSize: 30 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(long);
  });

  it('never produces chunks larger than the limit', () => {
    const text = 'word '.repeat(200);
    const chunks = chunkMessage(text, { maxChunkSize: 50 });
    chunks.forEach((c) => {
      expect(c.length).toBeLessThanOrEqual(50);
    });
  });

  it('handles multiple consecutive newlines gracefully', () => {
    const text = 'First\n\n\n\nSecond block here with more text to force split.';
    const chunks = chunkMessage(text, { maxChunkSize: 20 });
    expect(chunks.length).toBeGreaterThan(0);
  });
});