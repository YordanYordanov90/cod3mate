import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBrowserTools, getOrCreatePage, resetBrowserState } from '../../src/tools/browser/mod.js';

describe('browser wait tools (Phase 4)', () => {
  let tmpDir: string;
  let browser: Awaited<ReturnType<typeof createBrowserTools>>;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-browser-wait-'));
    browser = await createBrowserTools({ tmpDir, headless: true });
  });

  afterAll(async () => {
    await resetBrowserState().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetBrowserState().catch(() => {});
  });

  it('browser_wait_for appears (visible) after delayed DOM change', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<div id="loading">loading...</div>');

    // Simulate async appear
    page.evaluate(() => {
      setTimeout(() => {
        const el = document.createElement('div');
        el.id = 'ready';
        el.textContent = 'Content ready';
        document.body.appendChild(el);
      }, 150);
    });

    const res = await browser.waitFor.execute({ selector: '#ready', state: 'visible', timeoutMs: 5000 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toMatch(/Successfully waited \d+ms for selector "#ready" to be visible/);
      expect(res.metadata?.success).toBe(true);
      expect(typeof res.metadata?.elapsed).toBe('number');
    }
  });

  it('browser_wait_for times out for missing element (returns ok with details)', async () => {
    const res = await browser.waitFor.execute({ selector: '#never-appears', timeoutMs: 100 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toMatch(/Timed out after \d+ms waiting for selector "#never-appears"/);
      expect(res.metadata?.success).toBe(false);
    }
  });

  it('browser_wait_for disappear (hidden) works', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<div id="spinner">spinning</div>');

    // hide it async
    page.evaluate(() => {
      setTimeout(() => {
        const el = document.getElementById('spinner');
        if (el) el.style.display = 'none';
      }, 100);
    });

    const res = await browser.waitFor.execute({ selector: '#spinner', state: 'hidden', timeoutMs: 3000 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toMatch(/Successfully waited .* to be hidden/);
    }
  });

  it('browser_wait_for_text appears', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<p>initial</p>');

    page.evaluate(() => {
      setTimeout(() => {
        document.body.innerHTML = '<p id="msg">Hello from async</p>';
      }, 120);
    });

    const res = await browser.waitForText.execute({ text: 'Hello from async', timeoutMs: 3000 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toMatch(/Text "Hello from async" appeared after \d+ms/);
    }
  });

  it('browser_wait_for_network_idle settles after slow request', async () => {
    const page = await getOrCreatePage(tmpDir, true);

    // slow response
    await page.route('https://example.com/slow', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      route.fulfill({ status: 200, body: 'ok' });
    });

    // trigger
    page.evaluate(() => {
      fetch('https://example.com/slow').catch(() => {});
    });

    const res = await browser.waitForNetworkIdle.execute({ timeoutMs: 5000 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toMatch(/Network became idle after \d+ms/);
      const elapsed = res.metadata?.elapsed as number;
      expect(elapsed).toBeGreaterThan(300); // at least the delay
    }
  });

  it('wait tools return elapsed time (for reports)', async () => {
    const res = await browser.waitFor.execute({ selector: 'body', timeoutMs: 1000 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(typeof res.metadata?.elapsed).toBe('number');
      expect(res.metadata?.elapsed).toBeGreaterThanOrEqual(0);
    }
  });
});
