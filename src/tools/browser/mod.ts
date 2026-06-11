import { chromium, Browser, BrowserContext, Page, Frame, Locator } from 'playwright';
import { z } from 'zod';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Tool } from '../types.js';
import { isQaReportCollecting, recordQaScreenshot } from '../qa/report.js';

/**
 * Browser automation tools using Playwright.
 *
 * Browser state model (post-M8):
 * - One persistent Chromium instance is launched lazily on first use.
 * - One persistent BrowserContext + Page are reused across tool calls so
 *   multi-step flows (navigate → fill → click → navigate → screenshot)
 *   actually share the same DOM.
 * - The agent can call `browser_reset` to start fresh (new context + page),
 *   e.g. after logout or when switching to an unrelated site.
 * - Everything closes cleanly on shutdown via `closeBrowser()`.
 */

export interface BrowserToolConfig {
  tmpDir: string;
  headless?: boolean;
}

let browserInstance: Browser | null = null;
let currentContext: BrowserContext | null = null;
let currentPage: Page | null = null;

// === Phase 3: Network & Console Observation (QA tools) ===
// Passive capture via Playwright page events. Cleared on navigate/reset.
const MAX_CAPTURED_ENTRIES = 100;
const MAX_BODY_CHARS = 4096;

interface CapturedConsoleEntry {
  type: 'error' | 'warn';
  text: string;
  timestamp: string;
}

interface CapturedNetworkFailure {
  url: string;
  method: string;
  status?: number;
  errorText?: string;
  timestamp: string;
}

interface CapturedResponse {
  url: string;
  status: number;
  method?: string;
  body: string; // truncated
  timestamp: string;
}

let capturedConsole: CapturedConsoleEntry[] = [];
let capturedNetworkFailures: CapturedNetworkFailure[] = [];
let capturedResponses: CapturedResponse[] = [];

/** HTTP status from the most recent browser_navigate (null if none yet or navigation failed). */
let lastNavigationStatus: number | null = null;

function clearCapturedObservations(): void {
  capturedConsole = [];
  capturedNetworkFailures = [];
  capturedResponses = [];
  lastNavigationStatus = null;
}

/** Last main-document navigation HTTP status (for qa_assert_status). */
export function getLastNavigationStatus(): number | null {
  return lastNavigationStatus;
}

function truncateBody(text: string | null | undefined): string {
  if (!text) return '';
  const s = String(text);
  if (s.length > MAX_BODY_CHARS) {
    return s.slice(0, MAX_BODY_CHARS) + '… [truncated]';
  }
  return s;
}

function setupObservationListeners(page: Page): void {
  // Console errors and warnings (from main + frames)
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') {
      const norm: 'error' | 'warn' = t === 'warning' ? 'warn' : 'error';
      capturedConsole.push({
        type: norm,
        text: msg.text(),
        timestamp: new Date().toISOString(),
      });
      if (capturedConsole.length > MAX_CAPTURED_ENTRIES) capturedConsole.shift();
    }
  });

  // Failed requests (network errors, timeouts, aborts)
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    const entry: CapturedNetworkFailure = {
      url: req.url(),
      method: req.method(),
      timestamp: new Date().toISOString(),
    };
    if (failure?.errorText) entry.errorText = failure.errorText;
    capturedNetworkFailures.push(entry);
    if (capturedNetworkFailures.length > MAX_CAPTURED_ENTRIES) capturedNetworkFailures.shift();
  });

  // All responses: capture 4xx/5xx as failures + all for intercept (with truncated body)
  page.on('response', async (resp) => {
    const status = resp.status();
    const url = resp.url();
    const req = resp.request();
    const method = req.method();

    if (status >= 400) {
      const entry: CapturedNetworkFailure = {
        url,
        method,
        status,
        timestamp: new Date().toISOString(),
      };
      capturedNetworkFailures.push(entry);
      if (capturedNetworkFailures.length > MAX_CAPTURED_ENTRIES) capturedNetworkFailures.shift();
    }

    // Capture body for qa_intercept_api (only text-ish to avoid bloat/binary issues)
    try {
      const headers = resp.headers();
      const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
      let bodyText = '';
      if (ct.includes('text') || ct.includes('json') || ct.includes('xml') || ct.includes('javascript') || !ct) {
        const raw = await resp.text().catch(() => '');
        bodyText = truncateBody(raw);
      } else {
        bodyText = `[non-text content-type: ${ct || 'unknown'}]`;
      }
      capturedResponses.push({
        url,
        status,
        method,
        body: bodyText,
        timestamp: new Date().toISOString(),
      });
      if (capturedResponses.length > MAX_CAPTURED_ENTRIES) capturedResponses.shift();
    } catch {
      // ignore body capture failures (e.g. cross-origin, aborted)
    }
  });
}

