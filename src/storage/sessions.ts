import path from 'node:path';
import { readJsonFile, writeJsonFile, getStoragePaths } from './mod.js';

/**
 * Per-chat session persistence.
 * Stores conversation history under /data/sessions/<chatId>.json
 *
 * This is the foundation for the agent loop (Milestone 4+).
 */

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  chatId: number;
  history: SessionMessage[];
  lastUpdated: string;
  /** Per-chat model override (takes precedence over env primary) */
  selectedModel?: string | null;
}

/**
 * Create a fresh empty session for a chat.
 */
export function createEmptySession(chatId: number): ChatSession {
  return {
    chatId,
    history: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Load session for a chat. Returns a fresh empty session if none exists.
 */
export async function loadSession(chatId: number, dataDir: string): Promise<ChatSession> {
  const paths = getStoragePaths(dataDir);
  const filePath = path.join(paths.sessionsDir, `${chatId}.json`);

  const loaded = await readJsonFile<ChatSession>(filePath);
  if (loaded && typeof loaded.chatId === 'number') {
    return loaded;
  }

  return createEmptySession(chatId);
}

/**
 * Save (overwrite) a session.
 */
export async function saveSession(session: ChatSession, dataDir: string): Promise<void> {
  const paths = getStoragePaths(dataDir);
  const filePath = path.join(paths.sessionsDir, `${session.chatId}.json`);

  const toSave: ChatSession = {
    ...session,
    lastUpdated: new Date().toISOString(),
  };

  await writeJsonFile(filePath, toSave);
}

/**
 * Reset (delete) the session file for a chat.
 * After this, loadSession will return a fresh empty session.
 */
export async function resetSession(chatId: number, dataDir: string): Promise<void> {
  const paths = getStoragePaths(dataDir);
  const filePath = path.join(paths.sessionsDir, `${chatId}.json`);

  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(filePath);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    // File didn't exist — that's fine, session is effectively reset.
  }
}

/**
 * Append a message to a session and persist it.
 * Convenience helper for message handlers.
 */
export async function appendMessage(
  chatId: number,
  role: 'user' | 'assistant',
  content: string,
  dataDir: string
): Promise<ChatSession> {
  const session = await loadSession(chatId, dataDir);

  session.history.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });

  await saveSession(session, dataDir);
  return session;
}

/**
 * Set or clear the selected model for a chat session.
 */
export async function setSelectedModel(
  chatId: number,
  model: string | undefined,
  dataDir: string
): Promise<ChatSession> {
  const session = await loadSession(chatId, dataDir);
  session.selectedModel = model ?? null;
  await saveSession(session, dataDir);
  return session;
}

export interface RewindSessionResult {
  removedPairs: number;
  remainingMessages: number;
}

const MAX_REWIND_PAIRS = 50;

/**
 * Remove the last N user/assistant exchange pairs from persisted session history.
 * Roadmap v2 Phase 5 — session only; QA reports and scenarios are unaffected.
 */
export async function rewindSession(
  chatId: number,
  pairs: number,
  dataDir: string
): Promise<RewindSessionResult> {
  const n = Math.min(Math.max(1, Math.floor(pairs)), MAX_REWIND_PAIRS);
  const session = await loadSession(chatId, dataDir);
  const history = [...session.history];
  let removedPairs = 0;

  while (removedPairs < n && history.length > 0) {
    const last = history[history.length - 1];
    if (!last) break;

    if (last.role === 'assistant') {
      history.pop();
      const prev = history[history.length - 1];
      if (prev?.role === 'user') {
        history.pop();
        removedPairs += 1;
        continue;
      }
      break;
    }

    if (last.role === 'user') {
      history.pop();
      const prev = history[history.length - 1];
      if (prev?.role === 'assistant') {
        history.pop();
        removedPairs += 1;
        continue;
      }
      removedPairs += 1;
      break;
    }

    history.pop();
  }

  session.history = history;
  await saveSession(session, dataDir);

  return {
    removedPairs,
    remainingMessages: history.length,
  };
}