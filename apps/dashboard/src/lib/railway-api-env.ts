import { z } from "zod";

/**
 * Railway dashboard API env subset for Milestones 9–11.
 *
 * Clerk keys are intentionally excluded so the API client can be developed
 * and tested before Milestone 8 (auth shell).
 */
const railwayApiEnvSchema = z.object({
  DASHBOARD_API_BASE_URL: z
    .string()
    .url("DASHBOARD_API_BASE_URL must be a valid URL"),
  DASHBOARD_API_TOKEN: z
    .string()
    .min(16, "DASHBOARD_API_TOKEN must be at least 16 characters"),
});

export type RailwayApiEnv = z.infer<typeof railwayApiEnvSchema>;

let cached: RailwayApiEnv | null = null;

/** Validate Railway API env vars. Never logs secret values. */
export function getRailwayApiEnv(): RailwayApiEnv {
  if (cached) {
    return cached;
  }

  const parsed = railwayApiEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid Railway dashboard API environment:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}