export function getCapturedConsoleErrors(): CapturedConsoleEntry[] {
  return [...capturedConsole];
}

export function getCapturedNetworkFailures(): CapturedNetworkFailure[] {
  return [...capturedNetworkFailures];
}

export function getCapturedResponses(): CapturedResponse[] {
  return [...capturedResponses];
}

/** Lightweight page snapshot for QA state injection (no navigation). */
export async function getBrowserPageSnapshot(): Promise<{
  url: string;
  viewport: { width: number; height: number };
} | null> {
  if (!currentPage || currentPage.isClosed()) return null;
  const viewport = currentPage.viewportSize();
  return {
    url: currentPage.url(),
    viewport: viewport ?? { width: 0, height: 0 },
  };
}

export { clearCapturedObservations };

/** Resolve a safe screenshot filename with a supported image extension. */
export function resolveScreenshotFilename(filename?: string): string {
  let safeName = (filename?.trim() || `screenshot-${Date.now()}.png`).replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (!/\.(png|jpe?g)$/i.test(safeName)) {
    safeName += '.png';
  }
  return safeName;
}

async function getBrowser(headless = true): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserInstance;
}

export async function getOrCreatePage(tmpDir: string, headless: boolean): Promise<Page> {
  const browser = await getBrowser(headless);

  if (currentPage && !currentPage.isClosed() && currentContext) {
    return currentPage;
  }

  if (currentContext) {
    await currentContext.close().catch(() => {});
    currentContext = null;
  }

  const screenshotsDir = path.join(tmpDir, 'screenshots');
  await mkdir(screenshotsDir, { recursive: true });

  currentContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (compatible; cod3mate-agent/1.0)',
  });
  currentPage = await currentContext.newPage();
  setupObservationListeners(currentPage);
  clearCapturedObservations();
  return currentPage;
}

async function resetBrowserPage(): Promise<void> {
  clearCapturedObservations();
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.close().catch(() => {});
  }
  if (currentContext) {
    await currentContext.close().catch(() => {});
  }
  currentPage = null;
  currentContext = null;
}

export interface BrowserTools {
  navigate: Tool<{ url: string }>;
  click: Tool<{ selector?: string; text?: string }>;
  fill: Tool<{ selector: string; value: string }>;
  screenshot: Tool<{ path?: string; fullPage?: boolean }>;
  extractText: Tool<{ selector?: string }>;
  inspectForm: Tool<Record<string, never>>;
  reset: Tool<Record<string, never>>;
  // Phase 4: Wait tools to avoid flaky timing (used with assertions)
  waitFor: Tool<{ selector: string; state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeoutMs?: number }>;
  waitForNetworkIdle: Tool<{ timeoutMs?: number }>;
  waitForText: Tool<{ text: string; timeoutMs?: number }>;
  // Phase 9: Viewport & responsive testing
  setViewport: Tool<{ preset?: 'mobile' | 'tablet' | 'desktop' | 'wide'; width?: number; height?: number }>;
}

interface FrameInputInfo {
  frameUrl: string;
  isMainFrame: boolean;
  inputs: Array<{
    tag: string;
    type: string | null;
    name: string | null;
    id: string | null;
    placeholder: string | null;
    label: string | null;
    visible: boolean;
  }>;
  clickables: Array<{
    tag: string;
    type: string | null;
    text: string | null;
    id: string | null;
    name: string | null;
    visible: boolean;
  }>;
  forms: number;
  iframes: string[];
}

/**
 * Try to resolve a visible locator for a CSS selector across the main page
 * and all child frames. This makes the browser tools work transparently
 * with third-party auth widgets (Clerk, Auth0, Stripe, etc.) that render
 * inside iframes.
 *
 * Returns the first locator that becomes visible within `timeoutPerFrame`
 * for any frame. Throws a descriptive error if nothing matches.
 */
