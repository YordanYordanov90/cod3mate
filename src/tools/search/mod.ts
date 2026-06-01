import { z } from 'zod';
import type { Tool } from '../types.js';

/**
 * Web search tool using Tavily direct API.
 */

export interface SearchToolConfig {
  apiKey: string;
  endpoint?: string;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

export function createWebSearchTool(config: SearchToolConfig): Tool<{ query: string; maxResults?: number }> {
  const { apiKey, endpoint = 'https://api.tavily.com/search' } = config;

  return {
    name: 'web_search',
    description: 'Search the web using Tavily. Returns relevant results with titles, URLs, and snippets. Use this for up-to-date information.',
    inputSchema: z.object({
      query: z.string().min(3).describe('Search query'),
      maxResults: z.number().int().min(1).max(10).default(5).describe('Maximum number of results'),
    }),
    execute: async ({ query, maxResults = 5 }) => {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query,
            max_results: maxResults,
            include_raw_content: false,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          return { ok: false, error: `Tavily API error (${response.status}): ${text.slice(0, 200)}` };
        }

        const data = await response.json() as { results?: TavilyResult[] };

        const results = (data.results || []).slice(0, maxResults).map((r, i) => ({
          title: r.title || `Result ${i + 1}`,
          url: r.url || '',
          snippet: (r.content || '').slice(0, 500),
        }));

        if (results.length === 0) {
          return { ok: true, content: 'No relevant results found.' };
        }

        const formatted = results.map((r, i) =>
          `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
        ).join('\n\n');

        return {
          ok: true,
          content: formatted,
          metadata: {
            query,
            resultCount: results.length,
            sources: results.map(r => r.url),
          },
        };
      } catch (err: any) {
        return { ok: false, error: `Web search failed: ${err.message}` };
      }
    },
  };
}