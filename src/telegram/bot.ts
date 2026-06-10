import { Bot, Context } from 'grammy';
import type { Env } from '../config/env.js';
import { chunkMessage } from './format.js';
import { createOwnerWhitelistMiddleware } from '../security/access.js';
import type { ChatSession } from '../storage/sessions.js';
import { sanitizeString } from '../security/sanitize.js';
import type { TaskSummaryInput } from '../summary/mod.js';
import { withQaReportCollector, formatQaReport, QaCollectorRunError } from '../tools/qa/report.js';
import { listRecentQaReports, loadQaReportById } from '../storage/qa-reports.js';
import {
  shouldCollectQaReport,
  augmentInstructionForQa,
  deliverQaArtifacts,
  extractQaTargetUrl,
  type ProcessAgentOptions,
} from './qa-ux.js';
import type { TestCredentials } from '../agent/prompt.js';
import {
  loadQaScenario,
  listQaScenarios,
  executeScenarioSteps,
} from '../tools/qa/scenario-runner.js';

/**
 * Telegram bot setup for Milestone 7 (Telegram Task Summary).
 * - Real agent responses for owner messages (with tool support)
 * - Automatic structured task summary after each completed agent task
 * - Sanitized delivery + chunking
 */

export interface BotDependencies {
  env: Env;
  dataDir: string;
  soulContent: string;

  // Models
  primaryModel: string;
  fallbackModel: string;

  // Session operations
  loadSession: (chatId: number) => Promise<ChatSession>;
  resetSession: (chatId: number) => Promise<void>;
  appendMessage: (chatId: number, role: 'user' | 'assistant', content: string) => Promise<ChatSession>;
  setSelectedModel: (chatId: number, model: string | undefined) => Promise<ChatSession>;

  // Agent runner (injected — allows easy mocking in tests)
  runAgent: (args: {
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    selectedModel?: string | null | undefined;
    /** Per-run override for QA flows (Phase 5) */
    maxIterations?: number;
  }) => Promise<{
    content: string;
    modelUsed: string;
    usedFallback: boolean;
    toolCallsExecuted?: Array<{ name: string; success: boolean }>;
    iterationLimitHit?: boolean;
  }>;

  /** Optional task summary builder (M7). Injected in production; tests may omit. */
  buildTaskSummary?: (input: TaskSummaryInput) => string;

  /** Optional direct browser reset (for /qa-test to get clean state + cleared monitors). */
  resetBrowser?: () => Promise<void>;

  /** Optional legacy single test credentials for $TEST_* substitution in /qa-run scenarios (Phase 7). */
  testCredentials?: TestCredentials | undefined;

  /** Phase 8 multi-app credentials map for prompt injection and scenario $TEST_CREDENTIALS_<APP> substitution. */
  appCredentials?: Record<string, TestCredentials> | undefined;

  /** TMP_DIR for resolving screenshot paths sent to Telegram during QA runs. */
  tmpDir: string;
}

export type Cod3mateBot = Bot<Context>;

