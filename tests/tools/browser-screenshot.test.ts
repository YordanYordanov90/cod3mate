import { describe, it, expect } from 'vitest';
import { resolveScreenshotFilename } from '../../src/tools/browser/mod.js';

describe('resolveScreenshotFilename', () => {
  it('uses a timestamped .png name when path is omitted', () => {
    expect(resolveScreenshotFilename()).toMatch(/^screenshot-\d+\.png$/);
  });

  it('uses a timestamped .png name when path is empty or whitespace', () => {
    expect(resolveScreenshotFilename('')).toMatch(/^screenshot-\d+\.png$/);
    expect(resolveScreenshotFilename('   ')).toMatch(/^screenshot-\d+\.png$/);
  });

  it('adds .png when path has no extension', () => {
    expect(resolveScreenshotFilename('forge')).toBe('forge.png');
  });

  it('preserves supported extensions', () => {
    expect(resolveScreenshotFilename('capture.png')).toBe('capture.png');
    expect(resolveScreenshotFilename('capture.jpg')).toBe('capture.jpg');
    expect(resolveScreenshotFilename('capture.jpeg')).toBe('capture.jpeg');
  });

  it('sanitizes unsafe characters', () => {
    expect(resolveScreenshotFilename('my shot!')).toBe('my_shot_.png');
  });
});
