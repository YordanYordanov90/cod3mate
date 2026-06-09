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

export type DashboardReport = z.infer<typeof dashboardReportSchema>;
export type DashboardProject = z.infer<typeof dashboardProjectSchema>;
export type DashboardScreenshot = z.infer<typeof dashboardScreenshotSchema>;
