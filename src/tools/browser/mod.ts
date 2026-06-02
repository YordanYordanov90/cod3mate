import { chromium, Browser, BrowserContext, Page, Frame, Locator } from 'playwright';
import { z } from 'zod';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Tool } from '../types.js';

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

async function getBrowser(headless = true): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserInstance;
}

async function getOrCreatePage(tmpDir: string, headless: boolean): Promise<Page> {
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
  return currentPage;
}

async function resetBrowserPage(): Promise<void> {
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
  click: Tool<{ selector: string }>;
  fill: Tool<{ selector: string; value: string }>;
  screenshot: Tool<{ path?: string; fullPage?: boolean }>;
  extractText: Tool<{ selector?: string }>;
  inspectForm: Tool<Record<string, never>>;
  reset: Tool<Record<string, never>>;
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
async function resolveLocatorAcrossFrames(
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
  const iframes = Array.from(document.querySelectorAll('iframe'))
    .slice(0, 10)
    .map((f) => (f.getAttribute('src') || '').slice(0, 200));
  return {
    frameUrl: location.href,
    isMainFrame: window.top === window,
    inputs,
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
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Best-effort wait for network/JS to settle on SPA pages. Don't fail if it doesn't.
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      const title = await page.title();
      const finalUrl = page.url();
      return {
        ok: true,
        content: `Navigated to ${finalUrl}\nTitle: ${title}`,
        metadata: { url: finalUrl, title },
      };
    },
  };

  const click: Tool<{ selector: string }> = {
    name: 'browser_click',
    description:
      'Click an element on the current page. Searches the main page and all child iframes (Clerk/Auth0/Stripe widgets are usually inside iframes).',
    inputSchema: z.object({
      selector: z.string().min(1).describe('CSS selector for the element to click'),
    }),
    execute: async ({ selector }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      const locator = await resolveLocatorAcrossFrames(page, selector, 5000);
      await locator.click();
      return { ok: true, content: `Clicked element: ${selector}` };
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
      'Take a screenshot of the current page (the same tab as previous browser tool calls). Returns the saved file path (relative to tmp).',
    inputSchema: z.object({
      path: z.string().optional().default('').describe('Optional filename for the screenshot (saved under screenshots/)'),
      fullPage: z.boolean().default(false).describe('Capture full page or just viewport'),
    }),
    execute: async ({ path: filename = `screenshot-${Date.now()}.png`, fullPage = false }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const fullPath = path.join(screenshotsDir, safeName);
      await page.screenshot({ path: fullPath, fullPage });
      const relativePath = path.relative(tmpDir, fullPath);
      return {
        ok: true,
        content: `Screenshot saved to: ${relativePath}`,
        metadata: { path: relativePath },
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
      'List input/textarea/select fields on the current page and inside any iframes, with their name, type, placeholder, label, and visibility. Use this BEFORE browser_fill on unfamiliar pages (especially auth pages with Clerk/Auth0/Stripe iframes) to find the right selector.',
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
      await resetBrowserPage();
      return {
        ok: true,
        content: 'Browser tab closed. Next browser_navigate will start a fresh session.',
      };
    },
  };

  return { navigate, click, fill, screenshot, extractText, inspectForm, reset };
}

export async function closeBrowser(): Promise<void> {
  await resetBrowserPage();
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}
