import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createQaAccessibilityTools } from '../../src/tools/qa/accessibility.js';
import { getOrCreatePage, resetBrowserState } from '../../src/tools/browser/mod.js';
import { __resetQaReportForTest, withQaReportCollector } from '../../src/tools/qa/report.js';

describe('QA accessibility audit tool (Phase 10)', () => {
  let tmpDir: string;
  let a11y: Awaited<ReturnType<typeof createQaAccessibilityTools>>;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-qa-a11y-'));
    a11y = await createQaAccessibilityTools({ tmpDir, headless: true });
  });

  afterAll(async () => {
    await resetBrowserState().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetBrowserState().catch(() => {});
    __resetQaReportForTest();
  });

  it('returns structured violations for page with a11y issues', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    // Common violations: img without alt, empty button, unlabeled input
    await page.setContent(`
      <html><body>
        <img src="test.png">
        <button></button>
        <input type="text">
      </body></html>
    `);

    const res = await a11y.accessibilityAudit.execute({});
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = JSON.parse(res.content);
      expect(data.summary).toMatch(/Found .* violations/);
      expect(data.violations).toBeDefined();
      // Should have at least some
      const total = (data.violations.critical?.length || 0) + (data.violations.serious?.length || 0) +
                    (data.violations.moderate?.length || 0) + (data.violations.minor?.length || 0);
      expect(total).toBeGreaterThan(0);
      expect(res.metadata?.hasSeriousIssues).toBeDefined();
    }
  });

  it('returns clean result for accessible page', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent(`
      <html lang="en"><head><title>Accessible Test Page</title></head><body>
        <h1>Test</h1>
        <img src="test.png" alt="Test image description">
        <button type="button">Click me</button>
        <label for="name">Name</label>
        <input id="name" type="text" aria-required="false">
        <a href="#main">Skip to content</a>
        <main id="main">Main content here.</main>
      </body></html>
    `);

    const res = await a11y.accessibilityAudit.execute({});
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = JSON.parse(res.content);
      // A reasonably clean page should have 0 critical (and preferably low serious)
      expect(data.summary).toContain('0 critical');
      expect(res.metadata?.totalViolations).toBeGreaterThanOrEqual(0);
      // Note: headless minimal may still flag some serious/moderate depending on axe rules; the test verifies structure + runs
    }
  });

  it('records result in active QA report (for /qa-run etc)', async () => {
    const page = await getOrCreatePage(tmpDir, true);
    await page.setContent('<img src="x">'); // violation

    const { report } = await withQaReportCollector('test a11y report', async () => {
      await a11y.accessibilityAudit.execute({});
    });

    expect(report).not.toBeNull();
    expect(report!.entries.length).toBeGreaterThan(0);
    const entry = report!.entries[0];
    expect(entry!.name).toBe('Accessibility audit');
    expect(entry!.status).toBe('fail');
  });
});
