import path from 'node:path';
import { access } from 'node:fs/promises';
import { InputFile } from 'grammy';
import type { Context } from 'grammy';
import { sanitizeString } from '../security/sanitize.js';
import { chunkMessage } from './format.js';
import { formatQaReport, buildQaSessionAnnotation, type QaReport } from '../tools/qa/report.js';
import { saveQaReport } from '../storage/qa-reports.js';

const MAX_QA_SCREENSHOTS_PER_RUN = 5;

/** Appended to QA-mode tasks so the model runs assertion tools (required to persist reports). */
export const QA_MODE_INSTRUCTION_SUFFIX = [
  '',
  '---',
  'QA REPORT MODE (required for dashboard):',
  '- Run qa_assert_visible, qa_assert_url, qa_assert_text_contains, or other qa_assert_* after each important step.',
  '- Browser-only actions and screenshots alone do NOT save a report; at least one qa_assert_* must pass or fail.',
  '- After login/navigation, assert the URL and a key element on the page before continuing.',
  '- Use browser_screenshot for evidence, but always pair screenshots with qa_assert_* checks.',
].join('\n');

export interface ProcessAgentOptions {
  maxIterations?: number;
  /** Force QA report + screenshot collection on or off. */
  collectQaReport?: boolean;
}

/**
 * Whether to activate the QA report collector for a free-text agent task.
 * /qa-test and /qa-run pass collectQaReport: true explicitly.
 */
export function shouldCollectQaReport(
  instruction: string,
  options: ProcessAgentOptions = {}
): boolean {
  if (options.collectQaReport === true) return true;
  if (options.collectQaReport === false) return false;

  const t = instruction.toLowerCase();
  if (/\b(qa[\s_-]?test|qa report|e2e test|regression test)\b/.test(t)) {
    return true;
  }
  if (/qa_assert_[a-z0-9_]+/.test(t)) {
    return true;
  }
  if (/\b(run|execute)\b.*\bqa\b/.test(t) || /\bqa\b.*\b(scenario|flow)\b/.test(t)) {
    return true;
  }
  if (/\bscreenshot\b/.test(t) && /\bassert/.test(t)) {
    return true;
  }
  if (/\btest\b/.test(t) && /\b(assert|screenshot|playwright|browser_|qa_)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Parse `/command@bot args` from a text message (works for hyphenated pseudo-commands). */
export function parseSlashCommand(text: string): { command: string; argsText: string } {
  const trimmed = text.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const head = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const argsText = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  const command = (head.split('@')[0] ?? '').toLowerCase();
  return { command, argsText };
}

/** Append QA-mode guidance so structured reports are actually persisted. */
export function augmentInstructionForQa(instruction: string): string {
  const trimmed = instruction.trim();
  if (!trimmed) return QA_MODE_INSTRUCTION_SUFFIX.trim();
  return `${trimmed}\n${QA_MODE_INSTRUCTION_SUFFIX}`;
}

export interface QaDeliveryResult {
  reportId?: string;
  sessionSuffix: string;
}

/**
 * Persist report, send formatted report text, and deliver queued screenshots to Telegram.
 */
/** Pull an explicit http(s) target from /qa-test-style instructions (`Target: <url>`). */
export function extractQaTargetUrl(text: string): string | undefined {
  const targetMatch = /\btarget:\s*(https?:\/\/\S+)/i.exec(text);
  if (targetMatch?.[1]) {
    return targetMatch[1].replace(/[.,;:!?)]+$/, '');
  }
  const firstUrl = text.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0];
  return firstUrl?.replace(/[.,;:!?)]+$/, '');
}

export async function deliverQaArtifacts(
  ctx: Context,
  args: {
    dataDir: string;
    tmpDir: string;
    chunkSize: number;
    report: QaReport | null;
    screenshotPaths: string[];
    reportPrefix?: string;
    targetUrl?: string;
  }
): Promise<QaDeliveryResult> {
  const { dataDir, tmpDir, chunkSize, report, screenshotPaths, reportPrefix = '', targetUrl } = args;
  let reportId: string | undefined;
  let sessionSuffix = '';

  if (report && report.entries.length > 0) {
    try {
      reportId = await saveQaReport(dataDir, report, {
        tmpDir,
        tmpScreenshotPaths: screenshotPaths,
        ...(targetUrl ? { targetUrl } : {}),
      });
    } catch (saveErr) {
      console.error('[qa] Failed to persist QA report:', saveErr);
    }
    sessionSuffix = buildQaSessionAnnotation(report, reportId);
    const formatted = reportPrefix + formatQaReport(report);
    await sendSafeText(ctx, sanitizeString(formatted), chunkSize);
  }

  if (screenshotPaths.length > 0) {
    await sendQaScreenshots(ctx, tmpDir, screenshotPaths);
  }

  if (!reportId && (!report || report.entries.length === 0)) {
    await sendSafeText(
      ctx,
      sanitizeString(
        'No QA report saved (0 qa_assert_* checks ran). The web dashboard only shows saved structured reports. Re-run with /qa-test and ask for qa_assert_visible / qa_assert_url on key steps, then check /qa-history.'
      ),
      chunkSize
    );
  }

  const out: QaDeliveryResult = { sessionSuffix };
  if (reportId) out.reportId = reportId;
  return out;
}

async function sendQaScreenshots(
  ctx: Context,
  tmpDir: string,
  relativePaths: string[]
): Promise<void> {
  const root = path.resolve(tmpDir);
  let sent = 0;

  for (const rel of relativePaths) {
    if (sent >= MAX_QA_SCREENSHOTS_PER_RUN) break;

    const safeRel = rel.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    const full = path.resolve(root, safeRel);
    if (full !== root && !full.startsWith(root + path.sep)) {
      console.warn('[qa] screenshot path outside TMP_DIR, skipped:', rel);
      continue;
    }

    try {
      await access(full);
      await ctx.replyWithPhoto(new InputFile(full), {
        caption: sanitizeString(`QA screenshot (${safeRel})`),
      });
      sent++;
    } catch (err) {
      console.warn('[qa] Failed to send screenshot to Telegram:', safeRel, err);
    }
  }

  if (relativePaths.length > MAX_QA_SCREENSHOTS_PER_RUN) {
    await sendSafeText(
      ctx,
      sanitizeString(
        `(${relativePaths.length - MAX_QA_SCREENSHOTS_PER_RUN} more screenshot(s) saved under tmp only — Telegram limit ${MAX_QA_SCREENSHOTS_PER_RUN} per run.)`
      ),
      3500
    );
  }
}

async function sendSafeText(ctx: Context, text: string, maxChunkSize: number): Promise<void> {
  const chunks = chunkMessage(text, { maxChunkSize });
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk);
    } catch (err) {
      console.error('[telegram] Failed to send chunk:', err);
    }
  }
}
