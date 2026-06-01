import { describe, it, expect } from 'vitest';
import { buildTaskSummary, type TaskSummaryInput } from '../../src/summary/mod.js';

describe('task summary builder (M7)', () => {
  it('produces the required structure with title, Result, Tools used', () => {
    const input: TaskSummaryInput = {
      userRequest: 'Check the current weather in Berlin using the browser',
      result: 'The weather in Berlin is currently 18°C and partly cloudy.',
      toolsUsed: [{ name: 'browser_navigate', success: true }, { name: 'browser_extract_text', success: true }],
    };

    const out = buildTaskSummary(input);

    expect(out).toContain('Check the current weather in Berlin using the browser');
    expect(out).toContain('Result:');
    expect(out).toContain('The weather in Berlin is currently 18°C and partly cloudy.');
    expect(out).toContain('Tools used: browser_navigate, browser_extract_text');
    // Note: "Done." / "Done with issues." prefix is added by the Telegram handler, not the builder
  });

  it('omits Caveats and Next steps sections when there are none', () => {
    const input: TaskSummaryInput = {
      userRequest: 'Say hello',
      result: 'Hello!',
      toolsUsed: [],
    };

    const out = buildTaskSummary(input);

    expect(out).not.toContain('Caveats:');
    expect(out).not.toContain('Next steps:');
    expect(out).toContain('Tools used: none');
  });

  it('populates Caveats when fallback was used', () => {
    const input: TaskSummaryInput = {
      userRequest: 'Do a search',
      result: 'Some results here',
      toolsUsed: [{ name: 'web_search', success: true }],
      usedFallback: true,
      modelUsed: 'gpt-fallback-test',
    };

    const out = buildTaskSummary(input);

    expect(out).toContain('Caveats:');
    expect(out).toContain('Primary model failed; used fallback (gpt-fallback-test)');
  });

  it('populates Caveats for failed tools', () => {
    const input: TaskSummaryInput = {
      userRequest: 'Run a command',
      result: 'Partial work done',
      toolsUsed: [
        { name: 'terminal_exec', success: true },
        { name: 'file_write', success: false },
      ],
    };

    const out = buildTaskSummary(input);

    expect(out).toContain('Caveats:');
    expect(out).toContain('Tool failures: file_write');
  });

  it('includes iteration limit note in caveats and next steps when hit', () => {
    const input: TaskSummaryInput = {
      userRequest: 'Very broad research task',
      result: 'I did as much as I could in the allowed steps.',
      toolsUsed: [{ name: 'web_search', success: true }],
      iterationLimitHit: true,
    };

    const out = buildTaskSummary(input);

    expect(out).toContain('Hit maximum tool iteration limit');
    expect(out).toContain('Next steps:');
    expect(out).toContain('Break the task into smaller steps');
  });

  it('condenses long multi-paragraph results into a single paragraph', () => {
    const longResult = `Line one with detail.

Another paragraph of information that is quite long and continues.

Final observation here.`;

    const input: TaskSummaryInput = {
      userRequest: 'Analyze this',
      result: longResult,
    };

    const out = buildTaskSummary(input);

    // The paragraph under Result: should be single-line (condensed). The overall summary has
    // intentional section breaks, but the result value itself must not contain \n\n.
    expect(out).toContain('Result:');
    const afterResult = out.split('Result:')[1] || '';
    // Take only up to the first double newline (end of the Result paragraph block)
    const para = afterResult.split('\n\n')[0]?.replace(/^[\n: ]+/, '') || '';
    expect(para.includes('\n\n')).toBe(false);
    expect(para.length).toBeLessThan(longResult.length);
  });

  it('sanitizes credential-like values present in user request or result', () => {
    const input: TaskSummaryInput = {
      userRequest: 'Use this key sk-FAKE1234567890ABCDEF for the demo',
      result: 'I attempted the call with token 12345678:ABCdefGHIJKLmnopQRSTuvwx but it failed.',
    };

    const out = buildTaskSummary(input);

    expect(out).not.toContain('sk-FAKE1234567890ABCDEF');
    expect(out).not.toContain('12345678:ABCdefGHIJKLmnopQRSTuvwx');
    expect(out).toContain('[REDACTED]');
  });

  it('handles empty and minimal inputs without crashing', () => {
    const out = buildTaskSummary({ userRequest: '', result: '' });
    expect(out).toContain('Agent task completed');
    expect(out).toContain('Result:');
    expect(out).toContain('Tools used: none');
  });

  it('truncates overly long titles gracefully', () => {
    const longTitle = 'a'.repeat(120);
    const out = buildTaskSummary({ userRequest: longTitle, result: 'ok' });
    expect(out.split('\n')[0].length).toBeLessThanOrEqual(73); // 70 + ...
  });
});
