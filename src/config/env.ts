import { z } from 'zod';

/**
 * Parse a boolean from an environment string without the `z.coerce.boolean`
 * footgun (which treats the literal string "false" as true). Only explicit
 * truthy tokens enable a flag; everything else is false.
 */
const envBoolean = (defaultValue: boolean) =>
  z.preprocess((val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      return ['1', 'true', 'yes', 'on'].includes(val.trim().toLowerCase());
    }
    return defaultValue;
  }, z.boolean());

/**
 * Zod schema for all environment variables.
 * Required vars fail fast with safe error messages (no secret values).
 */
const EnvSchema = z.object({
  // Required - Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_ALLOWED_USER_ID: z.coerce
    .number()
    .int()
    .positive('TELEGRAM_ALLOWED_USER_ID must be a positive integer'),

  // Required - OpenAI
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_PRIMARY_MODEL: z.string().min(1, 'OPENAI_PRIMARY_MODEL is required'),
  OPENAI_FALLBACK_MODEL: z.string().min(1, 'OPENAI_FALLBACK_MODEL is required'),

  // Required - Search
  TAVILY_API_KEY: z.string().min(1, 'TAVILY_API_KEY is required'),

  // Optional with safe defaults
  TAVILY_SEARCH_ENDPOINT: z
    .string()
    .url()
    .default('https://api.tavily.com/search'),
  DATA_DIR: z.string().default('/data'),
  TMP_DIR: z.string().default('/tmp/agent-files'),
  MAX_AGENT_ITERATIONS: z.coerce.number().int().positive().default(8),
  /** Iteration budget for /qa-test (and other explicit QA runs). Default 25. */
  QA_MAX_ITERATIONS: z.coerce.number().int().positive().default(25),
  MAX_TOOL_OUTPUT_CHARS: z.coerce.number().int().positive().default(12000),
  TELEGRAM_CHUNK_SIZE: z.coerce.number().int().positive().default(3500),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ENABLE_FILE_LOGS: z.coerce.boolean().default(false),

  // Dashboard API (Milestone 4) — optional read-only HTTP layer consumed by the
  // private Vercel dashboard. Disabled by default; bot polling is unaffected.
  // When enabled, DASHBOARD_API_TOKEN is required and guards every
  // /api/dashboard/* route via server-to-server bearer auth.
  DASHBOARD_API_ENABLED: envBoolean(false).default(false),
  DASHBOARD_API_TOKEN: z.string().min(1).optional(),
  DASHBOARD_API_PORT: z.coerce.number().int().positive().optional(),
  // Railway injects PORT at runtime; used as a fallback for the dashboard API.
  PORT: z.coerce.number().int().positive().optional(),

  // Optional - Test credentials for browser-based testing.
  // When both are set, the agent receives them via the system prompt under a
  // strict "use silently, never echo" policy. They are also registered with
  // the central sanitizer so any accidental output is redacted. Configure
  // these in Railway (or .env.local for dev). Owner only.
  TEST_ACCOUNT_EMAIL: z.string().min(1).optional(),
  TEST_ACCOUNT_PASSWORD: z.string().min(1).optional(),

  // Phase 8: Multi-app test credentials via env pattern TEST_CREDENTIALS_<APP>_EMAIL / _PASSWORD
  // e.g. TEST_CREDENTIALS_CLOUDCASTAI_EMAIL, TEST_CREDENTIALS_CLOUDCASTAI_PASSWORD
  // Parsed dynamically below; raw values remain in the env object due to passthrough.
})
  .passthrough()
  .superRefine((env, ctx) => {
    if (!env.DASHBOARD_API_ENABLED) return;
    const token = env.DASHBOARD_API_TOKEN;
    if (!token || token.length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DASHBOARD_API_TOKEN'],
        message:
          'DASHBOARD_API_TOKEN is required (min 16 chars) when DASHBOARD_API_ENABLED is true',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * Resolve the port for the dashboard API.
 * Priority: explicit DASHBOARD_API_PORT → Railway PORT → 8080 default.
 */
export function resolveDashboardPort(env: Env): number {
  return env.DASHBOARD_API_PORT ?? env.PORT ?? 8080;
}

/**
 * Load and validate environment at startup.
 * Exits with actionable message on failure. Never logs secret values.
 */
export function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.');
      const message = issue.message;
      return `${key}: ${message}`;
    });

    console.error('[config] Environment validation failed:');
    issues.forEach((i) => console.error(`  - ${i}`));
    console.error('');
    console.error('Required environment variables:');
    console.error('  TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID,');
    console.error('  OPENAI_API_KEY, OPENAI_PRIMARY_MODEL, OPENAI_FALLBACK_MODEL,');
    console.error('  TAVILY_API_KEY');
    console.error('');
    console.error('See .env.example for the full list with placeholders.');
    process.exit(1);
  }

  return result.data;
}