export async function resolveLocatorAcrossFrames(
  page: Page,
  selector: string,
  timeoutPerFrame: number
): Promise<Locator> {
  const frames: Frame[] = page.frames();
  const tried: string[] = [];

  for (const frame of frames) {
    const label = frame === page.mainFrame() ? '[main page]' : frame.url() || '[frame]';
    try {
      const loc = frame.locator(selector).first();
      await loc.waitFor({ state: 'visible', timeout: timeoutPerFrame });
      return loc;
    } catch {
      tried.push(label);
    }
  }

  throw new Error(
    `Selector "${selector}" did not become visible. Searched ${tried.length} frames: ${tried.join(' | ')}. Try browser_inspect_form to see the actual fields.`
  );
}

/**
 * Resolve a visible locator by either CSS selector (delegates to resolveLocatorAcrossFrames)
 * or by visible text (case-insensitive partial match) across main frame + child frames.
 * Used by QA assertion tools.
 */
export async function resolveVisibleLocator(
  page: Page,
  opts: { selector?: string; text?: string },
  timeoutPerFrame: number = 3000
): Promise<Locator> {
  if (opts.selector) {
    return resolveLocatorAcrossFrames(page, opts.selector, timeoutPerFrame);
  }
  if (opts.text) {
    return resolveTextLocatorAcrossFrames(page, opts.text, timeoutPerFrame);
  }
  throw new Error('Provide either "selector" or "text".');
}

async function resolveTextLocatorAcrossFrames(
  page: Page,
  text: string,
  timeoutPerFrame: number
): Promise<Locator> {
  const frames: Frame[] = page.frames();
  const rx = new RegExp(escapeForRegex(text), 'i');
  const tried: string[] = [];

  for (const frame of frames) {
    const label = frame === page.mainFrame() ? '[main page]' : frame.url() || '[frame]';
    try {
      const loc = frame.getByText(rx).first();
      await loc.waitFor({ state: 'visible', timeout: timeoutPerFrame });
      return loc;
    } catch {
      tried.push(label);
    }
  }

  throw new Error(
    `Text "${text}" did not become visible. Searched ${tried.length} frames: ${tried.join(' | ')}.`
  );
}

/**
 * Fast (short-timeout) visibility check across frames for "not visible" assertions.
 * Does NOT wait long; returns true as soon as any match is visible.
 */
export async function isVisibleAcrossFrames(
  page: Page,
  opts: { selector?: string; text?: string }
): Promise<boolean> {
  if (!opts.selector && !opts.text) return false;
  const frames: Frame[] = page.frames();
  for (const frame of frames) {
    try {
      let loc: Locator;
      if (opts.selector) {
        loc = frame.locator(opts.selector).first();
      } else {
        const rx = new RegExp(escapeForRegex(opts.text!), 'i');
        loc = frame.getByText(rx).first();
      }
      const visible = await loc.isVisible({ timeout: 150 }).catch(() => false);
      if (visible) return true;
    } catch {
      // ignore cross-origin or eval errors in this frame
    }
  }
  return false;
}

/**
 * Wait for a locator (by selector) to reach a given state across frames (main + iframes).
 * Used by browser_wait_for. Throws on timeout (caller handles).
 */
