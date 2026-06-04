import { z } from 'zod';
import type { Tool } from '../types.js';
import {
  getOrCreatePage,
  getLastNavigationStatus,
  resolveVisibleLocator,
  resolveLocatorAcrossFrames,
  isVisibleAcrossFrames,
} from '../browser/mod.js';
import { recordAssertion } from './report.js';

/**
 * Structured result returned by all QA assertion tools.
 * The agent receives this as JSON in the tool `content` (and duplicated in metadata).
 * Assertions always return ok:true; the `passed` field carries pass/fail.
 */
export interface AssertionResult {
  passed: boolean;
  expected: string;
  actual: string;
  message: string;
}

export interface QaAssertionTools {
  assertVisible: Tool<{ name?: string; selector?: string; text?: string }>;
  assertNotVisible: Tool<{ name?: string; selector?: string; text?: string }>;
  assertTextContains: Tool<{ name?: string; selector?: string; text: string }>;
  assertUrl: Tool<{ name?: string; pattern: string; mode?: 'exact' | 'contains' | 'regex' }>;
  assertElementCount: Tool<{ name?: string; selector: string; expected: number }>;
  assertStatus: Tool<{ name?: string; expected: number }>;
}

export interface QaAssertionsConfig {
  tmpDir: string;
  headless?: boolean;
}

function formatAssertion(result: AssertionResult): string {
  return JSON.stringify(result, null, 2);
}

function deriveCheckName(prefix: string, selector?: string, text?: string): string {
  if (selector) return `${prefix} (${selector})`;
  if (text) return `${prefix} text~"${text.slice(0, 40)}"`;
  return prefix;
}

/**
 * Create the five QA assertion tools.
 * These are pass/fail primitives so the agent does not have to "guess" correctness from free text.
 * All tools search across frames (main + iframes) using the shared browser helpers.
 */
