import { AsyncLocalStorage } from 'node:async_hooks';
import { sanitizeObject, sanitizeString } from '../../security/sanitize.js';

const MAX_TOOL_CONTENT_CHARS = 4000;

export type QaTranscriptEntryKind =
  | 'model_message'
  | 'tool_call'
  | 'tool_result'
  | 'steering'
  | 'run_end';

export interface QaTranscriptScreenshotRef {
  filename: string;
  path: string;
  label?: string;
}

export interface QaTranscriptEntry {
  sequence: number;
  timestamp: string;
  kind: QaTranscriptEntryKind;
  iteration?: number;
  model?: string;
  content?: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  success?: boolean;
  screenshotRef?: QaTranscriptScreenshotRef;
}

export interface QaTranscript {
  title: string;
  startedAt: string;
  endedAt?: string;
  reportId?: string;
  modelUsed?: string;
  cancelled?: boolean;
  iterationLimitHit?: boolean;
  entries: QaTranscriptEntry[];
}

interface QaTranscriptState {
  title: string;
  startedAt: string;
  entries: QaTranscriptEntry[];
  nextSequence: number;
}

const qaTranscriptStorage = new AsyncLocalStorage<QaTranscriptState>();

function getActiveState(): QaTranscriptState | undefined {
  return qaTranscriptStorage.getStore();
}

function truncateContent(content: string): string {
  const sanitized = sanitizeString(content);
  if (sanitized.length <= MAX_TOOL_CONTENT_CHARS) return sanitized;
  return (
    sanitized.slice(0, MAX_TOOL_CONTENT_CHARS) +
    `\n[Transcript truncated from ${sanitized.length} chars]`
  );
}

function pushEntry(
  state: QaTranscriptState,
  entry: Omit<QaTranscriptEntry, 'sequence' | 'timestamp'>
): void {
  state.entries.push({
    ...entry,
    sequence: state.nextSequence++,
    timestamp: new Date().toISOString(),
    ...(entry.content != null ? { content: truncateContent(entry.content) } : {}),
    ...(entry.toolArgs != null
      ? { toolArgs: sanitizeObject(entry.toolArgs) as Record<string, unknown> }
      : {}),
  });
}

export function isQaTranscriptCollecting(): boolean {
  return getActiveState() != null;
}

export function beginQaTranscript(title: string): void {
  qaTranscriptStorage.enterWith({
    title,
    startedAt: new Date().toISOString(),
    entries: [],
    nextSequence: 1,
  });
}

export function recordTranscriptSteering(text: string): void {
  const state = getActiveState();
  if (!state) return;
  pushEntry(state, {
    kind: 'steering',
    content: sanitizeString(text),
  });
}

export function recordTranscriptModelResponse(args: {
  iteration: number;
  model: string;
  content: string;
  toolNames?: string[];
}): void {
  const state = getActiveState();
  if (!state) return;

  const lines: string[] = [];
  if (args.content.trim()) {
    lines.push(args.content.trim());
  }
  if (args.toolNames && args.toolNames.length > 0) {
    lines.push(`Tool calls: ${args.toolNames.join(', ')}`);
  }

  pushEntry(state, {
    kind: 'model_message',
    iteration: args.iteration,
    model: args.model,
    content: lines.join('\n') || '(empty model message)',
  });
}

export function recordTranscriptToolCall(args: {
  iteration: number;
  toolName: string;
  toolCallId: string;
  toolArgs: Record<string, unknown>;
}): void {
  const state = getActiveState();
  if (!state) return;
  pushEntry(state, {
    kind: 'tool_call',
    iteration: args.iteration,
    toolName: args.toolName,
    toolCallId: args.toolCallId,
    toolArgs: args.toolArgs,
  });
}

export function recordTranscriptToolResult(args: {
  iteration: number;
  toolName: string;
  toolCallId: string;
  content: string;
  success: boolean;
  screenshotPath?: string;
}): void {
  const state = getActiveState();
  if (!state) return;

  let screenshotRef: QaTranscriptScreenshotRef | undefined;
  if (args.toolName === 'browser_screenshot' && args.success && args.screenshotPath) {
    const normalized = args.screenshotPath.replace(/\\/g, '/');
    const filename = normalized.split('/').pop() ?? normalized;
    screenshotRef = {
      filename,
      path: normalized,
      label: filename,
    };
  }

  const entry: Omit<QaTranscriptEntry, 'sequence' | 'timestamp'> = {
    kind: 'tool_result',
    iteration: args.iteration,
    toolName: args.toolName,
    toolCallId: args.toolCallId,
    content: args.content,
    success: args.success,
  };
  if (screenshotRef) entry.screenshotRef = screenshotRef;

  pushEntry(state, entry);
}

export function finalizeQaTranscript(args: {
  modelUsed?: string;
  cancelled?: boolean;
  iterationLimitHit?: boolean;
} = {}): QaTranscript | null {
  const state = getActiveState();
  if (!state || state.entries.length === 0) return null;

  const runEnd: Omit<QaTranscriptEntry, 'sequence' | 'timestamp'> = {
    kind: 'run_end',
    content: sanitizeString(
      [
        args.cancelled ? 'Run cancelled by owner.' : null,
        args.iterationLimitHit ? 'Stopped at iteration limit.' : null,
        args.modelUsed ? `Final model: ${args.modelUsed}` : null,
      ]
        .filter(Boolean)
        .join(' ')
    ),
  };
  if (args.modelUsed) runEnd.model = args.modelUsed;
  pushEntry(state, runEnd);

  const transcript: QaTranscript = {
    title: state.title,
    startedAt: state.startedAt,
    endedAt: new Date().toISOString(),
    entries: [...state.entries],
  };
  if (args.modelUsed) transcript.modelUsed = args.modelUsed;
  if (args.cancelled != null) transcript.cancelled = args.cancelled;
  if (args.iterationLimitHit != null) transcript.iterationLimitHit = args.iterationLimitHit;
  return transcript;
}

export function linkTranscriptScreenshotRefs(
  transcript: QaTranscript,
  durableScreenshots: Array<{ filename: string; path: string; label?: string }>
): QaTranscript {
  const byFilename = new Map(durableScreenshots.map((s) => [s.filename, s]));

  const entries = transcript.entries.map((entry) => {
    if (!entry.screenshotRef) return entry;
    const durable = byFilename.get(entry.screenshotRef.filename);
    if (!durable) return entry;
    return {
      ...entry,
      screenshotRef: {
        filename: durable.filename,
        path: durable.path,
        ...(durable.label ? { label: durable.label } : {}),
      },
    };
  });

  return { ...transcript, entries };
}

/** Test helper */
export function __resetQaTranscriptForTest(): void {
  qaTranscriptStorage.disable();
}