/**
 * Return a safe, redacted summary of key env presence for logging.
 * Never includes actual values.
 */
export function getEnvSummary(env: Env): Record<string, unknown> {
  return {
    TELEGRAM_ALLOWED_USER_ID: env.TELEGRAM_ALLOWED_USER_ID,
    OPENAI_PRIMARY_MODEL: env.OPENAI_PRIMARY_MODEL,
    OPENAI_FALLBACK_MODEL: env.OPENAI_FALLBACK_MODEL,
    TAVILY_SEARCH_ENDPOINT: env.TAVILY_SEARCH_ENDPOINT,
    DATA_DIR: env.DATA_DIR,
    TMP_DIR: env.TMP_DIR,
    MAX_AGENT_ITERATIONS: env.MAX_AGENT_ITERATIONS,
    QA_MAX_ITERATIONS: env.QA_MAX_ITERATIONS,
    MAX_TOOL_OUTPUT_CHARS: env.MAX_TOOL_OUTPUT_CHARS,
    TELEGRAM_CHUNK_SIZE: env.TELEGRAM_CHUNK_SIZE,
    LOG_LEVEL: env.LOG_LEVEL,
    ENABLE_FILE_LOGS: env.ENABLE_FILE_LOGS,
    DASHBOARD_API_ENABLED: env.DASHBOARD_API_ENABLED,
    DASHBOARD_API_PORT: env.DASHBOARD_API_ENABLED ? resolveDashboardPort(env) : undefined,
    // presence flags only for secrets
    hasTelegramToken: Boolean(env.TELEGRAM_BOT_TOKEN),
    hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
    hasTavilyKey: Boolean(env.TAVILY_API_KEY),
    hasDashboardApiToken: Boolean(env.DASHBOARD_API_TOKEN),
    hasTestCredentials: Boolean(env.TEST_ACCOUNT_EMAIL && env.TEST_ACCOUNT_PASSWORD),
    hasMultiTestCredentials: Object.keys(getAppCredentials(env)).length > 0,
  };
}

/**
 * Phase 8: Parse multi-app test credentials from env using pattern
 * TEST_CREDENTIALS_<APP>_EMAIL / TEST_CREDENTIALS_<APP>_PASSWORD
 * (case insensitive for the suffix, <APP> uppercased as key).
 * Only returns complete pairs (both email+password present).
 * Values will be registered with sanitizer and provided (names+values) to prompt.
 */
export function getAppCredentials(env: Record<string, unknown>): Record<string, TestCredentials> {
  const result: Record<string, TestCredentials> = {};
  for (const [key, rawVal] of Object.entries(env)) {
    if (typeof rawVal !== 'string' || !rawVal) continue;
    const match = key.match(/^TEST_CREDENTIALS_([A-Z0-9_]+)_(EMAIL|PASSWORD)$/i);
    if (match && match[1] && match[2]) {
      const app = match[1].toUpperCase();
      const field = match[2].toLowerCase() as 'email' | 'password';
      if (!result[app]) {
        result[app] = { email: '', password: '' };
      }
      result[app][field] = rawVal;
    }
  }
  // only complete pairs
  return Object.fromEntries(
    Object.entries(result).filter(([, c]) => c.email && c.password)
  );
}

/** Legacy single + multi for unified handling. */
export interface TestCredentials {
  email: string;
  password: string;
}