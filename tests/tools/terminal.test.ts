import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createTerminalExecTool,
  isCommandAllowed,
  resolveSafeCwd,
  ALLOWED_TERMINAL_COMMANDS,
} from '../../src/tools/terminal/mod.js';

describe('terminal allowlist policy (M6)', () => {
  it('allows safe diagnostic base commands', () => {
    for (const cmd of ['pwd', 'ls -la', 'echo hello', 'node --version']) {
      expect(isCommandAllowed(cmd)).toBe(true);
    }
  });

  it('rejects commands not on the allowlist', () => {
    for (const cmd of ['rm -rf /', 'curl example.com', 'bash -c whoami', 'sudo ls']) {
      expect(isCommandAllowed(cmd)).toBe(false);
    }
  });

  it('rejects empty or whitespace-only commands', () => {
    expect(isCommandAllowed('')).toBe(false);
    expect(isCommandAllowed('   ')).toBe(false);
  });

  it('exposes the allowlist for documentation/help text', () => {
    expect(ALLOWED_TERMINAL_COMMANDS.has('pwd')).toBe(true);
    expect(ALLOWED_TERMINAL_COMMANDS.has('rm')).toBe(false);
  });
});

describe('terminal cwd sandboxing (M6)', () => {
  const TMP = '/tmp/agent-files';

  it('resolves no cwd to the root', () => {
    expect(resolveSafeCwd('', TMP)).toBe(path.resolve(TMP));
  });

  it('resolves a relative subdirectory inside the root', () => {
    expect(resolveSafeCwd('work/proj', TMP)).toBe(
      path.resolve(TMP, 'work/proj'),
    );
  });

  it('rejects ../ traversal that escapes the root', () => {
    expect(() => resolveSafeCwd('../etc', TMP)).toThrow(/invalid working directory/i);
  });

  it('rejects sibling-prefix bypass (/tmp/agent-files-evil)', () => {
    // This is the exact bug the new resolveSafeCwd guards against.
    expect(() => resolveSafeCwd('../agent-files-evil', TMP)).toThrow(
      /invalid working directory/i,
    );
  });

  it('rejects absolute paths outside the root', () => {
    expect(() => resolveSafeCwd('/etc', TMP)).toThrow(/invalid working directory/i);
  });
});

describe('terminal_exec tool — surface behavior (M6)', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-term-test-'));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns a safe error for a disallowed command (does not execute it)', async () => {
    const tool = createTerminalExecTool({ tmpDir });
    const res = await tool.execute({ command: 'rm -rf /', cwd: '', timeoutMs: 5000 });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/not allowed/i);
      expect(res.error).toContain('pwd');
    }
  });

  it('returns a safe error when cwd escapes the sandbox', async () => {
    const tool = createTerminalExecTool({ tmpDir });
    const res = await tool.execute({
      command: 'pwd',
      cwd: '../../../etc',
      timeoutMs: 5000,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/invalid working directory/i);
    }
  });

  it('executes a whitelisted command and returns its output', async () => {
    const tool = createTerminalExecTool({ tmpDir });
    const res = await tool.execute({ command: 'echo cod3mate', cwd: '', timeoutMs: 5000 });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('cod3mate');
    }
  });
});
