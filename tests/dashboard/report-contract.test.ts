import { describe, it, expect } from 'vitest';
import {
  dashboardReportSchema,
  extractHttpUrls,
  inferProjectFromStoredReport,
  normalizeStoredQaReport,
  parseStoredQaReportJson,
  projectFromUrl,
} from '../../src/dashboard/report-contract.js';
import type { StoredQaReportWithExtras } from '../../src/dashboard/report-contract.js';

function makeOldStoredReport(overrides: Partial<StoredQaReportWithExtras> = {}): StoredQaReportWithExtras {
  return {
    id: '2026-06-01T12-00-00-000Z-login-flow',
    title: 'Login flow',
    startedAt: '2026-06-01T12:00:00.000Z',
    endedAt: '2026-06-01T12:00:05.500Z',
    entries: [
      {
        name: 'hero visible',
        status: 'pass',
        duration: 42,
        details: 'Expected: visible\nActual: visible',
      },
      {
        name: 'dashboard name',
        status: 'fail',
        details: 'Expected: Welcome\nActual: element not found',
      },
    ],
    summary: {
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
    },
    ...overrides,
  };
}

describe('dashboard report contract (Milestone 2)', () => {
  it('normalizes a stored QA report into the dashboard shape', () => {
    const normalized = normalizeStoredQaReport(makeOldStoredReport());

    expect(normalized).toEqual({
      id: '2026-06-01T12-00-00-000Z-login-flow',
      title: 'Login flow',
      project: 'unknown',
      startedAt: '2026-06-01T12:00:00.000Z',
      endedAt: '2026-06-01T12:00:05.500Z',
      durationMs: 5500,
      summary: { total: 2, passed: 1, failed: 1, skipped: 0 },
      entries: [
        {
          name: 'hero visible',
          status: 'pass',
          durationMs: 42,
          details: 'Expected: visible\nActual: visible',
        },
        {
          name: 'dashboard name',
          status: 'fail',
          details: 'Expected: Welcome\nActual: element not found',
        },
      ],
      screenshots: [],
    });

    expect(() => dashboardReportSchema.parse(normalized)).not.toThrow();
  });

  it('infers project from target URL in title (qa-test style)', () => {
    const report = makeOldStoredReport({
      title: 'QA: login as test user Target: https://app.cloudcast.ai/dashboard',
    });

    expect(inferProjectFromStoredReport(report)).toBe('app.cloudcast.ai');
    expect(normalizeStoredQaReport(report).project).toBe('app.cloudcast.ai');
  });

  it('infers project from qa_assert_url entry details when title has no URL', () => {
    const report = makeOldStoredReport({
      title: 'Scenario: checkout-flow',
      entries: [
        {
          name: 'url-contains /pricing',
          status: 'pass',
          details: 'Expected: contains /pricing\nActual: https://www.example.com/pricing',
        },
      ],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    });

    expect(inferProjectFromStoredReport(report)).toBe('example.com');
  });

  it('uses explicit project field when present (future reports)', () => {
    const report = makeOldStoredReport({
      project: 'cloudcast',
      title: 'QA: https://app.cloudcast.ai',
    });

    expect(inferProjectFromStoredReport(report)).toBe('cloudcast');
  });

  it('falls back to unknown when no URL or project is available', () => {
    const report = makeOldStoredReport({
      title: 'Verify pricing table renders three tiers',
      entries: [{ name: 'tiers visible', status: 'pass' }],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    });

    expect(inferProjectFromStoredReport(report)).toBe('unknown');
    expect(normalizeStoredQaReport(report).project).toBe('unknown');
  });

  it('parses old stored JSON without screenshots or project metadata', () => {
    const raw = {
      id: 'legacy-id',
      title: 'Old run',
      startedAt: '2026-05-01T10:00:00.000Z',
      endedAt: '2026-05-01T10:00:02.000Z',
      entries: [{ name: 'check', status: 'pass' }],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    };

    const parsed = parseStoredQaReportJson(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.screenshots).toBeUndefined();

    const normalized = normalizeStoredQaReport(parsed!);
    expect(normalized.project).toBe('unknown');
    expect(normalized.screenshots).toEqual([]);
    expect(normalized.durationMs).toBe(2000);
  });

  it('computes summary when old JSON omits summary block', () => {
    const raw = {
      title: 'No summary block',
      startedAt: '2026-05-01T10:00:00.000Z',
      entries: [
        { name: 'a', status: 'pass' },
        { name: 'b', status: 'fail' },
        { name: 'c', status: 'skip' },
      ],
    };

    const parsed = parseStoredQaReportJson(raw, 'fallback-id');
    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1 });

    const normalized = normalizeStoredQaReport(parsed!);
    expect(normalized.id).toBe('fallback-id');
    expect(normalized.summary.total).toBe(3);
  });

  it('normalizes optional screenshot metadata when present', () => {
    const report = makeOldStoredReport({
      screenshots: [
        { filename: 'step-1.png', label: 'Login page' },
        { path: 'qa-artifacts/screenshots/report-id/step-2.png' },
      ],
    });

    expect(normalizeStoredQaReport(report).screenshots).toEqual([
      { filename: 'step-1.png', label: 'Login page' },
      { filename: 'step-2.png' },
    ]);
  });

  it('returns null for corrupt stored JSON', () => {
    expect(parseStoredQaReportJson(null)).toBeNull();
    expect(parseStoredQaReportJson({})).toBeNull();
    expect(parseStoredQaReportJson({ title: 123 })).toBeNull();
  });
});

describe('dashboard report URL helpers', () => {
  it('extractHttpUrls finds URLs in mixed text', () => {
    expect(
      extractHttpUrls('QA: check https://app.example.com/login and https://cdn.example.com/x.')
    ).toEqual(['https://app.example.com/login', 'https://cdn.example.com/x']);
  });

  it('projectFromUrl strips www and lowercases hostname', () => {
    expect(projectFromUrl('https://www.App.Example.COM/path')).toBe('app.example.com');
    expect(projectFromUrl('not-a-url')).toBeNull();
  });
});
