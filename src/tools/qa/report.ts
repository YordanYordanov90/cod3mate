import { AsyncLocalStorage } from 'node:async_hooks';
import type { AssertionResult } from './assertions.js';
import {
  beginQaTranscript,
  finalizeQaTranscript,
  type QaTranscript,
} from './transcript.js';

/**
 * QA Report Builder (Phase 2 + high-priority UX hardening).
 *
 * - Per-run collector via AsyncLocalStorage (safe for overlapping async Telegram tasks).
 * - Assertions record only while a collector is active ( /qa-test, /qa-run, explicit QA chat).
 * - Screenshots taken during an active collector are queued for Telegram delivery.
 */

export interface QaReportEntry {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration?: number; // ms
  details?: string;
}

export interface QaReportSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface QaReport {
  title: string;
  startedAt: string;
  endedAt?: string;
  entries: QaReportEntry[];
  summary: QaReportSummary;
}

interface QaRunState {
  title: string;
  startedAt: string;
  entries: QaReportEntry[];
  /** Paths relative to TMP_DIR (as returned by browser_screenshot). */
  screenshotPaths: string[];
}

const qaReportStorage = new AsyncLocalStorage<QaRunState>();

export interface QaCollectorPartial {
  report: QaReport | null;
  screenshotPaths: string[];
}

/** Thrown when `fn` fails inside `withQaReportCollector` but partial report/screenshots exist. */
export class QaCollectorRunError extends Error {
  readonly partial: QaCollectorPartial;
  readonly transcript: QaTranscript | null;

  constructor(
    cause: unknown,
    partial: QaCollectorPartial,
    transcript: QaTranscript | null = null
  ) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(msg);
    this.name = 'QaCollectorRunError';
    this.partial = partial;
    this.transcript = transcript;
    if (cause instanceof Error && cause.stack) {
      this.stack = cause.stack;
    }
  }
}

function snapshotCollector(state: QaRunState): QaCollectorPartial {
  return {
    report: state.entries.length > 0 ? finalizeState(state) : null,
    screenshotPaths: [...state.screenshotPaths],
  };
}

function getActiveState(): QaRunState | undefined {
  return qaReportStorage.getStore();
}

function finalizeState(state: QaRunState): QaReport {
  const endedAt = new Date().toISOString();
  const entries = [...state.entries];
  const summary: QaReportSummary = {
    total: entries.length,
    passed: entries.filter((e) => e.status === 'pass').length,
    failed: entries.filter((e) => e.status === 'fail').length,
    skipped: entries.filter((e) => e.status === 'skip').length,
  };
  return {
    title: state.title,
    startedAt: state.startedAt,
    endedAt,
    entries,
    summary,
  };
}

function createRunState(title: string): QaRunState {
  return {
    title,
    startedAt: new Date().toISOString(),
    entries: [],
    screenshotPaths: [],
  };
}

/** True when assertions/screenshots should feed the active QA run. */
export function isQaReportCollecting(): boolean {
  return getActiveState() != null;
}

/** Running assertion tally from the active collector (for QA state injection). */
export function getQaAssertionTally(): { total: number; passed: number; failed: number } {
  const state = getActiveState();
  if (!state) return { total: 0, passed: 0, failed: 0 };
  const entries = state.entries;
  return {
    total: entries.length,
    passed: entries.filter((e) => e.status === 'pass').length,
    failed: entries.filter((e) => e.status === 'fail').length,
  };
}

/**
 * Run `fn` with an isolated QA report collector (recommended for bot handlers).
 */
export async function withQaReportCollector<T>(
  title: string,
  fn: () => Promise<T>
): Promise<{
  result: T;
  report: QaReport | null;
  screenshotPaths: string[];
  transcript: QaTranscript | null;
}> {
  const state = createRunState(title);
  beginQaTranscript(title);
  return qaReportStorage.run(state, async () => {
    try {
      const result = await fn();
      const { report, screenshotPaths } = snapshotCollector(state);
      const transcript = finalizeQaTranscript(extractTranscriptMeta(result));
      return { result, report, screenshotPaths, transcript };
    } catch (cause) {
      const partial = snapshotCollector(state);
      const transcript = finalizeQaTranscript(extractTranscriptMeta(cause));
      if (partial.report || partial.screenshotPaths.length > 0 || transcript) {
        throw new QaCollectorRunError(cause, partial, transcript);
      }
      throw cause;
    }
  });
}

