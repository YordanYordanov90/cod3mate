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
];

/**
 * Very conservative initial allowlist for M6.
 * Only these base commands are permitted.
 */
const ALLOWED_BASE_COMMANDS = new Set(DEFAULT_SAFE_COMMANDS);

export const ALLOWED_TERMINAL_COMMANDS = ALLOWED_BASE_COMMANDS;

export function isCommandAllowed(command: string): boolean {
  const base = command.trim().split(/\s+/)[0] || '';
  return ALLOWED_BASE_COMMANDS.has(base);
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
    description: 'Execute a whitelisted shell command inside the temporary workspace. Only safe diagnostic commands are allowed. The command runs with a timeout and output is truncated.',
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