export async function createQaAssertionTools(config: QaAssertionsConfig): Promise<QaAssertionTools> {
  const { tmpDir, headless = true } = config;

  const assertVisible: Tool<{ name?: string; selector?: string; text?: string }> = {
    name: 'qa_assert_visible',
    description:
      'QA assertion: Assert that an element (by CSS "selector" or visible "text") IS visible on the current page. Searches the main frame and all child iframes (cross-frame, works with Clerk/Auth0/Stripe widgets). Waits briefly for async render. Returns structured { passed: boolean, expected: string, actual: string, message: string } as JSON. Use to confirm UI state after navigation/fill/click. Assertion failures are reported via passed:false, not tool error.',
    inputSchema: z
      .object({
        name: z
          .string()
          .optional()
          .describe('Optional short label for this check in the QA report (e.g. "Hero header visible"). If omitted a name is derived from the selector/text.'),
        selector: z.string().optional().describe('CSS selector (e.g. "#submit", "button.primary"). Preferred for precision.'),
        text: z
          .string()
          .optional()
          .describe('Visible text or label to match (case-insensitive, partial). Use when no stable selector (e.g. "Sign in").'),
      })
      .refine((v) => Boolean(v.selector || v.text), {
        message: 'Provide either "selector" or "text".',
      }),
    execute: async ({ name, selector, text }) => {
      const t0 = Date.now();
      const page = await getOrCreatePage(tmpDir, headless);
      const target = selector ? `selector "${selector}"` : `text "${text}"`;
      const expected = `element ${target} is visible`;
      const checkName = name || deriveCheckName('visible', selector, text);
      // Build clean opts to satisfy exactOptionalPropertyTypes
      const visOpts: { selector?: string; text?: string } = {};
      if (selector) visOpts.selector = selector;
      if (text) visOpts.text = text;
      try {
        const loc = await resolveVisibleLocator(page, visOpts, 2000);
        const sample = await loc.innerText().catch(() => '(no innerText)');
        const result: AssertionResult = {
          passed: true,
          expected,
          actual: 'visible',
          message: `Assertion passed: ${expected}. Sample text: ${sample.slice(0, 140)}`,
        };
        const dur = Date.now() - t0;
        recordAssertion(checkName, result, dur);
        const meta = { passed: result.passed, expected: result.expected, actual: result.actual, message: result.message, sample: sample.slice(0, 300) };
        return { ok: true, content: formatAssertion(result), metadata: meta };
      } catch (err: any) {
        const result: AssertionResult = {
          passed: false,
          expected,
          actual: 'not visible or not found',
          message: err?.message || `Element ${target} is not visible on page or any frame.`,
        };
        const dur = Date.now() - t0;
        recordAssertion(checkName, result, dur);
        const meta = { passed: result.passed, expected: result.expected, actual: result.actual, message: result.message };
        return { ok: true, content: formatAssertion(result), metadata: meta };
      }
    },
  };

  const assertNotVisible: Tool<{ name?: string; selector?: string; text?: string }> = {
    name: 'qa_assert_not_visible',
    description:
      'QA assertion: Assert that something is NOT visible (or absent entirely). Fast check (short timeout, no long wait). Ideal for confirming error banners are absent, modals closed, success state has no "loading", etc. Searches all frames. Returns structured pass/fail JSON.',
    inputSchema: z
      .object({
        name: z.string().optional().describe('Optional label for this check in the QA report (e.g. "No error banner").'),
        selector: z.string().optional(),
        text: z.string().optional(),
      })
      .refine((v) => Boolean(v.selector || v.text), {
        message: 'Provide either "selector" or "text".',
      }),
    execute: async ({ name, selector, text }) => {
      const t0 = Date.now();
      const page = await getOrCreatePage(tmpDir, headless);
      const target = selector ? `selector "${selector}"` : `text "${text}"`;
      const expected = `element ${target} is not visible`;
      const checkName = name || deriveCheckName('not-visible', selector, text);
      const visOpts: { selector?: string; text?: string } = {};
      if (selector) visOpts.selector = selector;
      if (text) visOpts.text = text;
      const isVis = await isVisibleAcrossFrames(page, visOpts);
      const passed = !isVis;
      const result: AssertionResult = {
        passed,
        expected,
        actual: isVis ? 'visible' : 'not visible',
        message: passed
          ? `Assertion passed: ${expected}.`
          : `Assertion failed: ${target} was found and is visible (should be absent).`,
      };
      const dur = Date.now() - t0;
      recordAssertion(checkName, result, dur);
      const meta = { passed: result.passed, expected: result.expected, actual: result.actual, message: result.message };
      return { ok: true, content: formatAssertion(result), metadata: meta };
    },
  };

  const assertTextContains: Tool<{ name?: string; selector?: string; text: string }> = {
    name: 'qa_assert_text_contains',
    description:
      'QA assertion: Assert a page element (or the document body when selector omitted) contains the expected substring. Selector is resolved cross-frame. Match is case-sensitive substring search on innerText. Returns structured JSON result.',
    inputSchema: z.object({
      name: z.string().optional().describe('Optional label for this text check in the QA report (e.g. "Welcome message present").'),
      selector: z
        .string()
        .optional()
        .describe('CSS selector of the container element. Omit to check combined visible text across main body + frames.'),
      text: z.string().min(1).describe('Substring that must appear in the matched element\'s text.'),
    }),
    execute: async ({ name, selector, text }) => {
      const t0 = Date.now();
      const page = await getOrCreatePage(tmpDir, headless);
      const targetDesc = selector ? `selector "${selector}"` : 'page body (all frames)';
      const expected = `${targetDesc} text contains "${text}"`;
      const checkName = name || deriveCheckName('text-contains', selector, text ? `"${text}"` : undefined);
      try {
        let actual = '';
        if (selector) {
          const loc = await resolveLocatorAcrossFrames(page, selector, 2000);
          actual = await loc.innerText().catch(() => '');
        } else {
          // Aggregate text from all frames for a whole-page contains check
          const parts: string[] = [];
          for (const frame of page.frames()) {
            try {
              const t = await frame.locator('body').innerText({ timeout: 1200 }).catch(() => '');
              if (t) parts.push(t);
            } catch {
              /* ignore detached/cross-origin */
            }
          }
          actual = parts.join('\n---\n');
        }
        const passed = actual.includes(text);
        const result: AssertionResult = {
          passed,
          expected,
          actual: passed
            ? `contains (total chars=${actual.length})`
            : `does not contain; first 400 chars: ${actual.slice(0, 400)}`,
          message: passed
            ? `Assertion passed: ${expected}.`
            : `Assertion failed: ${expected} — substring was not present in actual text.`,
        };
        const dur = Date.now() - t0;
        recordAssertion(checkName, result, dur);
        const meta = { passed: result.passed, expected: result.expected, actual: result.actual, message: result.message, actualSample: actual.slice(0, 800) };
        return { ok: true, content: formatAssertion(result), metadata: meta };
      } catch (err: any) {
        const result: AssertionResult = {
          passed: false,
          expected,
          actual: 'lookup error: ' + (err?.message || String(err)),
          message: `Failed while checking text contains: ${err?.message || err}`,
        };
        const dur = Date.now() - t0;
        recordAssertion(checkName, result, dur);
        const meta = { passed: result.passed, expected: result.expected, actual: result.actual, message: result.message };
        return { ok: true, content: formatAssertion(result), metadata: meta };
      }
    },
  };

  const assertUrl: Tool<{ name?: string; pattern: string; mode?: 'exact' | 'contains' | 'regex' }> = {
    name: 'qa_assert_url',
    description:
      'QA assertion: Assert the current browser URL (after any redirects) matches a pattern. Modes: "exact" (full equality), "contains" (default: substring), "regex" (treated as RegExp). Always returns structured result (no execution error on mismatch).',
    inputSchema: z.object({
      name: z.string().optional().describe('Optional label for this URL check in the QA report.'),
      pattern: z.string().min(1).describe('Pattern or substring/regex to match against page.url()'),
      mode: z.enum(['exact', 'contains', 'regex']).optional().default('contains').describe('How to interpret the pattern'),
    }),
    execute: async ({ name, pattern, mode = 'contains' }) => {
      const t0 = Date.now();
      const page = await getOrCreatePage(tmpDir, headless);
      const currentUrl = page.url() || '';
      let passed = false;
      if (mode === 'exact') {
        passed = currentUrl === pattern;
      } else if (mode === 'regex') {
        try {
          const re = new RegExp(pattern);
          passed = re.test(currentUrl);
        } catch (e: any) {
          passed = false;
        }
      } else {
        passed = currentUrl.includes(pattern);
      }
      const expected = `URL ${mode}-matches "${pattern}"`;
      const result: AssertionResult = {
        passed,
        expected,
        actual: currentUrl,
        message: passed
          ? `Assertion passed: current URL "${currentUrl}" ${mode}-matches "${pattern}".`
          : `Assertion failed: current URL "${currentUrl}" does not ${mode}-match pattern "${pattern}".`,
      };
      const dur = Date.now() - t0;
      const checkName = name || `url-${mode} ${pattern}`;
      recordAssertion(checkName, result, dur);
      const meta = { passed: result.passed, expected: result.expected, actual: result.actual, message: result.message, currentUrl };
      return { ok: true, content: formatAssertion(result), metadata: meta };
    },
  };

  const assertElementCount: Tool<{ name?: string; selector: string; expected: number }> = {
    name: 'qa_assert_element_count',
    description:
      'QA assertion: Count elements matching the CSS selector (sum across main frame + all iframes) and assert the total equals the "expected" integer. Works for table rows, list items, etc. Elements need not be visible. Returns structured pass/fail JSON.',
    inputSchema: z.object({
      name: z.string().optional().describe('Optional label for this count assertion in the QA report (e.g. "3 results rows").'),
      selector: z.string().min(1).describe('CSS selector whose matches will be counted (e.g. "tr.data-row", ".result")'),
      expected: z.number().int().min(0).describe('The exact count you require (total across all frames)'),
    }),
    execute: async ({ name, selector, expected }) => {
      const t0 = Date.now();
      const page = await getOrCreatePage(tmpDir, headless);
      let total = 0;
      const breakdown: Array<{ frame: string; count: number }> = [];
      for (const frame of page.frames()) {
        try {
          const count = await frame.locator(selector).count();
          total += count;
          const fLabel = frame === page.mainFrame() ? 'main' : (frame.url() || 'iframe').slice(0, 60);
          breakdown.push({ frame: fLabel, count });
        } catch {
          breakdown.push({ frame: 'error-frame', count: 0 });
        }
      }
      const passed = total === expected;
      const result: AssertionResult = {
        passed,
        expected: `count for "${selector}" == ${expected} (across frames)`,
        actual: `${total}`,
        message: passed
          ? `Assertion passed: found exactly ${total} matching elements.`
          : `Assertion failed: expected ${expected}, found ${total}. Per-frame: ${JSON.stringify(breakdown)}`,
      };
      const dur = Date.now() - t0;
      const checkName = name || `count ${selector}==${expected}`;
      recordAssertion(checkName, result, dur);
      const meta = { passed: result.passed, expected: result.expected, actual: result.actual, message: result.message, total, breakdown };
      return { ok: true, content: formatAssertion(result), metadata: meta };
    },
  };

  const assertStatus: Tool<{ name?: string; expected: number }> = {
    name: 'qa_assert_status',
    description:
      'QA assertion: Assert the HTTP status code of the last browser_navigate call (main document response). Run browser_navigate first. Returns structured pass/fail JSON. Use to verify pages return 200, or that error routes return 404, etc.',
    inputSchema: z.object({
      name: z.string().optional().describe('Optional label for this check in the QA report.'),
      expected: z
        .number()
        .int()
        .min(100)
        .max(599)
        .describe('Expected HTTP status from the last navigation (e.g. 200, 404)'),
    }),
    execute: async ({ name, expected }) => {
      const t0 = Date.now();
      await getOrCreatePage(tmpDir, headless);
      const actualStatus = getLastNavigationStatus();
      const expectedStr = `HTTP status == ${expected}`;
      const checkName = name || `status == ${expected}`;

      if (actualStatus === null) {
        const result: AssertionResult = {
          passed: false,
          expected: expectedStr,
          actual: 'no navigation recorded (call browser_navigate first)',
          message: 'Assertion failed: no browser_navigate has run since the last browser_reset.',
        };
        const dur = Date.now() - t0;
        recordAssertion(checkName, result, dur);
        return {
          ok: true,
          content: formatAssertion(result),
          metadata: { passed: result.passed, expected: result.expected, actual: result.actual, message: result.message },
        };
      }

      const passed = actualStatus === expected;
      const result: AssertionResult = {
        passed,
        expected: expectedStr,
        actual: String(actualStatus),
        message: passed
          ? `Assertion passed: last navigation returned HTTP ${actualStatus}.`
          : `Assertion failed: expected HTTP ${expected}, last navigation returned ${actualStatus}.`,
      };
      const dur = Date.now() - t0;
      recordAssertion(checkName, result, dur);
      return {
        ok: true,
        content: formatAssertion(result),
        metadata: { passed: result.passed, expected: result.expected, actual: result.actual, message: result.message },
      };
    },
  };

  return {
    assertVisible,
    assertNotVisible,
    assertTextContains,
    assertUrl,
    assertElementCount,
    assertStatus,
  };
}