function extractTranscriptMeta(value: unknown): {
  modelUsed?: string;
  cancelled?: boolean;
  iterationLimitHit?: boolean;
} {
  if (!value || typeof value !== 'object') return {};
  const v = value as {
    modelUsed?: string;
    cancelled?: boolean;
    iterationLimitHit?: boolean;
  };
  const out: {
    modelUsed?: string;
    cancelled?: boolean;
    iterationLimitHit?: boolean;
  } = {};
  if (typeof v.modelUsed === 'string') out.modelUsed = v.modelUsed;
  if (typeof v.cancelled === 'boolean') out.cancelled = v.cancelled;
  if (typeof v.iterationLimitHit === 'boolean') out.iterationLimitHit = v.iterationLimitHit;
  return out;
}

/** Synchronous collector scope (unit tests). */
export function runQaReportCollectorSync<T>(
  title: string,
  fn: () => T
): { result: T; report: QaReport | null; screenshotPaths: string[] } {
  const state = createRunState(title);
  let result!: T;
  qaReportStorage.run(state, () => {
    result = fn();
  });
  const report = state.entries.length > 0 ? finalizeState(state) : null;
  return { result, report, screenshotPaths: [...state.screenshotPaths] };
}

/**
 * @deprecated Prefer `withQaReportCollector`. Kept for tests that use start/end directly.
 */
export function startQaReport(title = 'QA Run'): void {
  qaReportStorage.enterWith(createRunState(title));
}

/**
 * Record one assertion outcome into the active collector (if any).
 */
export function recordAssertion(
  name: string,
  assertion: AssertionResult,
  durationMs?: number
): void {
  const state = getActiveState();
  if (!state) return;

  const status: QaReportEntry['status'] = assertion.passed ? 'pass' : 'fail';
  const detailsLines = [
    `Expected: ${assertion.expected}`,
    `Actual: ${assertion.actual}`,
  ];
  if (assertion.message) detailsLines.push(assertion.message);

  const entry: QaReportEntry = {
    name,
    status,
    details: detailsLines.join('\n'),
  };
  if (typeof durationMs === 'number' && durationMs > 0) {
    entry.duration = Math.round(durationMs);
  }
  state.entries.push(entry);
}

/** Queue a screenshot path (relative to TMP_DIR) for Telegram delivery after the QA run. */
export function recordQaScreenshot(relativePath: string): void {
  const state = getActiveState();
  if (!state) return;
  const normalized = relativePath.replace(/\\/g, '/');
  if (!state.screenshotPaths.includes(normalized)) {
    state.screenshotPaths.push(normalized);
  }
}

/**
 * @deprecated Prefer `withQaReportCollector`. Finalizes the active collector.
 */
export function endQaReport(): QaReport | null {
  const state = getActiveState();
  if (!state) return null;
  if (state.entries.length === 0) return null;
  return finalizeState(state);
}

/**
 * Compact annotation appended to session assistant messages after a QA run.
 */
export function buildQaSessionAnnotation(report: QaReport, reportId?: string): string {
  const { passed, failed, total } = report.summary;
  const idPart = reportId ? ` — report id: ${reportId}` : '';
  return `\n\n---\n[QA snapshot: ${passed} passed, ${failed} failed, ${total} checks${idPart}. Use /qa-report <id> for full details.]`;
}

export function formatQaReport(report: QaReport): string {
  const { title, summary, entries } = report;
  const lines: string[] = [];

  lines.push(`QA Report: ${title}`);
  let summaryLine = `Ran: ${summary.total} checks | Passed: ${summary.passed} | Failed: ${summary.failed}`;
  if (summary.skipped > 0) summaryLine += ` | Skipped: ${summary.skipped}`;
  lines.push(summaryLine);
  lines.push('');

  for (const entry of entries) {
    const statusLabel = entry.status.toUpperCase().padEnd(4, ' ');
    lines.push(`${statusLabel}  ${entry.name}`);
    if (entry.duration != null) {
      lines.push(`      (took ${entry.duration}ms)`);
    }
    if (entry.details) {
      for (const detailLine of entry.details.split('\n')) {
        if (detailLine) lines.push(`      ${detailLine}`);
      }
    }
    lines.push('');
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

/** For tests / inspection only. */
export function __getActiveQaReportForTest(): { title: string; entries: QaReportEntry[] } | null {
  const state = getActiveState();
  return state ? { title: state.title, entries: [...state.entries] } : null;
}

/** For tests: exit collector scope. */
export function __resetQaReportForTest(): void {
  qaReportStorage.disable();
}
