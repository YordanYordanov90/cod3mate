import { z } from 'zod';

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
  MAX_TOOL_OUTPUT_CHARS: z.coerce.number().int().positive().default(12000),
  TELEGRAM_CHUNK_SIZE: z.coerce.number().int().positive().default(3500),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ENABLE_FILE_LOGS: z.coerce.boolean().default(false),

  // Optional - Test credentials for browser-based testing.
  // When both are set, the agent receives them via the system prompt under a
  // strict "use silently, never echo" policy. They are also registered with
  // the central sanitizer so any accidental output is redacted. Configure
  // these in Railway (or .env.local for dev). Owner only.
  TEST_ACCOUNT_EMAIL: z.string().min(1).optional(),
  TEST_ACCOUNT_PASSWORD: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

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
    MAX_TOOL_OUTPUT_CHARS: env.MAX_TOOL_OUTPUT_CHARS,
    TELEGRAM_CHUNK_SIZE: env.TELEGRAM_CHUNK_SIZE,
    LOG_LEVEL: env.LOG_LEVEL,
    ENABLE_FILE_LOGS: env.ENABLE_FILE_LOGS,
    // presence flags only for secrets
    hasTelegramToken: Boolean(env.TELEGRAM_BOT_TOKEN),
    hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
    hasTavilyKey: Boolean(env.TAVILY_API_KEY),
    hasTestCredentials: Boolean(env.TEST_ACCOUNT_EMAIL && env.TEST_ACCOUNT_PASSWORD),
  };
}