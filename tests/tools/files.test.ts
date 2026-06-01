import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createFileReadTool,
  createFileWriteTool,
  resolveSafePath,
} from '../../src/tools/files/mod.js';

describe('file tools — path traversal protection (M6)', () => {
  it('resolves a simple relative path inside the root', () => {
    const out = resolveSafePath('notes/today.md', '/tmp/agent-files');
    expect(out).toBe(path.resolve('/tmp/agent-files/notes/today.md'));
  });

  it('rejects ../ traversal that escapes the root', () => {
    expect(() => resolveSafePath('../etc/passwd', '/tmp/agent-files')).toThrow(
      /traversal/i,
    );
  });

  it('rejects absolute paths outside the root', () => {
    expect(() => resolveSafePath('/etc/passwd', '/tmp/agent-files')).toThrow(
      /traversal/i,
    );
  });

  it('rejects sibling-prefix attacks (e.g. /tmp/agent-files-evil)', () => {
    // path.resolve('/tmp/agent-files', '../agent-files-evil/x') would land in
    // a sibling dir that shares a string prefix with the root.
    expect(() =>
      resolveSafePath('../agent-files-evil/secret', '/tmp/agent-files'),
    ).toThrow(/traversal/i);
  });

  it('allows the root itself as a no-op path', () => {
    // Equal-to-root case must not throw.
    expect(() => resolveSafePath('.', '/tmp/agent-files')).not.toThrow();
  });
});

describe('file_read + file_write integration (M6)', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-files-test-'));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean slate per test
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
  });

  it('writes a file then reads it back', async () => {
    const write = createFileWriteTool({ tmpDir });
    const read = createFileReadTool({ tmpDir });

    const writeRes = await write.execute({
      path: 'hello.txt',
      content: 'hi from cod3mate',
      overwrite: false,
    });
    expect(writeRes.ok).toBe(true);

    const readRes = await read.execute({ path: 'hello.txt' });
    expect(readRes.ok).toBe(true);
    if (readRes.ok) {
      expect(readRes.content).toBe('hi from cod3mate');
    }
  });

  it('refuses to overwrite without overwrite=true', async () => {
    const write = createFileWriteTool({ tmpDir });

    await writeFile(path.join(tmpDir, 'exists.txt'), 'old');

    const res = await write.execute({
      path: 'exists.txt',
      content: 'new',
      overwrite: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/already exists/i);
    }
  });

  it('returns a safe error when reading a missing file (no stack/raw error leakage)', async () => {
    const read = createFileReadTool({ tmpDir });
    const res = await read.execute({ path: 'nope.txt' });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/not found/i);
      expect(res.error).not.toMatch(/at Object\.|at async/); // no raw stack
    }
  });

  it('rejects traversal attempts at the tool layer', async () => {
    const read = createFileReadTool({ tmpDir });
    const res = await read.execute({ path: '../../../etc/passwd' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.toLowerCase()).toMatch(/traversal|failed to read/);
    }
  });
});
