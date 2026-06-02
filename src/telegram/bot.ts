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
    iterationLimitHit?: boolean;
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
      '  browser_screenshot, browser_extract_text,',
      '  browser_inspect_form, browser_reset',
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

    const stopTyping = startTypingIndicator(ctx);
    try {
      const agentResult = await runAgent({
        history: session.history.map((m) => ({ role: m.role, content: m.content })),
        selectedModel: session.selectedModel ?? null,
      });

      await appendMessage(chatId, 'assistant', agentResult.content);

      // Build a single merged message: answer + compact metadata footer.
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

      const merged = sections.join('\n\n');
      await sendSafe(ctx, sanitizeString(merged), env.TELEGRAM_CHUNK_SIZE);
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
    } finally {
      stopTyping();
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