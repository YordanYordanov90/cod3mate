import { z } from 'zod';
import type { Tool } from '../types.js';
import {
  getOrCreatePage,
  getCapturedConsoleErrors,
  getCapturedNetworkFailures,
  getCapturedResponses,
} from '../browser/mod.js';

/**
 * QA monitoring / observation tools (Phase 3).
 * Passively capture console and network activity via Playwright listeners
 * attached in browser/mod.ts. Data is cleared on explicit navigate/reset.
 */

export interface QaMonitoringTools {
  checkConsoleErrors: Tool<Record<string, never>>;
  checkNetworkFailures: Tool<Record<string, never>>;
  interceptApi: Tool<{ pattern: string }>;
}

export interface QaMonitoringConfig {
  tmpDir: string;
  headless?: boolean;
}

export async function createQaMonitoringTools(config: QaMonitoringConfig): Promise<QaMonitoringTools> {
  const { tmpDir, headless = true } = config;

  const checkConsoleErrors: Tool<Record<string, never>> = {
    name: 'qa_check_console_errors',
    description:
      'QA observation: Return console.error and console.warn messages captured (from main frame and iframes) since the last browser_navigate or browser_reset. Helps catch silent JS errors, unhandled exceptions, and warnings not visible in the DOM. Returns formatted list or "none".',
    inputSchema: z.object({}),
    execute: async () => {
      await getOrCreatePage(tmpDir, headless); // ensure listeners are active
      const entries = getCapturedConsoleErrors();
      if (entries.length === 0) {
        return {
          ok: true,
          content: 'No console.error or console.warn captured since last navigation/reset.',
          metadata: { count: 0 },
        };
      }
      const lines = entries.map((e) => `[${e.type.toUpperCase()}] ${e.text} @ ${e.timestamp}`);
      return {
        ok: true,
        content: lines.join('\n'),
        metadata: { count: entries.length, entries },
      };
    },
  };

  const checkNetworkFailures: Tool<Record<string, never>> = {
    name: 'qa_check_network_failures',
    description:
      'QA observation: List failed network requests (4xx/5xx status codes, timeouts, aborts, connection errors) captured since last navigation/reset. Includes URL, method, status, and error details. Useful for catching silent API failures.',
    inputSchema: z.object({}),
    execute: async () => {
      await getOrCreatePage(tmpDir, headless);
      const entries = getCapturedNetworkFailures();
      if (entries.length === 0) {
        return {
          ok: true,
          content: 'No network failures (4xx/5xx or errors) captured since last navigation/reset.',
          metadata: { count: 0 },
        };
      }
      const lines = entries.map((e) => {
        const statusPart = e.status ? `status=${e.status}` : '';
        const errPart = e.errorText ? `error=${e.errorText}` : '';
        return `[${e.method}] ${e.url} ${statusPart} ${errPart} @ ${e.timestamp}`.trim();
      });
      return {
        ok: true,
        content: lines.join('\n'),
        metadata: { count: entries.length, entries },
      };
    },
  };

  const interceptApi: Tool<{ pattern: string }> = {
    name: 'qa_intercept_api',
    description:
      'QA observation: Return captured response(s) (including truncated body) for any response whose URL contains the given pattern (case-insensitive substring match). Call after actions that trigger API calls to inspect backend responses for validation (e.g. error payloads, data shapes). Bodies truncated to ~4KB.',
    inputSchema: z.object({
      pattern: z
        .string()
        .min(1)
        .describe('URL pattern to match (substring, e.g. "/api/users", "graphql", "login"). Case-insensitive.'),
    }),
    execute: async ({ pattern }) => {
      await getOrCreatePage(tmpDir, headless);
      const p = pattern.toLowerCase();
      const matches = getCapturedResponses().filter((r) => r.url.toLowerCase().includes(p));
      if (matches.length === 0) {
        return {
          ok: true,
          content: `No responses captured matching pattern "${pattern}" since last navigation/reset.`,
          metadata: { count: 0, pattern },
        };
      }
      // Return the most recent match prominently + count of others
      const latest = matches[matches.length - 1]!;
      const others = matches.length > 1 ? ` (${matches.length - 1} other match(es))` : '';
      const content = [
        `Latest match for "${pattern}"${others}:`,
        `URL: ${latest.url}`,
        `Status: ${latest.status}`,
        `Method: ${latest.method || 'unknown'}`,
        `Timestamp: ${latest.timestamp}`,
        `Body:`,
        latest.body || '(empty)',
      ].join('\n');
      return {
        ok: true,
        content,
        metadata: { count: matches.length, pattern, latest, allMatches: matches.slice(-5) }, // last few
      };
    },
  };

  return {
    checkConsoleErrors,
    checkNetworkFailures,
    interceptApi,
  };
}
