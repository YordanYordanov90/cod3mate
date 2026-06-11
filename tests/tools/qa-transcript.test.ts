import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginQaTranscript,
  finalizeQaTranscript,
  recordTranscriptToolResult,
  recordTranscriptModelResponse,
  linkTranscriptScreenshotRefs,
  __resetQaTranscriptForTest,
} from '../../src/tools/qa/transcript.js';
import { registerSecret, clearRegisteredSecrets } from '../../src/security/sanitize.js';

describe('QA transcript collector', () => {
  beforeEach(() => {
    __resetQaTranscriptForTest();
    clearRegisteredSecrets();
  });

  it('records model and tool entries then finalizes', () => {
    beginQaTranscript('QA: login flow');
    recordTranscriptModelResponse({
      iteration: 0,
      model: 'gpt-test',
      content: 'Navigating to login page',
      toolNames: ['browser_navigate'],
    });
    recordTranscriptToolResult({
      iteration: 0,
      toolName: 'browser_screenshot',
      toolCallId: 'tc1',
      content: 'screenshots/login.png',
      success: true,
      screenshotPath: 'screenshots/login.png',
    });

    const transcript = finalizeQaTranscript({ modelUsed: 'gpt-test' });
    expect(transcript).not.toBeNull();
    expect(transcript!.entries.length).toBeGreaterThanOrEqual(3);
    expect(transcript!.entries.some((e) => e.kind === 'tool_result' && e.screenshotRef)).toBe(true);
  });

  it('redacts registered secrets from transcript content', () => {
    registerSecret('super-secret-password-123');
    beginQaTranscript('QA: creds');
    recordTranscriptToolResult({
      iteration: 0,
      toolName: 'browser_fill',
      toolCallId: 'tc1',
      content: 'filled with super-secret-password-123',
      success: true,
    });

    const transcript = finalizeQaTranscript();
    const toolEntry = transcript!.entries.find((e) => e.kind === 'tool_result');
    expect(toolEntry?.content).toContain('[REDACTED]');
    expect(toolEntry?.content).not.toContain('super-secret-password-123');
  });

  it('links screenshot refs to durable artifact metadata', () => {
    const transcript = {
      title: 't',
      startedAt: new Date().toISOString(),
      entries: [
        {
          sequence: 1,
          timestamp: new Date().toISOString(),
          kind: 'tool_result' as const,
          screenshotRef: {
            filename: 'login.png',
            path: 'screenshots/login.png',
          },
        },
      ],
    };

    const linked = linkTranscriptScreenshotRefs(transcript, [
      { filename: 'login.png', path: 'report-1/login.png', label: 'login.png' },
    ]);

    expect(linked.entries[0].screenshotRef?.path).toBe('report-1/login.png');
  });
});