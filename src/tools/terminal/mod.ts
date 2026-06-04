import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { z } from 'zod';
import type { Tool } from '../types.js';

const execAsync = promisify(exec);

/**
 * Terminal execution tool with strict constraints.
 */

export interface TerminalToolConfig {
  tmpDir: string;
  /** Maximum output characters (from env MAX_TOOL_OUTPUT_CHARS) */
  maxOutputChars?: number;
}

const DEFAULT_SAFE_COMMANDS = [
  'pwd',
  'ls',
  'echo',
  'date',
  'node',
  'npm',
  'which',
  'cat',
  'head',
  'tail',
  'wc',
  'find', // limited
  // Phase 6: QA expansions (grep for logs, curl for endpoints, npx for test runners, git read-only)
  'grep',
  'curl',
  'npx',
  'git',
];

/**
 * Very conservative initial allowlist for M6.
 * Only these base commands are permitted. git and curl have additional subcommand/flag guards.
 */
const ALLOWED_BASE_COMMANDS = new Set(DEFAULT_SAFE_COMMANDS);

export const ALLOWED_TERMINAL_COMMANDS = ALLOWED_BASE_COMMANDS;

export function isCommandAllowed(command: string): boolean {
  const trimmed = (command || '').trim();
  if (!trimmed) return false;

  const base = trimmed.split(/\s+/)[0] || '';
  if (!ALLOWED_BASE_COMMANDS.has(base)) return false;

  if (base === 'git') {
    return isGitReadOnlyCommand(trimmed);
  }
  if (base === 'curl') {
    return isCurlSafeCommand(trimmed);
  }
  if (base === 'npx') {
    return isNpxSafeCommand(trimmed);
  }
  return true;
}

/**
 * Git subcommand guard (Phase 6).
 * Only permits clearly read-only operations. Blocks any mutating action
 * (push, commit, reset --hard, clone, fetch, checkout, etc.) even if disguised.
 */
function isGitReadOnlyCommand(cmd: string): boolean {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  if (parts[0] !== 'git') return false;

  const lower = cmd.toLowerCase();

  // Explicit blocklist for anything that mutates repo or remote state
  const mutating = [
    'push', 'commit', 'reset', 'checkout', 'clean', 'merge', 'rebase',
    'fetch', 'pull', 'clone', 'add', 'rm ', 'mv ', 'stash apply', 'apply ',
    'format-patch', 'am ', 'bisect run', 'worktree add', 'submodule update',
    'init', 'config --global',
  ];
  if (mutating.some((m) => lower.includes(m))) return false;

  // Block dangerous force/hard flags anywhere
  if (lower.includes('--force') || /\s-f(\s|$)/.test(lower) || lower.includes('--hard')) {
    return false;
  }

  // Locate subcommand, skipping git global options that take a value.
  // Note: --version / --help / -v / -h are "subcommands" that start with -; treat specially.
  let idx = 1;
  const valueFlags = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix']);
  while (idx < parts.length) {
    const p = parts[idx];
    if (!p) break;
    if (p.startsWith('-')) {
      if (valueFlags.has(p)) {
        idx += 2; // skip flag + value
        continue;
      }
      // --version / --help etc. are the "action" even though dashed; do not skip over them as plain flags
      if (p === '--version' || p === '-v' || p === '--help' || p === '-h') {
        break;
      }
      idx++;
      continue;
    }
    break;
  }

  const rawSub = (parts[idx] || '').toLowerCase();
  const sub = rawSub.replace(/^-+/, '');

  // git config can mutate repo or global settings — never allow in the sandbox
  if (sub === 'config') return false;

  const safeSubs = new Set([
    'status', 'log', 'diff', 'show', 'branch', 'ls-files', 'ls-tree',
    'rev-parse', 'describe', 'remote', 'tag', 'version', 'help',
    'ls-remote', 'blame', 'shortlog', 'whatchanged',
    'h', // for -h
  ]);

  if (safeSubs.has(sub) || rawSub === '--version' || rawSub === '-v' || rawSub === '--help' || rawSub === '-h') {
    return true;
  }
  return false;
}

/**
 * npx guard: only known QA/dev runners (no `npx -y <arbitrary-package>`).
 */
const NPX_ALLOWED_PACKAGES = new Set([
  'vitest',
  'playwright',
  '@playwright/test',
  'typescript',
  'eslint',
  'tsx',
  'prettier',
]);

