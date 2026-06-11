import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ensureDataDirectories } from '../../src/storage/mod.js';
import { saveQaReport } from '../../src/storage/qa-reports.js';
import { saveQaTranscript, loadQaTranscriptByReportId } from '../../src/storage/qa-transcripts.js';
import { runQaReportCollectorSync, recordAssertion } from '../../src/tools/qa/report.js';
import { beginQaTranscript, finalizeQaTranscript, recordTranscriptModelResponse } from '../../src/tools/qa/transcript.js';

function makeAssertion(passed: boolean) {
  return {
    passed,
    expected: 'ok',
    actual: passed ? 'ok' : 'fail',
    message: passed ? 'pass' : 'fail',
  };
}

describe('qa transcript persistence', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cod3mate-transcript-test-'));
    await ensureDataDirectories(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('saves and loads transcript linked to a report id', async () => {
    const { report } = runQaReportCollectorSync('QA: transcript save', () => {
      recordAssertion('visible', makeAssertion(true));
    });

    const reportId = await saveQaReport(tempDir, report!);

    beginQaTranscript('QA: transcript save');
    recordTranscriptModelResponse({
      iteration: 0,
      model: 'gpt-test',
      content: 'Checked dashboard',
    });
    const transcript = finalizeQaTranscript({ modelUsed: 'gpt-test' });
    expect(transcript).not.toBeNull();

    await saveQaTranscript(tempDir, reportId, transcript!);
    const loaded = await loadQaTranscriptByReportId(tempDir, reportId);

    expect(loaded?.reportId).toBe(reportId);
    expect(loaded?.entries.length).toBeGreaterThan(0);
  });
});