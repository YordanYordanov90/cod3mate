import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  runQaReportCollectorSync,
  withQaReportCollector,
  formatQaReport,
  buildQaSessionAnnotation,
  recordAssertion,
  recordQaScreenshot,
  QaCollectorRunError,
  __resetQaReportForTest,
} from '../../src/tools/qa/report.js';
import {
  saveQaReport,
  listRecentQaReports,
  loadQaReportById,
  ensureQaReportsDir,
} from '../../src/storage/qa-reports.js';
import { ensureDataDirectories } from '../../src/storage/mod.js';
import type { AssertionResult } from '../../src/tools/qa/assertions.js';

function makeAssertion(passed: boolean, overrides: Partial<AssertionResult> = {}): AssertionResult {
  return {
    passed,
    expected: overrides.expected || 'element #foo is visible',
    actual: overrides.actual || (passed ? 'visible' : 'not visible or not found'),
    message: overrides.message || (passed ? 'Assertion passed.' : 'Assertion failed.'),
    ...overrides,
  };
}

describe('QA report collector + formatter (Phase 2)', () => {
  beforeEach(() => {
    __resetQaReportForTest();
  });

  afterEach(() => {
    __resetQaReportForTest();
  });

  it('collector accumulates entries and computes summary', () => {
    const { report } = runQaReportCollectorSync('Login flow', () => {
      recordAssertion('hero visible', makeAssertion(true));
      recordAssertion('dashboard name', makeAssertion(false, { expected: 'Welcome, Test', actual: 'element not found' }));
      recordAssertion('footer present', makeAssertion(true, { message: 'ok' }), 123);
    });

    expect(report).not.toBeNull();
    expect(report!.title).toBe('Login flow');
    expect(report!.summary.total).toBe(3);
    expect(report!.summary.passed).toBe(2);
    expect(report!.summary.failed).toBe(1);
    expect(report!.entries[1].status).toBe('fail');
    expect(report!.entries[2].duration).toBe(123);
  });

  it('formatQaReport produces the spec structure with PASS/FAIL and indented details', () => {
    const { report } = runQaReportCollectorSync('Page loads', () => {
      recordAssertion('loads ok', makeAssertion(true, { expected: 'Page loads correctly', message: 'ok' }));
      recordAssertion('user name', makeAssertion(false, {
        expected: 'Welcome, Test User',
        actual: 'element not found',
        message: 'Dashboard shows user name',
      }));
    });
    const text = formatQaReport(report!);

    expect(text).toContain('QA Report: Page loads');
    expect(text).toContain('Ran: 2 checks | Passed: 1 | Failed: 1');
    expect(text).toContain('PASS  loads ok');
    expect(text).toContain('FAIL  user name');
    expect(text).toContain('Expected: Welcome, Test User');
    expect(text).toContain('Actual: element not found');
    // details are indented
    expect(text).toMatch(/\n      Expected:/);
  });

  it('empty report edge case: 0 checks, still formats cleanly, summary 0s', () => {
    const { report } = runQaReportCollectorSync('Empty run', () => {});
    expect(report).toBeNull();
    const emptyReport = {
      title: 'Empty run',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      entries: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    };
    const text = formatQaReport(emptyReport);
    expect(text).toContain('QA Report: Empty run');
    expect(text).toContain('Ran: 0 checks | Passed: 0 | Failed: 0');
    // no entry lines
    expect(text.split('\n').filter((l) => l.startsWith('PASS') || l.startsWith('FAIL')).length).toBe(0);
  });

  it('records screenshot paths during active collector', () => {
    const { screenshotPaths } = runQaReportCollectorSync('shots', () => {
      recordQaScreenshot('screenshots/a.png');
      recordQaScreenshot('screenshots/a.png');
      recordQaScreenshot('screenshots/b.png');
    });
    expect(screenshotPaths).toEqual(['screenshots/a.png', 'screenshots/b.png']);
  });

  it('buildQaSessionAnnotation adds compact pass/fail line for session history', () => {
    const { report } = runQaReportCollectorSync('snap', () => {
      recordAssertion('x', makeAssertion(true));
    });
    const ann = buildQaSessionAnnotation(report!, 'report-abc');
    expect(ann).toContain('1 passed');
    expect(ann).toContain('report-abc');
    expect(ann).toContain('/qa-report');
  });

  it('records are ignored when no active report (normal chat runs)', () => {
    recordAssertion('should be dropped', makeAssertion(true));
    const { report } = runQaReportCollectorSync('real', () => {
      recordAssertion('kept', makeAssertion(true));
    });
    expect(report!.entries.length).toBe(1);
    expect(report!.entries[0].name).toBe('kept');
  });
});

