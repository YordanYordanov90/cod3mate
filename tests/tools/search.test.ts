import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebSearchTool } from '../../src/tools/search/mod.js';

/**
 * Tavily web_search tool unit tests (M6).
 * The tool talks to Tavily via global `fetch` — we mock it per test.
 */

const FAKE_KEY = 'tvly-test-key';

describe('web_search tool (M6)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('formats normalized results from a successful Tavily response', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Cod3mate docs',
            url: 'https://example.com/docs',
            content: 'A private Telegram-controlled AI agent with tools.',
          },
          {
            title: 'Tavily API',
            url: 'https://tavily.com/api',
            content: 'Search API.',
          },
        ],
      }),
    });

    const tool = createWebSearchTool({ apiKey: FAKE_KEY });
    const res = await tool.execute({ query: 'cod3mate', maxResults: 5 });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('1. Cod3mate docs');
      expect(res.content).toContain('https://example.com/docs');
      expect(res.content).toContain('2. Tavily API');
      expect(res.metadata?.resultCount).toBe(2);
    }
  });

  it('returns a friendly message when Tavily returns zero results', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const tool = createWebSearchTool({ apiKey: FAKE_KEY });
    const res = await tool.execute({ query: 'nothing-here', maxResults: 5 });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toMatch(/no relevant results/i);
    }
  });

  it('returns a safe error when Tavily responds with a non-2xx status', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const tool = createWebSearchTool({ apiKey: FAKE_KEY });
    const res = await tool.execute({ query: 'anything', maxResults: 3 });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Tavily API error/);
      expect(res.error).toContain('401');
    }
  });

  it('returns a safe error when fetch itself throws (network failure)', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const tool = createWebSearchTool({ apiKey: FAKE_KEY });
    const res = await tool.execute({ query: 'anything', maxResults: 3 });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Web search failed/);
    }
  });

  it('sends the API key as a Bearer token and never leaks it in the result', async () => {
    let capturedHeaders: Record<string, string> = {};
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_url: string, init: any) => {
        capturedHeaders = init?.headers ?? {};
        return {
          ok: true,
          json: async () => ({ results: [] }),
        };
      },
    );

    const tool = createWebSearchTool({ apiKey: FAKE_KEY });
    const res = await tool.execute({ query: 'leak check', maxResults: 1 });

    expect(capturedHeaders['Authorization']).toBe(`Bearer ${FAKE_KEY}`);

    // The result must never echo the key back.
    const dump = JSON.stringify(res);
    expect(dump).not.toContain(FAKE_KEY);
  });
});
