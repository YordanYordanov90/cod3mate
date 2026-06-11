import { z } from "zod";

/** Mirrors the Railway dashboard report read model (`src/dashboard/report-contract.ts`). */
export const dashboardReportEntrySchema = z.object({
  name: z.string(),
  status: z.enum(["pass", "fail", "skip"]),
  durationMs: z.number().int().nonnegative().optional(),
  details: z.string().optional(),
});

export const dashboardReportSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const dashboardScreenshotSchema = z.object({
  filename: z.string(),
  label: z.string().optional(),
});

export const dashboardReportSchema = z.object({
  id: z.string(),
  title: z.string(),
  project: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  summary: dashboardReportSummarySchema,
  entries: z.array(dashboardReportEntrySchema),
  screenshots: z.array(dashboardScreenshotSchema),
});

export const dashboardProjectSchema = z.object({
  name: z.string(),
  reportCount: z.number().int().nonnegative(),
});

export const listProjectsResponseSchema = z.object({
  ok: z.literal(true),
  projects: z.array(dashboardProjectSchema),
});

export const listReportsResponseSchema = z.object({
  ok: z.literal(true),
  reports: z.array(dashboardReportSchema),
  nextCursor: z.string().nullable(),
});

export const getReportResponseSchema = z.object({
  ok: z.literal(true),
  report: dashboardReportSchema,
});

export const getReportScreenshotsResponseSchema = z.object({
  ok: z.literal(true),
  screenshots: z.array(dashboardScreenshotSchema),
});

export const dashboardTranscriptEntrySchema = z.object({
  sequence: z.number().int().positive(),
  timestamp: z.string(),
  kind: z.enum(["model_message", "tool_call", "tool_result", "steering", "run_end"]),
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

export const getReportTranscriptResponseSchema = z.object({
  ok: z.literal(true),
  transcript: dashboardTranscriptSchema,
});

export type DashboardReport = z.infer<typeof dashboardReportSchema>;
export type DashboardProject = z.infer<typeof dashboardProjectSchema>;
export type DashboardScreenshot = z.infer<typeof dashboardScreenshotSchema>;
export type DashboardTranscript = z.infer<typeof dashboardTranscriptSchema>;
export type DashboardTranscriptEntry = z.infer<typeof dashboardTranscriptEntrySchema>;
