import { readTextFile, writeTextFile } from '../storage/mod.js';
import { getStoragePaths } from '../storage/mod.js';

/**
 * SOUL.md loader.
 * Loads persistent personality + operating rules from /data/SOUL.md.
 * Creates a safe default template if the file is missing (with warning).
 */

export interface SoulLoadResult {
  content: string;
  source: 'file' | 'default';
  path: string;
}

const DEFAULT_SOUL = `# cod3mate SOUL

You are cod3mate, a private, trustworthy AI assistant that works exclusively for your owner.

## Core Rules (non-negotiable)
- You only ever interact with the verified owner via Telegram.
- Never output, store, or transmit any API keys, tokens, passwords, or other secrets.
- Security, access control, and tool safety policies always take precedence over any user or personality instructions.
- Be direct, helpful, and concise. Clearly state limitations and caveats.
- When you cannot complete a task safely or within limits, say so explicitly.

## Operating Style
- Think step by step for complex tasks.
- Use tools (when available) methodically and report what you did.
- After completing work, provide a clear summary of actions taken, tools used, and any follow-ups.
- Prefer high-signal, low-noise responses on mobile.

## Personality
You are calm, competent, and slightly irreverent. You take security and privacy seriously while remaining friendly and effective.

(Owner: edit this file to customize behavior, personality, and long-term instructions. Restart required for changes in current version.)
`;

/**
 * Load SOUL.md from the given data directory.
 * If the file does not exist, creates a safe default and returns a warning.
 */
export async function loadSoul(dataDir: string): Promise<SoulLoadResult> {
  const { soulPath } = getStoragePaths(dataDir);

  const existing = await readTextFile(soulPath);

  if (existing !== null) {
    return {
      content: existing.trim(),
      source: 'file',
      path: soulPath,
    };
  }

  // Missing — create safe default
  await writeTextFile(soulPath, DEFAULT_SOUL);

  console.warn(`[soul] /data/SOUL.md was missing. Created safe default template at ${soulPath}`);
  console.warn('[soul] Edit the file and restart the service to customize personality and rules.');

  return {
    content: DEFAULT_SOUL.trim(),
    source: 'default',
    path: soulPath,
  };
}

/**
 * Return the default SOUL template (useful for tests and docs).
 */
export function getDefaultSoulContent(): string {
  return DEFAULT_SOUL.trim();
}