async function waitForAcrossFrames(
  page: Page,
  selector: string,
  state: 'visible' | 'hidden' | 'attached' | 'detached' = 'visible',
  timeout = 10000
): Promise<void> {
  const frames: Frame[] = page.frames();
  const tried: string[] = [];

  for (const frame of frames) {
    const label = frame === page.mainFrame() ? '[main page]' : frame.url() || '[frame]';
    try {
      const loc = frame.locator(selector).first();
      await loc.waitFor({ state, timeout });
      return;
    } catch {
      tried.push(label);
    }
  }

  throw new Error(
    `Selector "${selector}" did not become ${state}. Searched ${tried.length} frames: ${tried.join(' | ')}.`
  );
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ClickResolveOptions {
  selector?: string | undefined;
  text?: string | undefined;
}

interface ResolvedClickable {
  locator: Locator;
  strategy: string;
}

/**
 * Resolve a clickable element from either a raw CSS/Playwright selector or a
 * visible-text description, searching the main page and every child frame.
 *
 * Text resolution is the key UX win: auth widgets (Clerk, Auth0, Stripe) label
 * their primary button as "Continue" / "Sign in" with no stable CSS hook, so
 * the agent can just say what the button says instead of guessing selectors.
 *
 * Strategy order per frame (most robust first):
 *   1. explicit selector (if provided)
 *   2. accessible role "button" by name
 *   3. accessible role "link" by name
 *   4. <button> containing the text
 *   5. any element containing the text
 *
 * A fast pass checks current visibility instantly; if nothing matches we fall
 * back to a bounded waiting pass for elements that appear asynchronously.
 */
async function resolveClickableAcrossFrames(
  page: Page,
  opts: ClickResolveOptions,
  timeoutPerCandidate: number
): Promise<ResolvedClickable> {
  if (!opts.selector && !opts.text) {
    throw new Error('Provide either a "selector" or a "text" to click.');
  }

  const frames: Frame[] = page.frames();

  const buildCandidates = (frame: Frame): Array<{ label: string; locator: Locator }> => {
    const list: Array<{ label: string; locator: Locator }> = [];
    if (opts.selector) {
      list.push({ label: `selector="${opts.selector}"`, locator: frame.locator(opts.selector).first() });
    }
    if (opts.text) {
      const t = opts.text;
      const rx = new RegExp(escapeForRegex(t), 'i');
      list.push({ label: `role=button name~="${t}"`, locator: frame.getByRole('button', { name: rx }).first() });
      list.push({ label: `role=link name~="${t}"`, locator: frame.getByRole('link', { name: rx }).first() });
      list.push({ label: `button:has-text("${t}")`, locator: frame.locator('button', { hasText: rx }).first() });
      list.push({ label: `text~="${t}"`, locator: frame.getByText(rx).first() });
    }
    return list;
  };

  const frameLabel = (frame: Frame): string =>
    frame === page.mainFrame() ? '[main page]' : frame.url() || '[frame]';

  const attempts: string[] = [];

  // Fast pass: use whatever is already visible in the DOM right now.
  for (const frame of frames) {
    for (const cand of buildCandidates(frame)) {
      const visible = await cand.locator.isVisible().catch(() => false);
      if (visible) {
        return { locator: cand.locator, strategy: `${cand.label} in ${frameLabel(frame)}` };
      }
    }
  }

  // Slow pass: wait for asynchronously-rendered elements, bounded per candidate.
  for (const frame of frames) {
    for (const cand of buildCandidates(frame)) {
      try {
        await cand.locator.waitFor({ state: 'visible', timeout: timeoutPerCandidate });
        return { locator: cand.locator, strategy: `${cand.label} in ${frameLabel(frame)}` };
      } catch {
        attempts.push(`${cand.label} @ ${frameLabel(frame)}`);
      }
    }
  }

  throw new Error(
    `No visible clickable element matched ${opts.selector ? `selector "${opts.selector}"` : ''}${
      opts.selector && opts.text ? ' or ' : ''
    }${opts.text ? `text "${opts.text}"` : ''}. ` +
      `Run browser_inspect_form to see the exact buttons/links (it prints a ready-to-use click argument for each). ` +
      `Tried ${attempts.length} strategies: ${attempts.slice(0, 12).join(' | ')}`
  );
}

// Browser-side script. Passed as a string so the Node-side TS compiler does
// not try to type-check DOM globals (this project's lib is ES2022 only).
const COLLECT_INPUTS_SCRIPT = `
(() => {
  function isVisible(el) {
    const rect = el.getBoundingClientRect && el.getBoundingClientRect();
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    const style = view && view.getComputedStyle ? view.getComputedStyle(el) : null;
    if (!rect || !style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    return rect.width > 0 && rect.height > 0;
  }
  function labelFor(el) {
    if (el.id) {
      const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl) return (lbl.textContent || '').trim() || null;
    }
    const wrapping = el.closest && el.closest('label');
    if (wrapping) return (wrapping.textContent || '').trim() || null;
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    return null;
  }
  function clickableText(el) {
    if (el.tagName === 'INPUT') {
      return (el.value || el.getAttribute('aria-label') || '').trim() || null;
    }
    const txt = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (txt) return txt.slice(0, 80);
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim().slice(0, 80);
    const title = el.getAttribute('title');
    if (title) return title.trim().slice(0, 80);
    return null;
  }
  const fieldEls = Array.from(document.querySelectorAll('input, textarea, select'));
  const inputs = fieldEls.slice(0, 30).map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.tagName === 'INPUT' ? (el.type || null) : null,
    name: el.getAttribute('name'),
    id: el.id || null,
    placeholder: el.getAttribute('placeholder'),
    label: labelFor(el),
    visible: isVisible(el),
  }));
  const clickableEls = Array.from(
    document.querySelectorAll('button, a[href], input[type="submit"], input[type="button"], input[type="reset"], [role="button"], [role="link"]')
  );
  const seen = new Set();
  const clickables = [];
  for (const el of clickableEls) {
    if (seen.has(el)) continue;
    seen.add(el);
    clickables.push({
      tag: el.tagName.toLowerCase(),
      type: el.tagName === 'INPUT' ? (el.type || null) : null,
      text: clickableText(el),
      id: el.id || null,
      name: el.getAttribute('name'),
      visible: isVisible(el),
    });
    if (clickables.length >= 30) break;
  }
  const iframes = Array.from(document.querySelectorAll('iframe'))
    .slice(0, 10)
    .map((f) => (f.getAttribute('src') || '').slice(0, 200));
  return {
    frameUrl: location.href,
    isMainFrame: window.top === window,
    inputs,
    clickables,
    forms: document.querySelectorAll('form').length,
    iframes,
  };
})()
`;

async function collectInputsForFrame(frame: Frame): Promise<FrameInputInfo> {
  const result = (await frame.evaluate(COLLECT_INPUTS_SCRIPT)) as FrameInputInfo;
  return result;
}

function formatInspectionReport(infos: FrameInputInfo[]): string {
  const lines: string[] = [];
  for (const info of infos) {
    lines.push(`=== ${info.isMainFrame ? 'Main page' : 'Iframe'}: ${info.frameUrl}`);
    lines.push(`Forms: ${info.forms} | Iframes here: ${info.iframes.length}`);
    if (info.inputs.length === 0) {
      lines.push('No inputs/textareas/selects detected.');
    } else {
      lines.push('Inputs:');
      for (const i of info.inputs) {
        const parts = [
          `<${i.tag}${i.type ? ` type="${i.type}"` : ''}>`,
          i.name ? `name="${i.name}"` : '',
          i.id ? `id="${i.id}"` : '',
          i.placeholder ? `placeholder="${i.placeholder}"` : '',
          i.label ? `label="${i.label}"` : '',
          i.visible ? 'visible' : 'hidden',
        ].filter(Boolean);
        lines.push(`  - ${parts.join(' ')}`);
      }
    }
    if (info.clickables.length === 0) {
      lines.push('Clickables: none detected.');
    } else {
      lines.push('Clickables (buttons/links) — pass the suggested arg to browser_click:');
      for (const c of info.clickables) {
        const desc = [
          `<${c.tag}${c.type ? ` type="${c.type}"` : ''}>`,
          c.text ? `text="${c.text}"` : '(no text)',
          c.id ? `id="${c.id}"` : '',
          c.name ? `name="${c.name}"` : '',
          c.visible ? 'visible' : 'hidden',
        ].filter(Boolean);
        let suggestion: string;
        if (c.text) suggestion = `click { text: "${c.text}" }`;
        else if (c.id) suggestion = `click { selector: "#${c.id}" }`;
        else if (c.name) suggestion = `click { selector: "${c.tag}[name='${c.name}']" }`;
        else suggestion = `click { selector: "${c.tag}" }`;
        lines.push(`  - ${desc.join(' ')}  ->  ${suggestion}`);
      }
    }
    if (info.iframes.length > 0) {
      lines.push('Iframe srcs:');
      for (const src of info.iframes) {
        lines.push(`  - ${src || '(empty src)'}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export async function createBrowserTools(config: BrowserToolConfig): Promise<BrowserTools> {
  const { tmpDir, headless = true } = config;
  const screenshotsDir = path.join(tmpDir, 'screenshots');

  const navigate: Tool<{ url: string }> = {
    name: 'browser_navigate',
    description:
      'Navigate the current browser tab to a URL. The tab persists across tool calls so subsequent fill/click/extract operate on this page. Returns the page title and final URL after redirects.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to navigate to'),
    }),
    execute: async ({ url }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      clearCapturedObservations(); // Phase 3: observations are "since last navigation"
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      lastNavigationStatus = response?.status() ?? null;
      // Best-effort wait for network/JS to settle on SPA pages. Don't fail if it doesn't.
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      const title = await page.title();
      const finalUrl = page.url();
      return {
        ok: true,
        content: `Navigated to ${finalUrl}\nTitle: ${title}${lastNavigationStatus != null ? `\nHTTP status: ${lastNavigationStatus}` : ''}`,
        metadata: { url: finalUrl, title, status: lastNavigationStatus },
      };
    },
  };

  const click: Tool<{ selector?: string; text?: string }> = {
    name: 'browser_click',
    description:
      'Click a button, link, or element on the current page. Prefer the "text" argument with the element\'s visible label (e.g. text="Continue", text="Sign in") — this is the most reliable way to hit auth buttons (Clerk/Auth0/Stripe) that have no stable CSS hook. Use "selector" for a precise CSS target. Provide at least one of them. Searches the main page and all child iframes. Run browser_inspect_form first if unsure what to click.',
    inputSchema: z
      .object({
        selector: z.string().optional().describe('CSS selector for the element to click'),
        text: z
          .string()
          .optional()
          .describe('Visible text/label of the button or link to click (case-insensitive, partial match), e.g. "Continue"'),
      })
      .refine((v) => Boolean(v.selector || v.text), {
        message: 'Provide either "selector" or "text".',
      }),
    execute: async ({ selector, text }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      const { locator, strategy } = await resolveClickableAcrossFrames(page, { selector, text }, 5000);
      await locator.click();
      return { ok: true, content: `Clicked element via ${strategy}` };
    },
  };

  const fill: Tool<{ selector: string; value: string }> = {
    name: 'browser_fill',
    description:
      'Fill an input or textarea on the current page. Searches the main page and all child iframes, so it works with embedded auth widgets (Clerk, Auth0). The value is never echoed back; only its length is reported.',
    inputSchema: z.object({
      selector: z
        .string()
        .min(1)
        .describe(
          'CSS selector for the input element. Common Clerk selectors: input[name="identifier"] for email, input[name="password"]. Run browser_inspect_form first if unsure.'
        ),
      value: z.string().describe('Value to type into the element'),
    }),
    execute: async ({ selector, value }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      const locator = await resolveLocatorAcrossFrames(page, selector, 5000);
      await locator.fill(value);
      return { ok: true, content: `Filled ${selector} with value (length: ${value.length})` };
    },
  };

  const screenshot: Tool<{ path?: string; fullPage?: boolean }> = {
    name: 'browser_screenshot',
    description:
      'Take a screenshot of the current page (the same tab as previous browser tool calls). Returns the saved file path (relative to tmp). During an active QA run (/qa-test, /qa-run, or explicit QA tasks), the image is also sent to you on Telegram automatically.',
    inputSchema: z.object({
      path: z.string().optional().describe('Optional filename for the screenshot (saved under screenshots/)'),
      fullPage: z.boolean().default(false).describe('Capture full page or just viewport'),
    }),
    execute: async ({ path: filename, fullPage = false }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      const safeName = resolveScreenshotFilename(filename);
      const fullPath = path.join(screenshotsDir, safeName);
      await page.screenshot({ path: fullPath, fullPage });
      const relativePath = path.relative(tmpDir, fullPath);
      const qaRun = isQaReportCollecting();
      if (qaRun) {
        recordQaScreenshot(relativePath);
      }
      return {
        ok: true,
        content: `Screenshot saved to: ${relativePath}${qaRun ? ' (queued for Telegram)' : ''}`,
        metadata: { path: relativePath, sentToTelegram: qaRun },
      };
    },
  };

  const extractText: Tool<{ selector?: string }> = {
    name: 'browser_extract_text',
    description:
      'Extract visible text from the current page or a specific element. When a selector is given, searches main page + all iframes.',
    inputSchema: z.object({
      selector: z.string().optional().default('').describe('Optional CSS selector. If omitted, extracts from whole page body.'),
    }),
    execute: async ({ selector }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      let text: string;
      if (selector) {
        const locator = await resolveLocatorAcrossFrames(page, selector, 5000);
        text = await locator.innerText();
      } else {
        text = await page.locator('body').innerText();
      }
      const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n... [truncated]' : text;
      return {
        ok: true,
        content: truncated,
        metadata: { selector: selector || 'body', length: text.length },
      };
    },
  };

  const inspectForm: Tool<Record<string, never>> = {
    name: 'browser_inspect_form',
    description:
      'List the input/textarea/select fields AND the clickable buttons/links on the current page and inside any iframes, with their name, type, text, label, and visibility. For each clickable it prints a ready-to-use browser_click argument. Use this BEFORE browser_fill or browser_click on unfamiliar pages (especially auth pages with Clerk/Auth0/Stripe iframes) to find the right selector or button text.',
    inputSchema: z.object({}),
    execute: async () => {
      const page = await getOrCreatePage(tmpDir, headless);
      const infos: FrameInputInfo[] = [];
      for (const frame of page.frames()) {
        try {
          infos.push(await collectInputsForFrame(frame));
        } catch {
          // Some frames are cross-origin or detached; skip them quietly.
        }
      }
      const report = formatInspectionReport(infos);
      return {
        ok: true,
        content: report || 'No inputs detected on page or in any frame.',
        metadata: {
          frameCount: infos.length,
          totalInputs: infos.reduce((sum, i) => sum + i.inputs.length, 0),
          totalClickables: infos.reduce((sum, i) => sum + i.clickables.length, 0),
        },
      };
    },
  };

  const reset: Tool<Record<string, never>> = {
    name: 'browser_reset',
    description:
      'Close the current browser tab and start a fresh one. Use when switching to an unrelated site, after logout, or when the page state is corrupted. The next browser_navigate will open a clean session.',
    inputSchema: z.object({}),
    execute: async () => {
      clearCapturedObservations(); // Phase 3
      await resetBrowserPage();
      return {
        ok: true,
        content: 'Browser tab closed. Next browser_navigate will start a fresh session.',
      };
    },
  };

  // Phase 4: Wait tools (prevent flakiness with spinners/async; return elapsed time)
  const waitFor: Tool<{ selector: string; state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeoutMs?: number }> = {
    name: 'browser_wait_for',
    description:
      'Wait for a CSS selector to reach a state (appear or disappear etc). state: visible (default=appear), hidden (disappear), attached, detached. timeoutMs default 10000 (10s), max 30000 (30s). Cross-frame. Returns elapsed time so reports know duration.',
    inputSchema: z.object({
      selector: z.string().min(1).describe('CSS selector to wait for'),
      state: z
        .enum(['visible', 'hidden', 'attached', 'detached'])
        .optional()
        .default('visible')
        .describe('State to wait for (visible=appear, hidden=disappear)'),
      timeoutMs: z
        .number()
        .int()
        .min(100)
        .max(30000)
        .optional()
        .default(10000)
        .describe('Max wait time in ms'),
    }),
    execute: async ({ selector, state = 'visible', timeoutMs = 10000 }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      const t0 = Date.now();
      try {
        await waitForAcrossFrames(page, selector, state, timeoutMs);
        const elapsed = Date.now() - t0;
        return {
          ok: true,
          content: `Successfully waited ${elapsed}ms for selector "${selector}" to be ${state}.`,
          metadata: { elapsed, success: true, selector, state, timeoutMs },
        };
      } catch (err: any) {
        const elapsed = Date.now() - t0;
        return {
          ok: true,
          content: `Timed out after ${elapsed}ms waiting for selector "${selector}" to be ${state}. ${err?.message || err}`,
          metadata: { elapsed, success: false, selector, state, timeoutMs, error: err?.message || String(err) },
        };
      }
    },
  };

  const waitForNetworkIdle: Tool<{ timeoutMs?: number }> = {
    name: 'browser_wait_for_network_idle',
    description:
      'Wait for network to be idle (no pending requests for the idle period, using Playwright networkidle). timeoutMs default 10000 (10s), max 30000. Returns elapsed time.',
    inputSchema: z.object({
      timeoutMs: z.number().int().min(100).max(30000).optional().default(10000).describe('Max time to wait for idle'),
    }),
    execute: async ({ timeoutMs = 10000 }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      const t0 = Date.now();
      try {
        await page.waitForLoadState('networkidle', { timeout: timeoutMs });
        const elapsed = Date.now() - t0;
        return {
          ok: true,
          content: `Network became idle after ${elapsed}ms.`,
          metadata: { elapsed, success: true, timeoutMs },
        };
      } catch (err: any) {
        const elapsed = Date.now() - t0;
        return {
          ok: true,
          content: `Did not reach network idle after ${elapsed}ms. ${err?.message || err}`,
          metadata: { elapsed, success: false, timeoutMs, error: err?.message || String(err) },
        };
      }
    },
  };

  const waitForText: Tool<{ text: string; timeoutMs?: number }> = {
    name: 'browser_wait_for_text',
    description:
      'Wait until specific text appears anywhere on the page (searches main + all iframes, case-insensitive). timeoutMs default 10000 max 30000. Returns elapsed time.',
    inputSchema: z.object({
      text: z.string().min(1).describe('The text to wait for (partial, case-insensitive)'),
      timeoutMs: z.number().int().min(100).max(30000).optional().default(10000).describe('Max wait time in ms'),
    }),
    execute: async ({ text, timeoutMs = 10000 }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      const t0 = Date.now();
      try {
        await resolveTextLocatorAcrossFrames(page, text, timeoutMs);
        const elapsed = Date.now() - t0;
        return {
          ok: true,
          content: `Text "${text}" appeared after ${elapsed}ms.`,
          metadata: { elapsed, success: true, text, timeoutMs },
        };
      } catch (err: any) {
        const elapsed = Date.now() - t0;
        return {
          ok: true,
          content: `Text "${text}" did not appear after ${elapsed}ms. ${err?.message || err}`,
          metadata: { elapsed, success: false, text, timeoutMs, error: err?.message || String(err) },
        };
      }
    },
  };

  // Phase 9: Viewport tool
  const VIEWPORT_PRESETS = {
    mobile: { width: 375, height: 812 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1280, height: 800 },
    wide: { width: 1920, height: 1080 },
  } as const;

  const setViewport: Tool<{ preset?: keyof typeof VIEWPORT_PRESETS; width?: number; height?: number }> = {
    name: 'browser_set_viewport',
    description:
      'Set the browser viewport size for responsive testing. Use a "preset" (mobile, tablet, desktop, wide) or provide custom "width" and "height". Affects subsequent screenshots, extracts, and layout. The page persists.',
    inputSchema: z
      .object({
        preset: z.enum(['mobile', 'tablet', 'desktop', 'wide']).optional().describe('Predefined viewport size'),
        width: z.number().int().positive().optional().describe('Custom width in pixels (requires height)'),
        height: z.number().int().positive().optional().describe('Custom height in pixels (requires width)'),
      })
      .refine((v) => !!v.preset || (v.width != null && v.height != null), {
        message: 'Provide either a preset or both width and height for custom size.',
      }),
    execute: async (input) => {
      const page = await getOrCreatePage(tmpDir, headless);
      let size: { width: number; height: number };
      let label = '';
      if (input.preset) {
        size = VIEWPORT_PRESETS[input.preset];
        label = ` (${input.preset})`;
      } else if (input.width != null && input.height != null) {
        size = { width: input.width, height: input.height };
        label = ' (custom)';
      } else {
        return { ok: false, error: 'Provide either a preset or both width and height.' };
      }
      await page.setViewportSize(size);
      return {
        ok: true,
        content: `Viewport set to ${size.width}x${size.height}${label}`,
        metadata: { ...size, preset: input.preset || null },
      };
    },
  };

  return { navigate, click, fill, screenshot, extractText, inspectForm, reset, waitFor, waitForNetworkIdle, waitForText, setViewport };
}

export async function closeBrowser(): Promise<void> {
  await resetBrowserPage();
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

/**
 * Reset current page/context (but keep browser instance).
 * Exported primarily for test isolation of browser-dependent tools (QA assertions, etc).
 */
export async function resetBrowserState(): Promise<void> {
  await resetBrowserPage();
}
