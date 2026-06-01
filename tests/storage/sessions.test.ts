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
});