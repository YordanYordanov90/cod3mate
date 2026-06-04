import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createQaAssertionTools } from '../../src/tools/qa/assertions.js';
import { createBrowserTools, getOrCreatePage, resetBrowserState } from '../../src/tools/browser/mod.js';

describe('QA assertion tools (Phase 1)', () => {
  let tmpDir: string;
  let qa: Awaited<ReturnType<typeof createQaAssertionTools>>;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-qa-assert-'));
    qa = await createQaAssertionTools({ tmpDir, headless: true });
  });

  afterAll(async () => {
    await resetBrowserState().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Ensure clean page state for each test (no leftover DOM from previous)
    await resetBrowserState().catch(() => {});
  });

  it('qa_assert_visible passes for selector that exists and is visible', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<div id="hero">Welcome</div>');

    const res = await qa.assertVisible.execute({ selector: '#hero' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(true);
      expect(parsed.expected).toContain('#hero');
      expect(parsed.actual).toBe('visible');
    }
  });

  it('qa_assert_visible passes for text that is visible (cross-frame capable)', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<button>Submit Form</button>');

    const res = await qa.assertVisible.execute({ text: 'Submit' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(true);
    }
  });

  it('qa_assert_visible fails (passed:false) for missing element', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<div>nothing here</div>');

    const res = await qa.assertVisible.execute({ selector: '#does-not-exist' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(false);
      expect(parsed.actual).toMatch(/not visible|not found/i);
    }
  });

  it('qa_assert_not_visible passes when element is absent', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<main>clean</main>');

    const res = await qa.assertNotVisible.execute({ selector: '.error-banner' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(true);
      expect(parsed.expected).toContain('not visible');
    }
  });

  it('qa_assert_not_visible fails when element is present and visible', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<div class="toast">Error occurred</div>');

    const res = await qa.assertNotVisible.execute({ text: 'Error occurred' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(false);
    }
  });

  it('qa_assert_text_contains passes when substring present (no selector = body)', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<p>Hello world, this is a test.</p>');

    const res = await qa.assertTextContains.execute({ text: 'world, this' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(true);
    }
  });

  it('qa_assert_text_contains fails when substring missing', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<p>Completely different content</p>');

    const res = await qa.assertTextContains.execute({ selector: 'p', text: 'xyz-not-present' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(false);
      expect(parsed.actual).toMatch(/does not contain/i);
    }
  });

  it('qa_assert_url passes for contains match on data url', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    const html = '<!doctype html><title>t</title><body>ok</body>';
    await page.goto('data:text/html,' + encodeURIComponent(html), { waitUntil: 'domcontentloaded' });

    const res = await qa.assertUrl.execute({ pattern: 'data:text/html', mode: 'contains' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(true);
      expect(parsed.actual).toContain('data:text/html');
    }
  });

  it('qa_assert_url fails for exact when not exact', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.goto('data:text/html,foo', { waitUntil: 'domcontentloaded' });

    const res = await qa.assertUrl.execute({ pattern: 'data:text/html,bar', mode: 'exact' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(false);
    }
  });

  it('qa_assert_element_count passes for exact count across simple content', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<ul><li>a</li><li>b</li><li>c</li></ul>');

    const res = await qa.assertElementCount.execute({ selector: 'li', expected: 3 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(true);
      expect(parsed.actual).toBe('3');
    }
  });

  it('qa_assert_element_count fails when count mismatches', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<div>one</div><div>two</div>');

    const res = await qa.assertElementCount.execute({ selector: 'div', expected: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(false);
      expect(parsed.message).toMatch(/expected 5, found 2/i);
    }
  });

  it('cross-frame resolution works for qa_assert_visible inside iframe srcdoc', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    // srcdoc iframe is same-origin and participates in page.frames()
    await page.setContent(`
      <main>outer</main>
      <iframe srcdoc="<div id='inner-frame-el' style='display:block'>Secret Widget</div>"></iframe>
    `);

    // Stabilize: wait for iframe to attach and inner content to be queryable.
    // The resolveVisibleLocator will still do its own waits inside frames.
    await page.waitForSelector('iframe', { state: 'attached', timeout: 3000 }).catch(() => {});
    // Small grace for srcdoc parse
    await page.waitForTimeout(150).catch(() => {});

    // Should find inside the child frame
    const res = await qa.assertVisible.execute({ selector: '#inner-frame-el' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(true);
      expect(parsed.message).toMatch(/passed/i);
    }

    // Also via text inside frame
    const res2 = await qa.assertVisible.execute({ text: 'Secret Widget' });
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      const p2 = JSON.parse(res2.content);
      expect(p2.passed).toBe(true);
    }
  }, 15000);

  it('qa_assert_status fails when no navigation has occurred', async () => {
    await resetBrowserState().catch(() => {});
    const res = await qa.assertStatus.execute({ expected: 200 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(false);
      expect(parsed.actual).toMatch(/no navigation/i);
    }
  });

  it('qa_assert_status passes when last navigate returns expected status', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.route('**/*', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>ok</body></html>' })
    );
    const browser = await createBrowserTools({ tmpDir, headless: true });
    await browser.navigate.execute({ url: 'https://example.com/status-test' });
    const res = await qa.assertStatus.execute({ expected: 200, name: 'home 200' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed.passed).toBe(true);
      expect(parsed.actual).toBe('200');
    }
  });

  it('all assertion results include the required shape keys', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<span data-x="1">X</span>');

    const res = await qa.assertTextContains.execute({ selector: 'span', text: 'X' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.content);
      expect(parsed).toHaveProperty('passed');
      expect(parsed).toHaveProperty('expected');
      expect(parsed).toHaveProperty('actual');
      expect(parsed).toHaveProperty('message');
      expect(typeof parsed.passed).toBe('boolean');
    }
  });
});