function isNpxSafeCommand(cmd: string): boolean {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  if (parts[0] !== 'npx') return false;

  let i = 1;
  const flagsWithValue = new Set(['--node-options', '--package']);
  while (i < parts.length) {
    const p = parts[i]!;
    const lower = p.toLowerCase();
    if (lower === '--version' || lower === '-v') return true;
    if (lower === '-y' || lower === '--yes') return false;
    if (p.startsWith('-')) {
      if (flagsWithValue.has(lower)) {
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    break;
  }

  const target = parts[i];
  if (!target) return false;

  const name = target.toLowerCase();
  if (name === 'tsc') return true;
  if (NPX_ALLOWED_PACKAGES.has(name)) return true;
  for (const allowed of NPX_ALLOWED_PACKAGES) {
    if (name === allowed || name.startsWith(`${allowed}@`)) return true;
  }
  return false;
}

/**
 * Curl safety guard (Phase 6).
 * Only safe read/inspect usage: GET, HEAD, OPTIONS by default.
 * Blocks data upload (-d, -F, -T), non-GET methods via -X/--request,
 * and file-writing flags (-o, -O) so output stays in stdout for the agent.
 * This prevents using curl for writes, exfil, or arbitrary method calls inside the sandbox.
 */
function isCurlSafeCommand(cmd: string): boolean {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i];
    if (!raw) continue;
    const p = raw.toLowerCase();

    // Method override: only permit safe read methods
    if (p === '-x' || p === '--request') {
      const method = (parts[i + 1] || '').toUpperCase().replace(/['"]/g, '');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        return false;
      }
    }

    // Data / form / upload payloads (write or POST semantics)
    if (
      ['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(p) ||
      p.startsWith('--data') ||
      ['-f', '--form', '--form-string'].includes(p) ||
      p.startsWith('--form') ||
      ['-t', '--upload-file'].includes(p)
    ) {
      return false;
    }

    // Writing response to disk (we want stdout only; agent can redirect via shell if truly needed,
    // but direct -o would bypass our truncation/metadata and is unnecessary for health/API checks)
    if (['-o', '--output', '-O', '--remote-name', '--remote-header-name'].includes(p)) {
      return false;
    }

    // Cookie jar writes etc. are edge; block common write side effects
    if (p === '--cookie-jar' || p === '--cjar') {
      return false;
    }
  }

  // Heuristic: if a mutating verb appears with -X or as bare word in suspicious way, already caught above.
  // Allow common safe flags like -I (HEAD), -s, -L, --max-time, -H headers, etc.
  return true;
}

/**
 * Resolve `cwd` relative to `tmpDir` and assert it stays inside `tmpDir`.
 * Returns the resolved absolute path, or throws on traversal attempts.
 *
 * Uses the `root + sep` prefix check (plus exact-equal allowance) to prevent
 * sibling-directory bypasses like `/tmp/agent-files-evil` matching `/tmp/agent-files`.
 */
export function resolveSafeCwd(userCwd: string, tmpDir: string): string {
  const resolvedRoot = path.resolve(tmpDir);
  const resolvedTarget = userCwd
    ? path.resolve(resolvedRoot, userCwd)
    : resolvedRoot;

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error('Invalid working directory: must stay inside the temp workspace');
  }

  return resolvedTarget;
}

export function createTerminalExecTool(config: TerminalToolConfig): Tool<{ command: string; cwd?: string; timeoutMs?: number }> {
  const { tmpDir, maxOutputChars = 12000 } = config;

  return {
    name: 'terminal_exec',
    description: 'Execute a whitelisted shell command inside the temporary workspace (cwd sandboxed to tmpDir). Allowed bases: pwd, ls, echo, date, node, npm, which, cat, head, tail, wc, find, grep (search logs/output), curl (read-only: GET/HEAD/OPTIONS, no -d/-F/-X POST/-o writes), git (read-only only: status, log, diff, show, branch, remote -v, ls-files, rev-parse, etc. — NO push/clone/commit/reset/checkout/fetch/config), npx (vitest, playwright, tsc, eslint, tsx, prettier only — no arbitrary packages). Commands are timeout-bounded, output truncated, env sanitized. Use for diagnostics, test runs (npx vitest run), build checks, log inspection, and health endpoint probes.',
    inputSchema: z.object({
      command: z.string().min(1).describe('The shell command to execute (must start with an allowed command)'),
      cwd: z.string().default('').describe('Optional relative working directory inside tmp'),
      timeoutMs: z.number().int().min(1000).max(120000).optional().default(30000).describe('Timeout in milliseconds'),
    }),
    execute: async (input) => {
      const { command, cwd = '', timeoutMs = 30000 } = input;
      if (!isCommandAllowed(command || '')) {
        return {
          ok: false,
          error: `Command not allowed. Allowed base commands: ${Array.from(ALLOWED_BASE_COMMANDS).join(', ')}`,
        };
      }

      let safeCwd: string;
      try {
        safeCwd = resolveSafeCwd(cwd, tmpDir);
      } catch (err: any) {
        return { ok: false, error: err.message || 'Invalid working directory' };
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: safeCwd,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024, // 1MB buffer
          env: {
            // Very sanitized environment
            PATH: process.env.PATH,
            HOME: tmpDir,
            TMPDIR: tmpDir,
            NODE_ENV: 'production',
          },
        });

        let output = (stdout || '') + (stderr || '');
        if (output.length > maxOutputChars) {
          output = output.slice(0, maxOutputChars) + '\n\n[Output truncated]';
        }

        return {
          ok: true,
          content: output.trim() || '(no output)',
          metadata: {
            command,
            cwd: safeCwd,
            exitCode: 0,
          },
        };
      } catch (err: any) {
        const output = (err.stdout || '') + (err.stderr || err.message || '');
        return {
          ok: false,
          error: output.slice(0, maxOutputChars) || `Command failed: ${err.message}`,
          metadata: {
            command,
            exitCode: err.code ?? 1,
          },
        };
      }
    },
  };
}

// Phase 6: exported for unit tests of the new guards + potential tooling
export { isGitReadOnlyCommand, isCurlSafeCommand, isNpxSafeCommand };