import { chromium, Browser, BrowserContext, Page } from 'playwright';
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
  reset: Tool<Record<string, never>>;
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
      'Click an element on the current page. Operates on the same tab as the previous browser tool call.',
    inputSchema: z.object({
      selector: z.string().min(1).describe('CSS selector for the element to click'),
    }),
    execute: async ({ selector }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: 15000 });
      await locator.click();
      return { ok: true, content: `Clicked element: ${selector}` };
    },
  };

  const fill: Tool<{ selector: string; value: string }> = {
    name: 'browser_fill',
    description:
      'Fill an input or textarea on the current page. Operates on the same tab as the previous browser tool call. The value is never echoed back; only its length is reported.',
    inputSchema: z.object({
      selector: z.string().min(1).describe('CSS selector for the input element'),
      value: z.string().describe('Value to type into the element'),
    }),
    execute: async ({ selector, value }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: 15000 });
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
      'Extract visible text from the current page or a specific element on it. Operates on the same tab as previous browser tool calls.',
    inputSchema: z.object({
      selector: z.string().optional().default('').describe('Optional CSS selector. If omitted, extracts from whole page body.'),
    }),
    execute: async ({ selector }) => {
      const page = await getOrCreatePage(tmpDir, headless);
      let text: string;
      if (selector) {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: 15000 });
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

  return { navigate, click, fill, screenshot, extractText, reset };
}

export async function closeBrowser(): Promise<void> {
  await resetBrowserPage();
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}
