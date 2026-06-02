import { loadEnv, getEnvSummary } from './config/env.js';
import { createBot, startBot } from './telegram/bot.js';
import { ensureDataDirectories } from './storage/mod.js';
import { mkdir } from 'node:fs/promises';
import { loadSoul } from './soul/mod.js';
import {
  loadSession,
  resetSession,
  appendMessage,
  setSelectedModel,
} from './storage/sessions.js';
import { createOpenAIClient, runAgent } from './agent/mod.js';
import type { TestCredentials } from './agent/prompt.js';
import { toolRegistry } from './tools/registry.js';
import { registerSecret } from './security/sanitize.js';
import { buildTaskSummary } from './summary/mod.js';
import { createFileReadTool, createFileWriteTool } from './tools/files/mod.js';
import { createTerminalExecTool } from './tools/terminal/mod.js';
import { createBrowserTools, closeBrowser } from './tools/browser/mod.js';
import { createWebSearchTool } from './tools/search/mod.js';

/**
 * Application entrypoint.
 * - Validates environment (fails fast with safe messages)
 * - Ensures /data directories
 * - Loads /data/SOUL.md (creates safe default if missing)
 * - Launches GrammY bot with owner whitelist + session persistence (Milestone 3)
 */

function logStartup(envSummary: ReturnType<typeof getEnvSummary>) {
  const now = new Date().toISOString();
  console.log(`[${now}] cod3mate starting`);
  console.log('Environment loaded successfully (secrets redacted):');
  console.log(JSON.stringify(envSummary, null, 2));
  console.log('');
  console.log('Data dir:', envSummary.DATA_DIR);
  console.log('Temp dir:', envSummary.TMP_DIR);
  console.log('Log level:', envSummary.LOG_LEVEL);
  console.log('');
}

function setupGracefulShutdown(stopBot?: () => Promise<void>) {
  const shutdown = async (signal: string) => {
    console.log(`\n[${new Date().toISOString()}] Received ${signal}, shutting down...`);

    if (stopBot) {
      try {
        await stopBot();
      } catch (e) {
        console.error('[shutdown] Error stopping bot:', e);
      }
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    console.error('[fatal] Unhandled promise rejection:', reason);
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error('[fatal] Uncaught exception:', error);
    process.exit(1);
  });
}

async function main() {
  const env = loadEnv();
  const summary = getEnvSummary(env);
  logStartup(summary);

  // === Milestone 3: Ensure persistent storage and load SOUL ===
  await ensureDataDirectories(env.DATA_DIR);
  const soul = await loadSoul(env.DATA_DIR);

  console.log(`[startup] SOUL loaded from ${soul.source}: ${soul.path}`);
  if (soul.source === 'default') {
    console.log('[startup] Using safe default personality. Customize /data/SOUL.md and restart.');
  }

  // === Milestone 6: Register Core Tools ===
  await mkdir(env.TMP_DIR, { recursive: true });

  // Apply env-driven runtime limits to all tool executions
  toolRegistry.configure({ maxOutputChars: env.MAX_TOOL_OUTPUT_CHARS });

  // File tools
  toolRegistry.register(createFileReadTool({ tmpDir: env.TMP_DIR }));
  toolRegistry.register(createFileWriteTool({ tmpDir: env.TMP_DIR }));

  // Terminal tool (narrow safe allowlist)
  toolRegistry.register(createTerminalExecTool({
    tmpDir: env.TMP_DIR,
    maxOutputChars: env.MAX_TOOL_OUTPUT_CHARS,
  }));

  // Web search
  toolRegistry.register(createWebSearchTool({
    apiKey: env.TAVILY_API_KEY,
    endpoint: env.TAVILY_SEARCH_ENDPOINT,
  }));

  // Browser tools (async creation because of Playwright)
  const browserTools = await createBrowserTools({
    tmpDir: env.TMP_DIR,
    headless: true,
  });
  toolRegistry.register(browserTools.navigate);
  toolRegistry.register(browserTools.click);
  toolRegistry.register(browserTools.fill);
  toolRegistry.register(browserTools.screenshot);
  toolRegistry.register(browserTools.extractText);
  toolRegistry.register(browserTools.inspectForm);
  toolRegistry.register(browserTools.reset);

  console.log(`[startup] Registered ${toolRegistry.listNames().length} core tools: ${toolRegistry.listNames().join(', ')}`);

  // === Test credentials (optional) ===
  // When both env vars are set, the agent receives them via the system prompt
  // under a strict no-echo policy. Their literal values are also registered
  // with the central sanitizer so any accidental leak in tool output, chat
  // replies, or task summaries is redacted.
  const testCredentials: TestCredentials | undefined =
    env.TEST_ACCOUNT_EMAIL && env.TEST_ACCOUNT_PASSWORD
      ? { email: env.TEST_ACCOUNT_EMAIL, password: env.TEST_ACCOUNT_PASSWORD }
      : undefined;

  if (testCredentials) {
    registerSecret(testCredentials.email);
    registerSecret(testCredentials.password);
    console.log('[startup] Test credentials enabled (values registered with sanitizer; never logged).');
  } else {
    console.log('[startup] Test credentials disabled (TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD not set).');
  }

  // === Milestone 4: OpenAI + Agent wiring ===
  const openai = createOpenAIClient({ apiKey: env.OPENAI_API_KEY });

  // Bind everything for the bot (clean dependency injection)
  const sessionDeps = {
    loadSession: (chatId: number) => loadSession(chatId, env.DATA_DIR),
    resetSession: (chatId: number) => resetSession(chatId, env.DATA_DIR),
    appendMessage: (chatId: number, role: 'user' | 'assistant', content: string) =>
      appendMessage(chatId, role, content, env.DATA_DIR),
    setSelectedModel: (chatId: number, model: string | undefined) =>
      setSelectedModel(chatId, model, env.DATA_DIR),
  };

  // Bound agent runner that closes over soul + models + OpenAI client + tool registry
  const runAgentForChat = (args: {
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    selectedModel?: string | null | undefined;
  }) =>
    runAgent(
      {
        soulContent: soul.content,
        history: args.history,
        primaryModel: env.OPENAI_PRIMARY_MODEL,
        fallbackModel: env.OPENAI_FALLBACK_MODEL,
        selectedModel: args.selectedModel ?? null,
        enableTools: true,
        maxIterations: env.MAX_AGENT_ITERATIONS,
        testCredentials,
      },
      { openai }
    );

  // Create bot with full M7 capabilities (agent + automatic task summaries)
  const bot = createBot({
    env,
    dataDir: env.DATA_DIR,
    soulContent: soul.content,
    primaryModel: env.OPENAI_PRIMARY_MODEL,
    fallbackModel: env.OPENAI_FALLBACK_MODEL,
    ...sessionDeps,
    runAgent: runAgentForChat,
    buildTaskSummary,
  });

  // Prepare a stop function we can call from signal handlers
  let stopBot: (() => Promise<void>) | undefined;

  // Register shutdown handlers **before** starting the long-running poller
  setupGracefulShutdown(async () => {
    if (stopBot) {
      await stopBot();
    }
    await closeBrowser();
  });

  console.log('✅ Telegram bot running (long polling). Owner-only access enforced.');
  console.log('Agent loop + tools active. SOUL + sessions loaded. Ready for tasks.\n');

  // Start long polling (fire-and-forget). The poller keeps the process alive.
  // Capture the stop function for graceful shutdown.
  stopBot = startBot(bot);
}

main().catch((err) => {
  console.error('[fatal] Startup failed:', err);
  process.exit(1);
});