describe('QA report persistence (Phase 2)', () => {
  let tempDataDir: string;

  beforeEach(async () => {
    __resetQaReportForTest();
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-qa-persist-'));
    await ensureDataDirectories(tempDataDir); // creates qa-reports/
  });

  afterEach(async () => {
    __resetQaReportForTest();
    await rm(tempDataDir, { recursive: true, force: true });
  });

  it('save + listRecent roundtrips reports and returns summaries sorted newest first', async () => {
    // create two reports via collector
    const { report: r1 } = runQaReportCollectorSync('First run', () => {
      recordAssertion('a1', makeAssertion(true));
    });

    await new Promise((r) => setTimeout(r, 5));

    const { report: r2 } = runQaReportCollectorSync('Second run with failures', () => {
      recordAssertion('b1', makeAssertion(true));
      recordAssertion('b2', makeAssertion(false));
    });

    const id1 = await saveQaReport(tempDataDir, r1!);
    const id2 = await saveQaReport(tempDataDir, r2!);

    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(10);
    expect(id1).toContain('first-run');
    expect(typeof id2).toBe('string');
    expect(id2).toContain('second-run');

    const listed = await listRecentQaReports(tempDataDir, 10);
    expect(listed.length).toBe(2);
    // newest first (second run)
    expect(listed[0].title).toBe('Second run with failures');
    expect(listed[0].total).toBe(2);
    expect(listed[0].failed).toBe(1);
    expect(listed[1].title).toBe('First run');
    expect(listed[1].passed).toBe(1);
  });

  it('listRecent returns [] for empty dir or no reports', async () => {
    const listed = await listRecentQaReports(tempDataDir, 5);
    expect(listed).toEqual([]);
  });

  it('ensureQaReportsDir works and is under data/qa-reports', async () => {
    const dir = await ensureQaReportsDir(tempDataDir);
    expect(dir).toContain('qa-reports');
  });

  it('withQaReportCollector throws QaCollectorRunError with partial report on failure', async () => {
    await expect(
      withQaReportCollector('partial run', async () => {
        recordAssertion('step one', makeAssertion(true));
        recordQaScreenshot('screenshots/partial.png');
        throw new Error('agent blew up');
      })
    ).rejects.toBeInstanceOf(QaCollectorRunError);

    try {
      await withQaReportCollector('partial run 2', async () => {
        recordAssertion('only fail', makeAssertion(false));
        throw new Error('boom');
      });
    } catch (e) {
      const err = e as QaCollectorRunError;
      expect(err.partial.report!.summary.total).toBe(1);
      expect(err.partial.screenshotPaths).toEqual([]);
    }
  });

  it('loadQaReportById retrieves full report after save', async () => {
    const { report } = runQaReportCollectorSync('load me', () => {
      recordAssertion('check', makeAssertion(false));
    });
    const id = await saveQaReport(tempDataDir, report!);
    const loaded = await loadQaReportById(tempDataDir, id);
    expect(loaded).not.toBeNull();
    expect(loaded!.entries.length).toBe(1);
    expect(loaded!.summary.failed).toBe(1);
    expect(await loadQaReportById(tempDataDir, 'nonexistent-id-xyz')).toBeNull();
  });
});
