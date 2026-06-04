import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  ensureDataDirectories,
  getStoragePaths,
  fileExists,
  readTextFile,
  writeTextFile,
  readJsonFile,
  writeJsonFile,
} from '../../src/storage/mod.js';

describe('storage helpers', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('ensureDataDirectories creates data and sessions dirs', async () => {
    await ensureDataDirectories(tempDir);

    const paths = getStoragePaths(tempDir);
    expect(await fileExists(paths.dataDir)).toBe(true);
    expect(await fileExists(paths.sessionsDir)).toBe(true);
    expect(await fileExists(paths.qaReportsDir)).toBe(true);
  });

  it('write/read text roundtrip', async () => {
    const file = path.join(tempDir, 'test.txt');
    await writeTextFile(file, 'hello storage');
    const content = await readTextFile(file);
    expect(content).toBe('hello storage');
  });

  it('readTextFile returns null for missing file', async () => {
    const content = await readTextFile(path.join(tempDir, 'does-not-exist.md'));
    expect(content).toBeNull();
  });

  it('write/read JSON roundtrip', async () => {
    const file = path.join(tempDir, 'session.json');
    const data = { chatId: 123, history: [{ role: 'user', content: 'hi' }] };
    await writeJsonFile(file, data);

    const loaded = await readJsonFile(file);
    expect(loaded).toEqual(data);
  });

  it('getStoragePaths resolves correctly', () => {
    const paths = getStoragePaths('/data');
    expect(paths.soulPath).toMatch(/SOUL\.md$/);
    expect(paths.sessionsDir).toMatch(/sessions$/);
    expect(paths.qaReportsDir).toMatch(/qa-reports$/);
  });
});