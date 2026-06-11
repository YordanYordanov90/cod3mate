import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  getCapturedConsoleErrors,
  getCapturedNetworkFailures,
  getBrowserPageSnapshot,
} from '../tools/browser/mod.js';
import { getQaAssertionTally } from '../tools/qa/report.js';
import { sanitizeString } from '../security/sanitize.js';

export const QA_STATE_MARKER = '[QA_STATE]';

const MAX_SNAPSHOT_CHARS = 1500;

/**
 * Build a compact live-state block for QA runs (Roadmap v2 Phase 6).
 * Reads only from existing buffers — no new browser actions.
 */
export async function buildQaStateSnapshot(): Promise<string> {
  const page = await getBrowserPageSnapshot();
  const consoleErrors = getCapturedConsoleErrors().filter((e) => e.type === 'error');
  const networkFailures = getCapturedNetworkFailures();
  const tally = getQaAssertionTally();

  const lines: string[] = [QA_STATE_MARKER, 'Live QA state (auto-updated each step):'];

  if (page) {
    lines.push(`URL: ${page.url}`);
    lines.push(`Viewport: ${page.viewport.width}x${page.viewport.height}`);
  } else {
    lines.push('URL: (no active browser page)');
  }

  lines.push(`Console errors captured: ${consoleErrors.length}`);
  lines.push(`Network failures captured: ${networkFailures.length}`);
  lines.push(
    `Assertions: ${tally.passed} passed, ${tally.failed} failed, ${tally.total} total`
  );

  const snapshot = sanitizeString(lines.join('\n'));
  if (snapshot.length <= MAX_SNAPSHOT_CHARS) return snapshot;
  return snapshot.slice(0, MAX_SNAPSHOT_CHARS) + '\n[QA state truncated]';
}

export function isQaStateMessage(msg: ChatCompletionMessageParam): boolean {
  if (msg.role !== 'user') return false;
  const content = typeof msg.content === 'string' ? msg.content : '';
  return content.startsWith(QA_STATE_MARKER);
}

export function replaceQaStateMessage(
  messages: ChatCompletionMessageParam[],
  snapshot: string
): ChatCompletionMessageParam[] {
  const withoutOld = messages.filter((m) => !isQaStateMessage(m));
  return [...withoutOld, { role: 'user', content: snapshot }];
}