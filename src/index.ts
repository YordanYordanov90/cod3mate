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
import type { TestCredentials } from './config/env.js';
import { getAppCredentials } from './config/env.js';
import { toolRegistry } from './tools/registry.js';
import { registerSecret } from './security/sanitize.js';
import { buildTaskSummary } from './summary/mod.js';
import { createFileReadTool, createFileWriteTool } from './tools/files/mod.js';
import { createTerminalExecTool } from './tools/terminal/mod.js';
import { createBrowserTools, closeBrowser, resetBrowserState } from './tools/browser/mod.js';
import { createWebSearchTool } from './tools/search/mod.js';
import { createQaAssertionTools } from './tools/qa/assertions.js';
import { createQaMonitoringTools } from './tools/qa/monitoring.js';
import { createQaSaveScenarioTool } from './tools/qa/scenario-runner.js';
import { createQaAccessibilityTools } from './tools/qa/accessibility.js';

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

  // Phase 4: Browser wait tools (to make QA non-flaky with async UI)
  toolRegistry.register(browserTools.waitFor);
  toolRegistry.register(browserTools.waitForNetworkIdle);
  toolRegistry.register(browserTools.waitForText);

  // Phase 9: Viewport & responsive testing
  toolRegistry.register(browserTools.setViewport);

  // Phase 5: direct reset for /qa-test (clean browser + monitors before long QA runs)
  const resetBrowser = async () => {
    await resetBrowserState();
  };

  // Phase 1: QA assertion tools (pass/fail primitives for reliable testing)
  const qaAssertions = await createQaAssertionTools({
    tmpDir: env.TMP_DIR,
    headless: true,
  });
  toolRegistry.register(qaAssertions.assertVisible);
  toolRegistry.register(qaAssertions.assertNotVisible);
  toolRegistry.register(qaAssertions.assertTextContains);
  toolRegistry.register(qaAssertions.assertUrl);
  toolRegistry.register(qaAssertions.assertElementCount);
  toolRegistry.register(qaAssertions.assertStatus);

  // Phase 3: QA network/console observation tools (passive capture)
  const qaMonitoring = await createQaMonitoringTools({
    tmpDir: env.TMP_DIR,
    headless: true,
  });
  toolRegistry.register(qaMonitoring.checkConsoleErrors);
  toolRegistry.register(qaMonitoring.checkNetworkFailures);
  toolRegistry.register(qaMonitoring.interceptApi);

  // === Test credentials (optional, Phase 8 multi-app support) ===
  // Legacy single: TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD
  // Multi-app (Phase 8): TEST_CREDENTIALS_<APP>_EMAIL / _PASSWORD (e.g. TEST_CREDENTIALS_CLOUDCASTAI_EMAIL)
  // All values registered with sanitizer. Model receives per-app values+names in prompt block.
  // Never accepted from chat; use silently in browser tools / scenarios.
  const legacyTestCredentials: TestCredentials | undefined =
    env.TEST_ACCOUNT_EMAIL && env.TEST_ACCOUNT_PASSWORD
      ? { email: env.TEST_ACCOUNT_EMAIL, password: env.TEST_ACCOUNT_PASSWORD }
      : undefined;

  const appCredentials = getAppCredentials(env);

  if (legacyTestCredentials) {
    registerSecret(legacyTestCredentials.email);
    registerSecret(legacyTestCredentials.password);
  }
  for (const [, creds] of Object.entries(appCredentials)) {
    registerSecret(creds.email);
    registerSecret(creds.password);
  }

  const hasAnyCreds = Boolean(legacyTestCredentials) || Object.keys(appCredentials).length > 0;
  if (hasAnyCreds) {
    const apps = Object.keys(appCredentials);
    const msg = apps.length > 0
      ? `Test credentials enabled for apps: ${apps.join(', ')}${legacyTestCredentials ? ' (plus legacy single)' : ''} (values registered with sanitizer; never logged).`
      : 'Test credentials enabled (legacy single; values registered with sanitizer; never logged).';
    console.log(`[startup] ${msg}`);
  } else {
    console.log('[startup] Test credentials disabled (no TEST_ACCOUNT_* or TEST_CREDENTIALS_* set).');
  }

  // Phase 7: QA save scenario tool (after creds so we can guard against literal values in saved scenarios)
  const qaSaveScenario = createQaSaveScenarioTool({ dataDir: env.DATA_DIR, testCredentials: legacyTestCredentials, appCredentials });
  toolRegistry.register(qaSaveScenario);

  // Phase 10: QA accessibility audit (axe-core)
  const qaAccessibility = await createQaAccessibilityTools({
    tmpDir: env.TMP_DIR,
    headless: true,
  });
  toolRegistry.register(qaAccessibility.accessibilityAudit);

  console.log(`[startup] Registered ${toolRegistry.listNames().length} core tools: ${toolRegistry.listNames().join(', ')}`);

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
    maxIterations?: number;
  }) =>
    runAgent(
      {
        soulContent: soul.content,
        history: args.history,
        primaryModel: env.OPENAI_PRIMARY_MODEL,
        fallbackModel: env.OPENAI_FALLBACK_MODEL,
        selectedModel: args.selectedModel ?? null,
        enableTools: true,
        maxIterations: args.maxIterations ?? env.MAX_AGENT_ITERATIONS,
        testCredentials: legacyTestCredentials,
        appCredentials,
      },
      { openai }
    );

  // Create bot with full M7 capabilities (agent + automatic task summaries)
  const bot = createBot({
    env,
    dataDir: env.DATA_DIR,
    tmpDir: env.TMP_DIR,
    soulContent: soul.content,
    primaryModel: env.OPENAI_PRIMARY_MODEL,
    fallbackModel: env.OPENAI_FALLBACK_MODEL,
    ...sessionDeps,
    runAgent: runAgentForChat,
    buildTaskSummary,
    resetBrowser,
    ...(legacyTestCredentials ? { testCredentials: legacyTestCredentials } : {}),
    ...(Object.keys(appCredentials).length > 0 ? { appCredentials } : {}),
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