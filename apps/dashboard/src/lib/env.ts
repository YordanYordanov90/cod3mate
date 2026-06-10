import { z } from "zod";

/**
 * Server-side dashboard environment contract.
 *
 * Validation is intentionally lazy (called via {@link getDashboardEnv}) so the
 * placeholder scaffold builds without real secrets. Milestone 8 (Clerk shell)
 * calls this. The Railway API client uses {@link getRailwayApiEnv} instead so
 * M9–M11 can run without Clerk configured.
 *
 * The dashboard is private to signed-in Clerk users. Reports are grouped by
 * project hostname inferred from each QA run (no per-project env allowlist).
 *
 * SECURITY: `DASHBOARD_API_TOKEN` and `CLERK_SECRET_KEY` are server-only and
 * must never be referenced from client components or exposed to the browser.
 * Only `NEXT_PUBLIC_*` values are safe on the client.
 */
const dashboardEnvSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required"),
  CLERK_SECRET_KEY: z.string().min(1, "CLERK_SECRET_KEY is required"),
  DASHBOARD_API_BASE_URL: z
    .string()
    .url("DASHBOARD_API_BASE_URL must be a valid URL"),
  DASHBOARD_API_TOKEN: z
    .string()
    .min(16, "DASHBOARD_API_TOKEN must be at least 16 characters"),
});

export type DashboardEnv = z.infer<typeof dashboardEnvSchema>;

let cached: DashboardEnv | null = null;

/**
 * Validate and return the server-side dashboard environment.
 *
 * Throws a single readable error listing every missing/invalid variable.
 * Never logs secret values.
 */
export function getDashboardEnv(): DashboardEnv {
  if (cached) {
    return cached;
  }

  const parsed = dashboardEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid dashboard environment:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}
