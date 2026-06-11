import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ensureDataDirectories } from '../../src/storage/mod.js';
import { saveQaReport } from '../../src/storage/qa-reports.js';
import { saveQaTranscript } from '../../src/storage/qa-transcripts.js';
import { getDashboardTranscriptByReportId } from '../../src/dashboard/transcript-api.js';
import { runQaReportCollectorSync, recordAssertion } from '../../src/tools/qa/report.js';
import { beginQaTranscript, finalizeQaTranscript, recordTranscriptModelResponse } from '../../src/tools/qa/transcript.js';
import { registerSecret, clearRegisteredSecrets } from '../../src/security/sanitize.js';

function makeAssertion(passed: boolean) {
  return {
    passed,
    expected: 'ok',
    actual: passed ? 'ok' : 'fail',
    message: passed ? 'pass' : 'fail',
  };
}

describe('dashboard transcript api', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-dash-transcript-'));
    await ensureDataDirectories(tempDir);
    clearRegisteredSecrets();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns null for unknown report', async () => {
    const result = await getDashboardTranscriptByReportId(tempDir, 'missing-report');
    expect(result).toBeNull();
  });

  it('returns sanitized transcript for a saved report', async () => {
    registerSecret('tvly-secret-dashboard-test');

    const { report } = runQaReportCollectorSync('QA: dashboard transcript', () => {
      recordAssertion('check', makeAssertion(true));
    });
    const reportId = await saveQaReport(tempDir, report!);

    beginQaTranscript('QA: dashboard transcript');
    recordTranscriptModelResponse({
      iteration: 0,
      model: 'gpt-test',
      content: 'Used tvly-secret-dashboard-test in output',
    });
    const transcript = finalizeQaTranscript({ modelUsed: 'gpt-test' });
    await saveQaTranscript(tempDir, reportId, transcript!);

    const loaded = await getDashboardTranscriptByReportId(tempDir, reportId);
    expect(loaded?.reportId).toBe(reportId);
    const modelEntry = loaded?.entries.find((e) => e.kind === 'model_message');
    expect(modelEntry?.content).toContain('[REDACTED]');
    expect(modelEntry?.content).not.toContain('tvly-secret-dashboard-test');
  });
});