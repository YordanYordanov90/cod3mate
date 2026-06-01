import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Tool } from '../types.js';

/**
 * File tools: safe read/write limited to TMP_DIR.
 * All paths are resolved and must stay inside the allowed root.
 */

export interface FileToolConfig {
  tmpDir: string;
}

export function resolveSafePath(userPath: string, root: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, userPath);

  // Prevent path traversal
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep) && resolvedTarget !== resolvedRoot) {
    throw new Error('Path traversal detected');
  }

  return resolvedTarget;
}

export function createFileReadTool(config: FileToolConfig): Tool<{ path: string; maxBytes?: number }> {
  const { tmpDir } = config;

  return {
    name: 'file_read',
    description: 'Read the contents of a text file under the temporary workspace. Use relative paths only.',
    inputSchema: z.object({
      path: z.string().min(1).describe('Relative path inside the temp directory'),
      maxBytes: z.number().int().positive().max(1_000_000).optional().default(100000).describe('Maximum bytes to read'),
    }),
    execute: async ({ path: userPath, maxBytes = 100_000 }) => {
      try {
        const safePath = resolveSafePath(userPath, tmpDir);

        // Ensure parent exists? No, for read it must exist.
        const content = await readFile(safePath, 'utf8');

        const truncated = content.length > maxBytes ? content.slice(0, maxBytes) : content;

        return {
          ok: true,
          content: truncated,
          metadata: {
            path: userPath,
            bytesRead: truncated.length,
            truncated: content.length > maxBytes,
          },
        };
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          return { ok: false, error: `File not found: ${userPath}` };
        }
        return { ok: false, error: `Failed to read file: ${err.message}` };
      }
    },
  };
}

export function createFileWriteTool(config: FileToolConfig): Tool<{ path: string; content: string; overwrite?: boolean }> {
  const { tmpDir } = config;

  return {
    name: 'file_write',
    description: 'Write text content to a file under the temporary workspace. Creates parent directories if needed. Fails if file exists unless overwrite is true.',
    inputSchema: z.object({
      path: z.string().min(1).describe('Relative path inside the temp directory'),
      content: z.string().describe('Text content to write'),
      overwrite: z.boolean().default(false).describe('Allow overwriting existing file'),
    }),
    execute: async ({ path: userPath, content, overwrite = false }) => {
      try {
        const safePath = resolveSafePath(userPath, tmpDir);

        // Check if exists
        try {
          await (await import('node:fs/promises')).access(safePath);
          if (!overwrite) {
            return { ok: false, error: `File already exists: ${userPath}. Set overwrite=true to replace.` };
          }
        } catch {
          // does not exist, good
        }

        // Ensure parent dir
        await mkdir(path.dirname(safePath), { recursive: true });

        await writeFile(safePath, content, 'utf8');

        return {
          ok: true,
          content: `Successfully wrote ${content.length} bytes to ${userPath}`,
          metadata: { path: userPath, bytesWritten: content.length },
        };
      } catch (err: any) {
        return { ok: false, error: `Failed to write file: ${err.message}` };
      }
    },
  };
}