export function createBot(deps: BotDependencies): Cod3mateBot {
  const {
    env,
    dataDir,
    primaryModel,
    fallbackModel,
    loadSession,
    resetSession,
    appendMessage,
    setSelectedModel,
    runAgent,
    resetBrowser,
    testCredentials,
    appCredentials,
    tmpDir,
  } = deps;

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // === CRITICAL: Whitelist middleware MUST be first ===
  bot.use(createOwnerWhitelistMiddleware(env.TELEGRAM_ALLOWED_USER_ID));

  // --- Command handlers (thin shells) ---

  bot.command('start', async (ctx) => {
    const msg = [
      'cod3mate — private AI agent',
      '',
      'You are the verified owner. Send any message to start a task.',
      '',
      'Commands:',
      '/help — capabilities and limits',
      '/status — service health and config',
      '/reset — clear this chat\'s conversation history',
      '/model — view or switch the model for this chat',
      '/qa-history — list recent structured QA reports (from qa_assert_* usage)',
      '/qa-report <id> — show full saved QA report by id (from /qa-history)',
      `/qa-test <url> <desc> — run complex QA (${env.QA_MAX_ITERATIONS} iters + fresh browser + auto report)`,
      '/qa-scenarios — list saved reusable test scenarios',
      '/qa-run <name> — execute a saved scenario (direct steps, produces QA report)',
      'qa_accessibility_audit tool (and auto in reports) — axe-core a11y scan with severities',
    ].join('\n');

    await sendSafe(ctx, msg, env.TELEGRAM_CHUNK_SIZE);
  });

  bot.command('help', async (ctx) => {
    const msg = [
      'cod3mate help',
      '',
      'This is a private bot. Only the whitelisted owner can use it.',
      '',
      'Capabilities:',
      '• OpenAI-powered reasoning with primary + fallback model',
      '• Per-chat conversation memory under /data/sessions',
      '• Personality and rules loaded from /data/SOUL.md',
      '• Tools: file_read, file_write, terminal_exec, web_search,',
      '  browser_navigate, browser_click, browser_fill,',
      '  browser_screenshot, browser_extract_text,',
      '  browser_inspect_form, browser_reset,',
      '  browser_wait_for, browser_wait_for_network_idle, browser_wait_for_text (prevent flaky waits for spinners/async),',
      '  browser_set_viewport (presets: mobile/tablet/desktop/wide or custom; for responsive QA),',
      '  qa_assert_visible, qa_assert_not_visible, qa_assert_text_contains,',
      '  qa_assert_url, qa_assert_element_count, qa_assert_status (HTTP status after navigate),',
      '  qa_check_console_errors, qa_check_network_failures, qa_intercept_api (observe console + network),',
      '  qa_save_scenario (save reusable test plans for /qa-run),',
      '  qa_accessibility_audit (axe-core WCAG scan; returns violations by severity; auto-included in QA reports)',
      '• Browser tab persists across tool calls within a task — multi-step',
      '  flows (navigate → inspect_form → fill → click → screenshot)',
      '  share the same page. Click/fill/extract auto-search iframes',
      '  (Clerk/Auth0/Stripe widgets work transparently).',
      '',
      'Safety:',
      '• Owner-only Telegram whitelist enforced before every handler',
      '• File and terminal tools sandboxed to the temp workspace',
      '• Terminal commands restricted to a conservative allowlist',
      '• Tool output is timeout-bounded, truncated, and sanitized',
      '  (API keys, tokens, and similar secrets are redacted)',
      '',
      'Responses: a single message containing the answer plus a compact footer with tools used and any failures.',
      '',
      `QA mode: /qa-test or explicit QA requests enable structured reports (qa_assert_*) + screenshots sent here. /qa-test uses ${env.QA_MAX_ITERATIONS} iterations and resets the browser. /qa-history and /qa-report <id>. Scenarios: /qa-scenarios, /qa-run <name>.`,
      '',
      'Use /status for current configuration.',
    ].join('\n');

    await sendSafe(ctx, msg, env.TELEGRAM_CHUNK_SIZE);
  });

  bot.command('status', async (ctx) => {
    const lines = [
      'cod3mate status',
      '',
      `Primary model:   ${env.OPENAI_PRIMARY_MODEL}`,
      `Fallback model:  ${env.OPENAI_FALLBACK_MODEL}`,
      '',
      `Data dir:        ${env.DATA_DIR}`,
      `Temp dir:        ${env.TMP_DIR}`,
      `Chunk size:      ${env.TELEGRAM_CHUNK_SIZE}`,
      `Max iterations:  ${env.MAX_AGENT_ITERATIONS} (chat) / ${env.QA_MAX_ITERATIONS} (/qa-test)`,
      '',
      'Agent loop:      active (with tools)',
      'Sessions:        active (persisted under /data/sessions)',
      'Tools:           active (file, terminal, browser, search, qa-assertions)',
      'Task summaries:  active (post-task delivery with sanitization)',
      'QA reports:      active (collector + /data/qa-reports + /qa-history)',
      'QA scenarios:    active (/qa-scenarios, /qa-run, qa_save_scenario tool + /data/qa-scenarios)',
      'QA a11y:         active (qa_accessibility_audit + included in reports)',
      '',
      'Service: healthy (polling)',
    ];

    await sendSafe(ctx, lines.join('\n'), env.TELEGRAM_CHUNK_SIZE);
  });

  bot.command('reset', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await sendSafe(ctx, 'Unable to identify chat for reset.', env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    await resetSession(chatId);

    const msg = [
      'Session reset',
      '',
      'Conversation history for this chat has been cleared.',
      'Future messages will start fresh.',
    ].join('\n');

    await sendSafe(ctx, msg, env.TELEGRAM_CHUNK_SIZE);

    // Record the reset action in a fresh session
    await appendMessage(chatId, 'assistant', 'Session was reset by owner.');
  });

  bot.command('model', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await sendSafe(ctx, 'Unable to determine chat for model command.', env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    const args = (ctx.message?.text ?? '').split(/\s+/).slice(1);
    const sub = (args[0] || '').toLowerCase().trim();

    if (!sub) {
      // Show current status
      const session = await loadSession(chatId);
      const effective = session.selectedModel || primaryModel;

      const lines = [
        'Model configuration',
        '',
        `Primary (env):   ${primaryModel}`,
        `Fallback (env):  ${fallbackModel}`,
        '',
        `Current for this chat: ${effective}`,
        session.selectedModel
          ? `(overridden from primary)`
          : '(using primary from environment)',
        '',
        'Switch with:',
        '/model primary',
        '/model fallback',
        '/model <exact-model-id>',
        '/model clear   (reset to primary)',
      ];
      await sendSafe(ctx, lines.join('\n'), env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    if (sub === 'clear' || sub === 'reset') {
      await setSelectedModel(chatId, undefined);
      await sendSafe(ctx, 'Model reset to primary for this chat.', env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    if (sub === 'primary') {
      await setSelectedModel(chatId, primaryModel);
      await sendSafe(ctx, `Switched this chat to primary model: ${primaryModel}`, env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    if (sub === 'fallback') {
      await setSelectedModel(chatId, fallbackModel);
      await sendSafe(ctx, `Switched this chat to fallback model: ${fallbackModel}`, env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    // Treat anything else as a custom model ID
    const customModel = sub;
    await setSelectedModel(chatId, customModel);
    await sendSafe(ctx, `Switched this chat to custom model: ${customModel}`, env.TELEGRAM_CHUNK_SIZE);
  });

  // QA report history (Phase 2) — include common typo so owners get a reply
  bot.command(['qa-history', 'qa-hisotry'], async (ctx) => {
    if (!dataDir) {
      await sendSafe(ctx, 'QA reports storage not available.', env.TELEGRAM_CHUNK_SIZE);
      return;
    }
    const recent = await listRecentQaReports(dataDir, 10);
    if (recent.length === 0) {
      await sendSafe(ctx, 'No QA reports saved yet. Use qa_assert_* tools during a task to generate one.', env.TELEGRAM_CHUNK_SIZE);
      return;
    }
    const lines = ['Recent QA reports (last 10):', ''];
    for (const r of recent) {
      const ts = r.timestamp ? r.timestamp.replace('T', ' ').slice(0, 19) : '';
      lines.push(`${ts}  ${r.title}`);
      lines.push(`  ${r.total} checks — ${r.passed} pass, ${r.failed} fail  (id: ${r.id})`);
      lines.push('');
    }
    lines.push('Full details: /qa-report <id>  (copy id from a line above)');
    await sendSafe(ctx, sanitizeString(lines.join('\n')), env.TELEGRAM_CHUNK_SIZE);
  });

  bot.command('qa-report', async (ctx) => {
    if (!dataDir) {
      await sendSafe(ctx, 'QA reports storage not available.', env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    const raw = (ctx.message?.text ?? '').trim();
    const reportId = raw.split(/\s+/).slice(1).join(' ').trim();

    if (!reportId) {
      await sendSafe(
        ctx,
        'Usage: /qa-report <report-id>\n\nList ids with /qa-history (id is shown on each line).',
        env.TELEGRAM_CHUNK_SIZE
      );
      return;
    }

    const stored = await loadQaReportById(dataDir, reportId);
    if (!stored) {
      await sendSafe(
        ctx,
        `QA report "${reportId}" not found. Use /qa-history to list recent report ids.`,
        env.TELEGRAM_CHUNK_SIZE
      );
      return;
    }

    const formatted = formatQaReport(stored);
    await sendSafe(ctx, sanitizeString(formatted), env.TELEGRAM_CHUNK_SIZE);
  });

  // Phase 7: list saved reusable scenarios
  bot.command('qa-scenarios', async (ctx) => {
    if (!dataDir) {
      await sendSafe(ctx, 'QA scenarios storage not available.', env.TELEGRAM_CHUNK_SIZE);
      return;
    }
    const scenarios = await listQaScenarios(dataDir, 20);
    if (scenarios.length === 0) {
      await sendSafe(
        ctx,
        'No saved QA scenarios yet. Use the qa_save_scenario tool (or ask the agent to save one) or /qa-run will not find any. Scenarios are stored under /data/qa-scenarios/.',
        env.TELEGRAM_CHUNK_SIZE
      );
      return;
    }
    const lines = ['Saved QA scenarios (most recent first):', ''];
    for (const s of scenarios) {
      const ts = s.savedAt ? s.savedAt.replace('T', ' ').slice(0, 19) : '';
      lines.push(`${s.name}  (${s.stepCount} steps)${s.baseUrl ? ` @ ${s.baseUrl}` : ''}`);
      if (s.description) lines.push(`  ${s.description}`);
      if (ts) lines.push(`  saved: ${ts}`);
      lines.push('');
    }
    lines.push('Run with: /qa-run <name>');
    lines.push('Save new ones by telling the agent "save this flow as <name>" (it will use the qa_save_scenario tool).');
    await sendSafe(ctx, sanitizeString(lines.join('\n')), env.TELEGRAM_CHUNK_SIZE);
  });

  // Phase 5: /qa-test — explicit QA entrypoint with elevated iteration limit + browser reset.
  // Accepts optional leading URL then free-form description of the test to perform.
  // Always resets browser for isolation; uses 25 iterations so complex flows (20+ steps) can complete.
  // Report collection happens the same way (emitted only if qa_assert_* tools actually ran).
  bot.command('qa-test', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await sendSafe(ctx, 'Unable to identify chat for qa-test.', env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    const raw = (ctx.message?.text ?? '').trim();
    const parts = raw.split(/\s+/).slice(1); // drop the /qa-test token

    if (parts.length === 0) {
      const usage = [
        'Usage: /qa-test <url> <description of QA checks>',
        'or:    /qa-test <description of QA checks>',
        '',
        'Examples:',
        '/qa-test https://app.example.com "login as test user, assert dashboard shows welcome, no console errors"',
        '/qa-test Verify the pricing table renders 3 tiers and signup button works',
        '',
        'Behavior:',
        '• Browser state is reset (fresh context) before the run',
        `• Max iterations raised to ${env.QA_MAX_ITERATIONS} (normal chat uses ${env.MAX_AGENT_ITERATIONS})`,
        '• Use qa_assert_* tools inside the flow to auto-build + save a structured QA report',
        '• View saved reports with /qa-history',
      ].join('\n');
      await sendSafe(ctx, usage, env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    // Parse: if first arg is http(s) URL, treat as target; remainder is the test description.
    let targetUrl = '';
    let description = '';
    const first = parts[0] ?? '';
    if (/^https?:\/\//i.test(first)) {
      targetUrl = first;
      description = parts.slice(1).join(' ').trim();
    } else {
      description = parts.join(' ').trim();
    }

    const effectiveTask = [description, targetUrl ? `Target: ${targetUrl}` : '']
      .filter(Boolean)
      .join(' ');

    if (!effectiveTask.trim()) {
      await sendSafe(ctx, 'Please provide a description of what to QA test.', env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    await sendSafe(
      ctx,
      'Starting /qa-test (browser reset, up to 25 tool rounds). Watch for typing — this can take several minutes.',
      env.TELEGRAM_CHUNK_SIZE
    );

    // Reset browser for clean isolated QA state (clears page, context, console/net captures)
    if (resetBrowser) {
      try {
        await resetBrowser();
      } catch (resetErr) {
        console.warn('[qa-test] resetBrowser failed (continuing anyway):', resetErr);
      }
    }

    const userInstruction = effectiveTask;

    // Delegate to shared processor (records to history, runs agent with high limit, emits report if any assertions)
    await processAgentTask(
      ctx,
      userInstruction,
      { maxIterations: env.QA_MAX_ITERATIONS, collectQaReport: true },
      'qa-test'
    );
  });

  // Phase 7: /qa-run <name> — execute a saved scenario (direct step execution, no LLM loop for the plan).
  // - Resets browser for clean state (like /qa-test)
  // - Starts a QA report collector so any assert_* steps inside the scenario auto-populate it
  // - Substitutes $TEST_* creds from env (if configured) into step values at runtime only
  // - Always produces a report message (if the scenario contained assertions) + saves it
  bot.command('qa-run', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await sendSafe(ctx, 'Unable to identify chat for qa-run.', env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    const raw = (ctx.message?.text ?? '').trim();
    const parts = raw.split(/\s+/).slice(1);
    const name = (parts[0] || '').trim();

    if (!name) {
      await sendSafe(
        ctx,
        'Usage: /qa-run <scenario-name>\n\nList available with /qa-scenarios.\nSave new ones via the qa_save_scenario tool (ask the agent to "save the flow I just did as checkout-flow").',
        env.TELEGRAM_CHUNK_SIZE
      );
      return;
    }

    const scenario = await loadQaScenario(dataDir, name);
    if (!scenario) {
      const available = await listQaScenarios(dataDir, 5);
      const hint = available.length
        ? `Available: ${available.map((s) => s.name).join(', ')}`
        : 'No scenarios saved yet.';
      await sendSafe(ctx, `Scenario "${name}" not found.\n${hint}\nUse /qa-scenarios to list.`, env.TELEGRAM_CHUNK_SIZE);
      return;
    }

    // Reset for a clean test run (fresh page/context + cleared observations)
    if (resetBrowser) {
      try {
        await resetBrowser();
      } catch (resetErr) {
        console.warn('[qa-run] resetBrowser failed (continuing):', resetErr);
      }
    }

    const userInstruction = `Run QA scenario: ${scenario.name}${scenario.description ? ` — ${scenario.description}` : ''}`;
    await appendMessage(chatId, 'user', userInstruction);

    const stopTyping = startTypingIndicator(ctx);

    const reportTitle = `QA Scenario: ${scenario.name}`;

    try {
      const execOpts: { testCredentials?: TestCredentials | undefined; appCredentials?: Record<string, TestCredentials> | undefined } = {};
      if (testCredentials) execOpts.testCredentials = testCredentials;
      if (appCredentials && Object.keys(appCredentials).length > 0) execOpts.appCredentials = appCredentials;

      const { result: execRes, report: qaReport, screenshotPaths } = await withQaReportCollector(
        reportTitle,
        () => executeScenarioSteps(scenario, execOpts)
      );

      let execSummary = `Executed ${execRes.executed} steps`;
      if (execRes.failed > 0) execSummary += `, ${execRes.failed} step execution failures`;
      if (execRes.errors.length > 0) {
        execSummary += `. Errors: ${execRes.errors.slice(0, 3).join('; ')}`;
      }

      const resultMsg = [
        `QA Scenario run: ${scenario.name}`,
        execSummary,
        scenario.baseUrl ? `Base URL: ${scenario.baseUrl}` : '',
        `Steps in scenario: ${scenario.steps.length}`,
      ]
        .filter(Boolean)
        .join('\n');
      await sendSafe(ctx, sanitizeString(resultMsg), env.TELEGRAM_CHUNK_SIZE);

      let assistantLine = `Scenario run complete. ${execSummary}`;

      if (qaReport && qaReport.entries.length > 0) {
        const { sessionSuffix } = await deliverQaArtifacts(ctx, {
          dataDir,
          tmpDir,
          chunkSize: env.TELEGRAM_CHUNK_SIZE,
          report: qaReport,
          screenshotPaths,
          ...(scenario.baseUrl ? { targetUrl: scenario.baseUrl } : {}),
        });
        assistantLine += sessionSuffix;
      } else {
        await deliverQaArtifacts(ctx, {
          dataDir,
          tmpDir,
          chunkSize: env.TELEGRAM_CHUNK_SIZE,
          report: null,
          screenshotPaths,
        });
        if (screenshotPaths.length === 0) {
          await sendSafe(
            ctx,
            sanitizeString(
              `QA Report: ${reportTitle}\nRan: 0 checks (scenario had no qa_assert_* steps). Use assert_* steps for a structured report.`
            ),
            env.TELEGRAM_CHUNK_SIZE
          );
        }
      }

      await appendMessage(chatId, 'assistant', assistantLine);
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error('[qa-run] Error executing scenario:', e?.message || err);

      await sendSafe(
        ctx,
        sanitizeString(`Error while running scenario "${name}": ${e?.message || 'unknown'}.`),
        env.TELEGRAM_CHUNK_SIZE
      );
    } finally {
      stopTyping();
    }
  });

  /**
   * Shared handler for both normal chat messages and /qa-test.
   * - Appends user instruction to session
   * - Starts QA report collector only when `shouldCollectQaReport` or `collectQaReport: true`
   * - Calls runAgent (respecting optional per-call maxIterations)
   * - Sends merged answer+footer
   * - On success or error: ends report, persists+sends if entries>0
   * This centralizes the Phase 2 report + M7 merged delivery logic.
   */
  async function processAgentTask(
    ctx: Context,
    userInstruction: string,
    options: ProcessAgentOptions = {},
    logLabel = 'message'
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await appendMessage(chatId, 'user', userInstruction);

    const session = await loadSession(chatId);
    const stopTyping = startTypingIndicator(ctx);

    const collectQa = shouldCollectQaReport(userInstruction, options);
    const runTitle = userInstruction.trim().slice(0, 80) || 'Unnamed task';
    const qaTargetUrl = collectQa ? extractQaTargetUrl(userInstruction) : undefined;

    const runAgentOnce = () => {
      const history = session.history.map((m) => ({ role: m.role, content: m.content }));
      if (collectQa && history.length > 0) {
        const last = history[history.length - 1];
        if (last?.role === 'user') {
          history[history.length - 1] = {
            role: 'user',
            content: augmentInstructionForQa(last.content),
          };
        }
      }
      return runAgent({
        history,
        selectedModel: session.selectedModel ?? null,
        ...(options.maxIterations != null ? { maxIterations: options.maxIterations } : {}),
      });
    };

    try {
      let agentResult: Awaited<ReturnType<typeof runAgent>>;
      let qaReport: import('../tools/qa/report.js').QaReport | null = null;
      let screenshotPaths: string[] = [];

      if (collectQa) {
        const wrapped = await withQaReportCollector(`QA: ${runTitle}`, runAgentOnce);
        agentResult = wrapped.result;
        qaReport = wrapped.report;
        screenshotPaths = wrapped.screenshotPaths;
      } else {
        agentResult = await runAgentOnce();
      }

      const sections: string[] = [];
      if (agentResult.usedFallback) {
        sections.push(`(used fallback model: ${agentResult.modelUsed})`);
      }
      sections.push(agentResult.content);

      const tools = agentResult.toolCallsExecuted ?? [];
      const footer: string[] = [];
      if (tools.length > 0) {
        const successful = tools.filter((t) => t.success).map((t) => t.name);
        const failed = tools.filter((t) => !t.success).map((t) => t.name);
        if (successful.length > 0) footer.push(`Tools: ${successful.join(', ')}`);
        if (failed.length > 0) footer.push(`Failed: ${failed.join(', ')}`);
      }
      if (agentResult.iterationLimitHit) {
        footer.push('Stopped at iteration limit — break the task into smaller steps.');
      }
      if (footer.length > 0) sections.push(`—\n${footer.join('\n')}`);

      await sendSafe(ctx, sanitizeString(sections.join('\n\n')), env.TELEGRAM_CHUNK_SIZE);

      let assistantContent = agentResult.content;
      if (collectQa) {
        const { sessionSuffix } = await deliverQaArtifacts(ctx, {
          dataDir,
          tmpDir,
          chunkSize: env.TELEGRAM_CHUNK_SIZE,
          report: qaReport,
          screenshotPaths,
          ...(qaTargetUrl ? { targetUrl: qaTargetUrl } : {}),
        });
        assistantContent += sessionSuffix;
      }
      await appendMessage(chatId, 'assistant', assistantContent);
    } catch (err: unknown) {
      const apiErr = err as { status?: number; code?: string; message?: string };
      console.error(`[agent] Error processing ${logLabel}:`, {
        status: apiErr.status,
        code: apiErr.code,
        message: apiErr.message,
      });

      if (collectQa && err instanceof QaCollectorRunError) {
        await deliverQaArtifacts(ctx, {
          dataDir,
          tmpDir,
          chunkSize: env.TELEGRAM_CHUNK_SIZE,
          report: err.partial.report,
          screenshotPaths: err.partial.screenshotPaths,
          reportPrefix: 'QA run ended with an error. Partial results:\n\n',
          ...(qaTargetUrl ? { targetUrl: qaTargetUrl } : {}),
        });
      }

      await sendSafe(
        ctx,
        'Sorry, I encountered an error while talking to the model. Please try again or use /status.',
        env.TELEGRAM_CHUNK_SIZE
      );
    } finally {
      stopTyping();
    }
  }

  const knownCommands = new Set([
    '/start',
    '/help',
    '/status',
    '/reset',
    '/model',
    '/qa-history',
    '/qa-hisotry',
    '/qa-report',
    '/qa-scenarios',
    '/qa-test',
    '/qa-run',
  ]);

  // Generic message handler — delegates to shared processor (Phase 5 refactor for /qa-test sharing)
  bot.on('message:text', async (ctx) => {
    const userText = ctx.message.text ?? '';
    if (userText.startsWith('/')) {
      const command = (userText.split(/\s+/)[0] ?? '').split('@')[0]?.toLowerCase() ?? '';
      if (command && !knownCommands.has(command)) {
        await sendSafe(
          ctx,
          `Unknown command: ${command}\n\nTry /help — QA reports use /qa-history (not /qa-hisotry).`,
          env.TELEGRAM_CHUNK_SIZE
        );
      }
      return;
    }
    if (!userText.trim()) return;

    await processAgentTask(ctx, userText);
  });

  return bot;
}

/**
 * Start long-polling (non-blocking).
 * Returns a stop function that can be called during graceful shutdown.
 *
 * The bot poller itself keeps the Node event loop alive.
 */
export function startBot(bot: Cod3mateBot): () => Promise<void> {
  // Fire-and-forget the long-running poller.
  // It only resolves/rejects when the bot is stopped or fatally errors.
  bot.start({
    onStart: (botInfo) => {
      console.log(`[telegram] Bot @${botInfo.username} started (long polling)`);
    },
    drop_pending_updates: true,
  }).catch((err) => {
    console.error('[telegram] Bot polling stopped with error:', err);
  });

  return async () => {
    console.log('[telegram] Stopping bot...');
    await bot.stop();
  };
}

/** Telegram clears the typing action after ~5s; refresh while the agent is busy. */
const TYPING_REFRESH_MS = 4_000;

/**
 * Show "typing..." in the chat header until `stop()` is called.
 * Refreshes on an interval so long tool/browser runs stay visibly in progress.
 */
function startTypingIndicator(ctx: Context): () => void {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return () => {};
  }

  let stopped = false;

  const sendTyping = () => {
    void ctx.api.sendChatAction(chatId, 'typing').catch(() => {
      // Non-fatal: rate limits or transient network errors must not abort the task.
    });
  };

  sendTyping();
  const timer = setInterval(() => {
    if (!stopped) sendTyping();
  }, TYPING_REFRESH_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Internal helper: chunked plain-text reply using Grammy ctx.reply
 */
async function sendSafe(ctx: Context, text: string, maxChunkSize: number) {
  const chunks = chunkMessage(text, { maxChunkSize });

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk);
    } catch (err) {
      // Log but never crash the bot on a single reply failure
      console.error('[telegram] Failed to send chunk:', err);
    }
  }
}