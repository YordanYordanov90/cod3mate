import { describe, it, expect } from 'vitest';
import { createBot } from '../../src/telegram/bot.js';
import type { Env } from '../../src/config/env.js';

// Minimal valid env for bot creation tests (real token not needed for construction)
const fakeEnv: Env = {
  TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
  TELEGRAM_ALLOWED_USER_ID: 123456789,
  OPENAI_API_KEY: 'sk-fake',
  OPENAI_PRIMARY_MODEL: 'gpt-test-primary',
  OPENAI_FALLBACK_MODEL: 'gpt-test-fallback',
  TAVILY_API_KEY: 'tvly-fake',
  TAVILY_SEARCH_ENDPOINT: 'https://api.tavily.com/search',
  DATA_DIR: '/data',
  TMP_DIR: '/tmp/agent-files',
  MAX_AGENT_ITERATIONS: 8,
  MAX_TOOL_OUTPUT_CHARS: 12000,
  TELEGRAM_CHUNK_SIZE: 3500,
  LOG_LEVEL: 'info',
  ENABLE_FILE_LOGS: false,
};

describe('telegram bot creation (M3 sessions)', () => {
  const mockSession = {
    loadSession: async () => ({ chatId: 123, history: [], lastUpdated: new Date().toISOString() }),
    resetSession: async () => {},
    appendMessage: async () => ({ chatId: 123, history: [], lastUpdated: new Date().toISOString() }),
  };

  it('creates a bot instance without throwing with full dependencies', () => {
    const bot = createBot({
      env: fakeEnv,
      dataDir: '/tmp/test-data',
      ...mockSession,
    });
    expect(bot).toBeDefined();
    expect(typeof bot.start).toBe('function');
  });

  it('creates bot with mocked session functions (proves DI works)', () => {
    const bot = createBot({
      env: fakeEnv,
      dataDir: '/tmp/test-data',
      ...mockSession,
    });
    expect(bot).toBeDefined();
  });
});