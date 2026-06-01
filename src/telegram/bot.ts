import { Bot, Context } from 'grammy';
import type { Env } from '../config/env.js';
import { chunkMessage } from './format.js';
import { createOwnerWhitelistMiddleware } from '../security/access.js';
import type { ChatSession } from '../storage/sessions.js';
import { sanitizeString } from '../security/sanitize.js';
import type { TaskSummaryInput } from '../summary/mod.js';

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
  }) => Promise<{
    content: string;
    modelUsed: string;
    usedFallback: boolean;
    toolCallsExecuted?: Array<{ name: string; success: boolean }>;
  }>;

  /** Optional task summary builder (M7). Injected in production; tests may omit. */
  buildTaskSummary?: (input: TaskSummaryInput) => string;
}

export type Cod3mateBot = Bot<Context>;

export function createBot(deps: BotDependencies): Cod3mateBot {
  const {
    env,
    primaryModel,
    fallbackModel,
    loadSession,
    resetSession,
    appendMessage,
    setSelectedModel,
    runAgent,
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
      '  browser_screenshot, browser_extract_text',
      '',
      'Safety:',
      '• Owner-only Telegram whitelist enforced before every handler',
      '• File and terminal tools sandboxed to the temp workspace',
      '• Terminal commands restricted to a conservative allowlist',
      '• Tool output is timeout-bounded, truncated, and sanitized',
      '  (API keys, tokens, and similar secrets are redacted)',
      '',
      'Task summaries: automatic structured summary (Done. / Done with issues.) sent after every agent task, with tools used and caveats.',
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
      `Max iterations:  ${env.MAX_AGENT_ITERATIONS}`,
      '',
      'Agent loop:      active (with tools)',
      'Sessions:        active (persisted under /data/sessions)',
      'Tools:           active (file, terminal, browser, search)',
      'Task summaries:  active (post-task delivery with sanitization)',
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

  // Generic message handler — agent + M7 task summary delivery
  bot.on('message:text', async (ctx) => {
    if (ctx.message.text?.startsWith('/')) return;

    const chatId = ctx.chat?.id;
    const userText = ctx.message.text ?? '';
    if (!chatId) return;

    // 1. Record the user message
    await appendMessage(chatId, 'user', userText);

    // 2. Load latest history for context
    const session = await loadSession(chatId);

    try {
      // 3. Signal that a (potentially tool-using) task is running
      await sendSafe(ctx, 'Working on it...', env.TELEGRAM_CHUNK_SIZE);

      // 4. Run the agent
      const agentResult = await runAgent({
        history: session.history.map((m) => ({ role: m.role, content: m.content })),
        selectedModel: session.selectedModel ?? null,
      });

      // 5. Persist the assistant reply
      await appendMessage(chatId, 'assistant', agentResult.content);

      // 6. Send the primary response (the actual answer to the user), sanitized
      const prefix = agentResult.usedFallback
        ? `(used fallback model: ${agentResult.modelUsed})\n\n`
        : '';
      const mainContent = prefix + agentResult.content;
      await sendSafe(ctx, sanitizeString(mainContent), env.TELEGRAM_CHUNK_SIZE);

      // 7. M7: deliver structured task summary (builder handles its own sanitization)
      if (deps.buildTaskSummary) {
        const summaryInput: TaskSummaryInput = {
          userRequest: userText,
          result: agentResult.content,
          toolsUsed: agentResult.toolCallsExecuted,
          usedFallback: agentResult.usedFallback,
          modelUsed: agentResult.modelUsed,
        };
        const summaryText = deps.buildTaskSummary(summaryInput);

        const hasIssues =
          agentResult.usedFallback ||
          (agentResult.toolCallsExecuted ?? []).some((t) => !t.success);
        const status = hasIssues ? 'Done with issues.' : 'Done.';

        await sendSafe(ctx, `${status}\n\n${summaryText}`, env.TELEGRAM_CHUNK_SIZE);
      }
    } catch (err: unknown) {
      const apiErr = err as { status?: number; code?: string; message?: string };
      console.error('[agent] Error processing message:', {
        status: apiErr.status,
        code: apiErr.code,
        message: apiErr.message,
      });
      await sendSafe(
        ctx,
        'Sorry, I encountered an error while talking to the model. Please try again or use /status.',
        env.TELEGRAM_CHUNK_SIZE
      );
    }
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