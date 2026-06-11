import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ensureDataDirectories } from '../../src/storage/mod.js';
import {
  loadSession,
  saveSession,
  resetSession,
  appendMessage,
  createEmptySession,
  rewindSession,
} from '../../src/storage/sessions.js';

describe('session persistence', () => {
  let tempDir: string;
  const chatId = 42424242;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-session-test-'));
    await ensureDataDirectories(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loadSession returns empty session when none exists', async () => {
    const session = await loadSession(chatId, tempDir);
    expect(session.chatId).toBe(chatId);
    expect(session.history).toEqual([]);
  });

  it('save and load roundtrip', async () => {
    const session = createEmptySession(chatId);
    session.history.push({ role: 'user', content: 'hello', timestamp: new Date().toISOString() });

    await saveSession(session, tempDir);

    const loaded = await loadSession(chatId, tempDir);
    expect(loaded.history.length).toBe(1);
    expect(loaded.history[0].content).toBe('hello');
  });

  it('resetSession removes the file', async () => {
    await appendMessage(chatId, 'user', 'test message', tempDir);

    await resetSession(chatId, tempDir);

    const fresh = await loadSession(chatId, tempDir);
    expect(fresh.history).toEqual([]);
  });

  it('appendMessage adds and persists', async () => {
    await appendMessage(chatId, 'user', 'first', tempDir);
    await appendMessage(chatId, 'assistant', 'reply', tempDir);

    const loaded = await loadSession(chatId, tempDir);
    expect(loaded.history).toHaveLength(2);
    expect(loaded.history[1].role).toBe('assistant');
  });

  it('rewindSession removes the last exchange pair', async () => {
    await appendMessage(chatId, 'user', 'one', tempDir);
    await appendMessage(chatId, 'assistant', 'two', tempDir);
    await appendMessage(chatId, 'user', 'three', tempDir);
    await appendMessage(chatId, 'assistant', 'four', tempDir);

    const result = await rewindSession(chatId, 1, tempDir);
    expect(result.removedPairs).toBe(1);
    expect(result.remainingMessages).toBe(2);

    const loaded = await loadSession(chatId, tempDir);
    expect(loaded.history.map((m) => m.content)).toEqual(['one', 'two']);
  });

  it('rewindSession handles empty history', async () => {
    const result = await rewindSession(chatId, 1, tempDir);
    expect(result.removedPairs).toBe(0);
    expect(result.remainingMessages).toBe(0);
  });
});