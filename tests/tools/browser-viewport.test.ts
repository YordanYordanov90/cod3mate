import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBrowserTools, getOrCreatePage, resetBrowserState } from '../../src/tools/browser/mod.js';

describe('browser viewport tool (Phase 9)', () => {
  let tmpDir: string;
  let browser: Awaited<ReturnType<typeof createBrowserTools>>;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-browser-viewport-'));
    browser = await createBrowserTools({ tmpDir, headless: true });
  });

  afterAll(async () => {
    await resetBrowserState().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetBrowserState().catch(() => {});
  });

  it('sets viewport via preset (mobile)', async () => {
    const res = await browser.setViewport.execute({ preset: 'mobile' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('375x812 (mobile)');
      expect(res.metadata?.width).toBe(375);
      expect(res.metadata?.height).toBe(812);
      expect(res.metadata?.preset).toBe('mobile');
    }

    const page = await getOrCreatePage(tmpDir, true);
    const size = page.viewportSize();
    expect(size?.width).toBe(375);
    expect(size?.height).toBe(812);
  });

  it('sets viewport via custom width/height', async () => {
    const res = await browser.setViewport.execute({ width: 600, height: 400 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('600x400 (custom)');
      expect(res.metadata?.width).toBe(600);
      expect(res.metadata?.height).toBe(400);
      expect(res.metadata?.preset).toBeNull();
    }

    const page = await getOrCreatePage(tmpDir, true);
    const size = page.viewportSize();
    expect(size?.width).toBe(600);
    expect(size?.height).toBe(400);
  });

  it('rejects invalid input (no preset and no dimensions)', async () => {
    // @ts-expect-error testing runtime validation
    const res = await browser.setViewport.execute({});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/preset or both width and height/i);
    }
  });

  it('screenshot reflects new viewport (via metadata + size query)', async () => {
    await browser.setViewport.execute({ preset: 'tablet' });
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<div style="width:100vw;height:100vh;background:red">test</div>');

    const shot = await browser.screenshot.execute({ path: 'viewport-test.png', fullPage: false });
    expect(shot.ok).toBe(true);

    const size = page.viewportSize();
    expect(size?.width).toBe(768);
    expect(size?.height).toBe(1024);
  });
});
