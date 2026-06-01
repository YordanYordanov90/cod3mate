import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadSoul, getDefaultSoulContent } from '../../src/soul/mod.js';
import { ensureDataDirectories, fileExists } from '../../src/storage/mod.js';

describe('soul loader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-soul-test-'));
    await ensureDataDirectories(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads existing SOUL.md', async () => {
    const custom = '# My Custom Soul\nBe excellent.';
    const { soulPath } = (await import('../../src/storage/mod.js')).getStoragePaths(tempDir);
    await (await import('node:fs/promises')).writeFile(soulPath, custom);

    const result = await loadSoul(tempDir);
    expect(result.source).toBe('file');
    expect(result.content).toContain('My Custom Soul');
  });

  it('creates default SOUL.md when missing and logs warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadSoul(tempDir);

    expect(result.source).toBe('default');
    expect(result.content).toBe(getDefaultSoulContent());
    expect(result.content).toContain('Core Rules (non-negotiable)');
    expect(warnSpy).toHaveBeenCalled();

    // File should now exist on disk
    const { soulPath } = (await import('../../src/storage/mod.js')).getStoragePaths(tempDir);
    expect(await fileExists(soulPath)).toBe(true);

    warnSpy.mockRestore();
  });

  it('default soul contains required security language', () => {
    const def = getDefaultSoulContent();
    expect(def).toContain('Security, access control');
    expect(def).toContain('Never output, store, or transmit any API keys');
  });
});