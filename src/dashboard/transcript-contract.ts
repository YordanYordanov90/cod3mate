import { z } from 'zod';

export const dashboardTranscriptEntrySchema = z.object({
  sequence: z.number().int().positive(),
  timestamp: z.string(),
  kind: z.enum(['model_message', 'tool_call', 'tool_result', 'steering', 'run_end']),
  iteration: z.number().int().nonnegative().optional(),
  model: z.string().optional(),
  content: z.string().optional(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  toolArgs: z.record(z.unknown()).optional(),
  success: z.boolean().optional(),
  screenshotRef: z
    .object({
      filename: z.string(),
      path: z.string(),
      label: z.string().optional(),
    })
    .optional(),
});

export const dashboardTranscriptSchema = z.object({
  reportId: z.string(),
  title: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  modelUsed: z.string().optional(),
  cancelled: z.boolean().optional(),
  iterationLimitHit: z.boolean().optional(),
  entries: z.array(dashboardTranscriptEntrySchema),
});

export type DashboardTranscript = z.infer<typeof dashboardTranscriptSchema>;
export type DashboardTranscriptEntry = z.infer<typeof dashboardTranscriptEntrySchema>;

export function normalizeDashboardTranscript(
  reportId: string,
  raw: import('../tools/qa/transcript.js').QaTranscript
): DashboardTranscript {
  return {
    reportId,
    title: raw.title,
    startedAt: raw.startedAt,
    ...(raw.endedAt ? { endedAt: raw.endedAt } : {}),
    ...(raw.modelUsed ? { modelUsed: raw.modelUsed } : {}),
    ...(raw.cancelled != null ? { cancelled: raw.cancelled } : {}),
    ...(raw.iterationLimitHit != null ? { iterationLimitHit: raw.iterationLimitHit } : {}),
    entries: raw.entries.map((entry) => ({
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      kind: entry.kind,
      ...(entry.iteration != null ? { iteration: entry.iteration } : {}),
      ...(entry.model ? { model: entry.model } : {}),
      ...(entry.content ? { content: entry.content } : {}),
      ...(entry.toolName ? { toolName: entry.toolName } : {}),
      ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
      ...(entry.toolArgs ? { toolArgs: entry.toolArgs } : {}),
      ...(entry.success != null ? { success: entry.success } : {}),
      ...(entry.screenshotRef ? { screenshotRef: entry.screenshotRef } : {}),
    })),
  };
}