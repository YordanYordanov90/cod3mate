import { describe, it, expect, afterEach } from 'vitest';
import { shouldCollectQaReport } from '../../src/telegram/qa-ux.js';
import {
  runQaReportCollectorSync,
  recordAssertion,
  withQaReportCollector,
  __resetQaReportForTest,
} from '../../src/tools/qa/report.js';
import type { AssertionResult } from '../../src/tools/qa/assertions.js';

function makeAssertion(passed: boolean): AssertionResult {
  return {
    passed,
    expected: 'x',
    actual: 'y',
    message: 'ok',
  };
}

describe('shouldCollectQaReport', () => {
  it('forces on when collectQaReport is true', () => {
    expect(shouldCollectQaReport('hello', { collectQaReport: true })).toBe(true);
  });

  it('forces off when collectQaReport is false', () => {
    expect(shouldCollectQaReport('qa test the login', { collectQaReport: false })).toBe(false);
  });

  it('detects explicit QA phrasing in free text', () => {
    expect(shouldCollectQaReport('Please run a qa test on the login flow')).toBe(true);
    expect(shouldCollectQaReport('Use qa_assert_visible on the dashboard')).toBe(true);
    expect(shouldCollectQaReport('Take a screenshot and assert the header')).toBe(true);
  });

  it('does not collect for generic chat', () => {
    expect(shouldCollectQaReport('What is Drizzle ORM?')).toBe(false);
    expect(shouldCollectQaReport('Fix the typo in README')).toBe(false);
  });
});

describe('QA report collector isolation', () => {
  afterEach(() => {
    __resetQaReportForTest();
  });

  it('isolates parallel async collectors', async () => {
    const [a, b] = await Promise.all([
      withQaReportCollector('Run A', async () => {
        recordAssertion('check-a', makeAssertion(true));
        await new Promise((r) => setTimeout(r, 5));
        return 'a';
      }),
      withQaReportCollector('Run B', async () => {
        recordAssertion('check-b', makeAssertion(false));
        return 'b';
      }),
    ]);

    expect(a.result).toBe('a');
    expect(b.result).toBe('b');
    expect(a.report!.entries).toHaveLength(1);
    expect(a.report!.entries[0].name).toBe('check-a');
    expect(b.report!.entries[0].name).toBe('check-b');
    expect(b.report!.summary.failed).toBe(1);
  });

  it('runQaReportCollectorSync works for unit tests', () => {
    const { report } = runQaReportCollectorSync('sync', () => {
      recordAssertion('one', makeAssertion(true));
    });
    expect(report!.summary.total).toBe(1);
  });
});
