import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { z } from 'zod';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Tool } from '../types.js';

/**
 * Browser automation tools using Playwright.
 * Manages a single browser instance with fresh contexts per task.
 */

export interface BrowserToolConfig {
  tmpDir: string;
  headless?: boolean;
}

let browserInstance: Browser | null = null;

async function getBrowser(headless = true): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'], // Needed for some container environments (Railway)
    });
  }
  return browserInstance;
}

async function createIsolatedContext(browser: Browser, tmpDir: string): Promise<BrowserContext> {
  const screenshotsDir = path.join(tmpDir, 'screenshots');
  await mkdir(screenshotsDir, { recursive: true });

  return await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (compatible; cod3mate-agent/1.0)',
    // Reasonable defaults
  });
}

export interface BrowserTools {
  navigate: Tool<{ url: string }>;
  click: Tool<{ selector: string }>;
  fill: Tool<{ selector: string; value: string }>;
  screenshot: Tool<{ path?: string; fullPage?: boolean }>;
  extractText: Tool<{ selector?: string }>;
}

export async function createBrowserTools(config: BrowserToolConfig): Promise<BrowserTools> {
  const { tmpDir, headless = true } = config;
  const screenshotsDir = path.join(tmpDir, 'screenshots');

  async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await getBrowser(headless);
    const context = await createIsolatedContext(browser, tmpDir);
    const page = await context.newPage();

    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  const navigate: Tool<{ url: string }> = {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL. Returns the page title and final URL after redirects.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to navigate to'),
    }),
    execute: async ({ url }) => {
      return withPage(async (page) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const title = await page.title();
        const finalUrl = page.url();
        return {
          ok: true,
          content: `Navigated to ${finalUrl}\nTitle: ${title}`,
          metadata: { url: finalUrl, title },
        };
      });
    },
  };

  const click: Tool<{ selector: string }> = {
    name: 'browser_click',
    description: 'Click on an element matching the CSS selector.',
    inputSchema: z.object({
      selector: z.string().min(1).describe('CSS selector for the element to click'),
    }),
    execute: async ({ selector }) => {
      return withPage(async (page) => {
        await page.waitForSelector(selector, { timeout: 10000 });
        await page.click(selector);
        return { ok: true, content: `Clicked element: ${selector}` };
      });
    },
  };

  const fill: Tool<{ selector: string; value: string }> = {
    name: 'browser_fill',
    description: 'Fill an input or textarea with the given value.',
    inputSchema: z.object({
      selector: z.string().min(1).describe('CSS selector for the input element'),
      value: z.string().describe('Value to type into the element'),
    }),
    execute: async ({ selector, value }) => {
      return withPage(async (page) => {
        await page.waitForSelector(selector, { timeout: 10000 });
        await page.fill(selector, value);
        return { ok: true, content: `Filled ${selector} with value (length: ${value.length})` };
      });
    },
  };

  const screenshot: Tool<{ path?: string; fullPage?: boolean }> = {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page. Returns the saved file path (relative to tmp).',
    inputSchema: z.object({
      path: z.string().optional().default('').describe('Optional filename for the screenshot (saved under screenshots/)'),
      fullPage: z.boolean().default(false).describe('Capture full page or just viewport'),
    }),
    execute: async ({ path: filename = `screenshot-${Date.now()}.png`, fullPage = false }) => {
      return withPage(async (page) => {
        const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const fullPath = path.join(screenshotsDir, safeName);
        await page.screenshot({ path: fullPath, fullPage });
        const relativePath = path.relative(tmpDir, fullPath);
        return {
          ok: true,
          content: `Screenshot saved to: ${relativePath}`,
          metadata: { path: relativePath },
        };
      });
    },
  };

  const extractText: Tool<{ selector?: string }> = {
    name: 'browser_extract_text',
    description: 'Extract visible text from the page or a specific element.',
    inputSchema: z.object({
      selector: z.string().optional().default('').describe('Optional CSS selector. If omitted, extracts from whole page body.'),
    }),
    execute: async ({ selector }) => {
      return withPage(async (page) => {
        let text: string;
        if (selector) {
          await page.waitForSelector(selector, { timeout: 10000 });
          text = await page.locator(selector).innerText();
        } else {
          text = await page.locator('body').innerText();
        }
        const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n... [truncated]' : text;
        return {
          ok: true,
          content: truncated,
          metadata: { selector: selector || 'body', length: text.length },
        };
      });
    },
  };

  return { navigate, click, fill, screenshot, extractText };
}

// Helper to close browser on shutdown if needed
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}