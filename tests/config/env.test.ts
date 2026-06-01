import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadEnv, getEnvSummary, type Env } from '../../src/config/env.js';

describe('env validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Clear relevant keys for isolation
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALLOWED_USER_ID;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_PRIMARY_MODEL;
    delete process.env.OPENAI_FALLBACK_MODEL;
    delete process.env.TAVILY_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads valid environment with defaults', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
    process.env.TELEGRAM_ALLOWED_USER_ID = '987654321';
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    process.env.OPENAI_PRIMARY_MODEL = 'gpt-test-primary';
    process.env.OPENAI_FALLBACK_MODEL = 'gpt-test-fallback';
    process.env.TAVILY_API_KEY = 'tvly-test';

    const env = loadEnv();

    expect(env.TELEGRAM_ALLOWED_USER_ID).toBe(987654321);
    expect(env.OPENAI_PRIMARY_MODEL).toBe('gpt-test-primary');
    expect(env.TAVILY_SEARCH_ENDPOINT).toBe('https://api.tavily.com/search'); // default
    expect(env.MAX_AGENT_ITERATIONS).toBe(8);
    expect(env.ENABLE_FILE_LOGS).toBe(false);
  });

  it('fails fast and exits when required vars are missing', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => loadEnv()).toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalled();

    const errorCalls = mockError.mock.calls.flat().join(' ');
    expect(errorCalls).toContain('Environment validation failed');
    // Key *names* are intentionally printed for actionable errors.
    // Ensure no secret *values* (we cleared env in this test).
    expect(errorCalls).not.toMatch(/sk-test-openai|test-token|tvly-test|real-/i);

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('getEnvSummary redacts secret values', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'real-secret-token';
    process.env.TELEGRAM_ALLOWED_USER_ID = '111222333';
    process.env.OPENAI_API_KEY = 'sk-real-openai-key';
    process.env.OPENAI_PRIMARY_MODEL = 'primary-model';
    process.env.OPENAI_FALLBACK_MODEL = 'fallback-model';
    process.env.TAVILY_API_KEY = 'tvly-real';

    const env = loadEnv();
    const summary = getEnvSummary(env);

    expect(summary.hasTelegramToken).toBe(true);
    expect(summary.hasOpenAIKey).toBe(true);
    expect(summary.hasTavilyKey).toBe(true);
    expect(summary).not.toHaveProperty('TELEGRAM_BOT_TOKEN');
    expect(summary).not.toHaveProperty('OPENAI_API_KEY');
    expect(summary).not.toHaveProperty('TAVILY_API_KEY');
    expect(summary.TELEGRAM_ALLOWED_USER_ID).toBe(111222333);
  });
});