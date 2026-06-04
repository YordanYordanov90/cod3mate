import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createQaMonitoringTools } from '../../src/tools/qa/monitoring.js';
import { createBrowserTools } from '../../src/tools/browser/mod.js';
import { getOrCreatePage, resetBrowserState, clearCapturedObservations } from '../../src/tools/browser/mod.js';

describe('QA monitoring / observation tools (Phase 3)', () => {
  let tmpDir: string;
  let qa: Awaited<ReturnType<typeof createQaMonitoringTools>>;
  let browser: Awaited<ReturnType<typeof createBrowserTools>>;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-qa-mon-'));
    qa = await createQaMonitoringTools({ tmpDir, headless: true });
    browser = await createBrowserTools({ tmpDir, headless: true });
  });

  afterAll(async () => {
    await resetBrowserState().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetBrowserState().catch(() => {});
    clearCapturedObservations();
  });

  it('qa_check_console_errors captures error and warn from evaluate', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.evaluate(() => {
      console.error('TEST_CONSOLE_ERROR_123');
      console.warn('TEST_CONSOLE_WARN_456');
      console.log('should be ignored');
    });

    const res = await qa.checkConsoleErrors.execute({});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('TEST_CONSOLE_ERROR_123');
      expect(res.content).toContain('TEST_CONSOLE_WARN_456');
      expect(res.content).not.toContain('should be ignored');
      expect(res.metadata).toHaveProperty('count');
    }
  });

  it('qa_check_network_failures captures 5xx and requestfailed via route', async () => {
    const page = await getOrCreatePage(tmpDir, true);

    // Simulate 500 response (use absolute to ensure relative base doesn't affect)
    await page.route('https://example.com/api/fail-500', (route) =>
      route.fulfill({ status: 500, body: 'server error' })
    );
    // Simulate abort/timeout like failure
    await page.route('https://example.com/api/abort', (route) => route.abort());

    await page.setContent(`
      <script>
        fetch('https://example.com/api/fail-500').catch(()=>{});
        fetch('https://example.com/api/abort').catch(()=>{});
      </script>
    `);
    // give time for requests
    await page.waitForTimeout(300).catch(() => {});

    const res = await qa.checkNetworkFailures.execute({});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('/api/fail-500');
      expect(res.content).toContain('status=500');
      expect(res.content).toContain('/api/abort');
    }
  });

  it('qa_intercept_api captures response body for matching pattern', async () => {
    const page = await getOrCreatePage(tmpDir, true);

    await page.route('https://example.com/api/users', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 42, name: 'Test User' }),
      })
    );

    await page.setContent(`<script>fetch('https://example.com/api/users').then(r=>r.json())</script>`);
    await page.waitForTimeout(300).catch(() => {});

    const res = await qa.interceptApi.execute({ pattern: 'api/users' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('/api/users');
      expect(res.content).toContain('Test User');
      expect(res.content).toContain('Status: 200');
    }
  });

  it('clearing works (simulates clear on navigation)', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.evaluate(() => console.error('ERR_BEFORE_CLEAR'));
    await qa.checkConsoleErrors.execute({}); // just to touch

    clearCapturedObservations();

    const after = await qa.checkConsoleErrors.execute({});
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.content).toMatch(/No console.error or console.warn/);
    }

    // now capture after clear
    await page.evaluate(() => console.error('ERR_AFTER_CLEAR'));
    const later = await qa.checkConsoleErrors.execute({});
    expect(later.ok).toBe(true);
    if (later.ok) {
      expect(later.content).toContain('ERR_AFTER_CLEAR');
    }
  });

  it('clear on actual browser_navigate tool call', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.evaluate(() => console.error('ERR_PRE_NAV'));

    // trigger navigation via the tool (which does clear)
    await browser.navigate.execute({ url: 'data:text/html,<title>nav</title><body>ok</body>' });

    const afterNav = await qa.checkConsoleErrors.execute({});
    expect(afterNav.ok).toBe(true);
    if (afterNav.ok) {
      expect(afterNav.content).toMatch(/No console/);
    }
  });

  it('response bodies are truncated for large payloads', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    const big = 'X'.repeat(10000);
    await page.route('https://example.com/big', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: big })
    );
    await page.setContent(`<script>fetch('https://example.com/big')</script>`);
    await page.waitForTimeout(300).catch(() => {});

    const res = await qa.interceptApi.execute({ pattern: 'big' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('[truncated]');
      // body in metadata should also be truncated version
    }
  });
});
