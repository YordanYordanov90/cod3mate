/**
 * Telegram task summary builder (Milestone 7).
 *
 * Produces a mobile-friendly plain-text summary after each completed agent task.
 * Consumes the agent loop's final state + originating user request.
 * Always runs output through credential sanitization.
 */

import { sanitizeString } from '../security/sanitize.js';

export interface TaskSummaryInput {
  /** The original user message / task request (used for title derivation) */
  userRequest: string;
  /** The final content returned by the agent (the substantive result) */
  result: string;
  /** Tools executed during the run (with success status) */
  toolsUsed?: Array<{ name: string; success: boolean }> | undefined;
  /** Whether the fallback model was used due to retryable error on primary */
  usedFallback?: boolean | undefined;
  /** The model ID that produced the final answer */
  modelUsed?: string | undefined;
  /** True if the agent stopped because MAX_AGENT_ITERATIONS was reached */
  iterationLimitHit?: boolean | undefined;
}

/**
 * Build a structured task summary for Telegram delivery.
 * Output is sanitized for credentials before return.
 */
export function buildTaskSummary(input: TaskSummaryInput): string {
  const title = deriveTitle(input.userRequest || '');
  const toolsLine = formatToolsUsed(input.toolsUsed);
  const resultPara = condenseToParagraph(input.result || '');
  const caveats = buildCaveats(input);
  const nextSteps = buildNextSteps(input);

  const lines: string[] = [title, ''];

  lines.push('Result:');
  lines.push(resultPara);
  lines.push('');

  lines.push(`Tools used: ${toolsLine}`);

  if (caveats) {
    lines.push('');
    lines.push('Caveats:');
    lines.push(caveats);
  }

  if (nextSteps) {
    lines.push('');
    lines.push('Next steps:');
    lines.push(nextSteps);
  }

  const raw = lines.join('\n').trim();
  return sanitizeString(raw);
}

function deriveTitle(request: string): string {
  if (!request.trim()) {
    return 'Agent task completed';
  }

  // Take the first non-empty line, trim to ~70 chars for mobile
  const firstLine = request
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) || request.trim();

  const max = 70;
  if (firstLine.length <= max) {
    return firstLine;
  }
  return firstLine.slice(0, max - 3) + '...';
}

function formatToolsUsed(tools?: Array<{ name: string; success: boolean }>): string {
  if (!tools || tools.length === 0) {
    return 'none';
  }
  return tools
    .map((t) => (t.success ? t.name : `${t.name} (failed)`))
    .join(', ');
}

function condenseToParagraph(text: string): string {
  if (!text.trim()) {
    return '(no content returned)';
  }

  // Collapse to single paragraph as per UI spec
  const collapsed = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, ' ') // paragraph breaks -> space
    .replace(/\s+/g, ' ') // all other ws collapse
    .trim();

  const max = 320; // leave headroom; Telegram chunking handles overflow anyway
  if (collapsed.length <= max) {
    return collapsed;
  }

  // Cut at a sentence-ish boundary near the limit when possible
  const cut = collapsed.lastIndexOf('. ', max - 20);
  if (cut > 80) {
    return collapsed.slice(0, cut + 1).trim() + ' ...';
  }
  return collapsed.slice(0, max - 3).trim() + '...';
}

function buildCaveats(input: TaskSummaryInput): string {
  const parts: string[] = [];

  if (input.usedFallback) {
    const model = input.modelUsed ? ` (${input.modelUsed})` : '';
    parts.push(`Primary model failed; used fallback${model}`);
  }

  if (input.toolsUsed && input.toolsUsed.length > 0) {
    const failed = input.toolsUsed.filter((t) => !t.success).map((t) => t.name);
    if (failed.length > 0) {
      parts.push(`Tool failures: ${failed.join(', ')}`);
    }
  }

  if (input.iterationLimitHit) {
    parts.push('Hit maximum tool iteration limit');
  }

  if (parts.length === 0) {
    return '';
  }
  return parts.join('. ') + '.';
}

function buildNextSteps(input: TaskSummaryInput): string {
  // v1: conservative — only emit when we have a clear, safe signal.
  // Avoid inventing action items that could mislead the owner.
  if (input.iterationLimitHit) {
    return 'Break the task into smaller steps or provide more specific guidance for the next run.';
  }
  // No generic suggestions; the agent's own content already contains follow-up advice when relevant.
  return '';
}
