# cod3mate

A private, single-owner Telegram AI agent built on Node.js, TypeScript, GrammY, and the OpenAI SDK, deployed as an always-on Railway service. The owner sends a Telegram message, a whitelist middleware verifies the sender, an OpenAI-driven agent loop reasons and calls tools (browser, terminal, file, search), and the sanitized result is chunked back to Telegram. Secrets never leave environment variables.

> Status: Milestones 1–7 complete (foundation, Telegram shell, SOUL + sessions, agent loop, tool registry, 9 core tools, Telegram task summary). Milestone 8 (Railway deployment) is in progress. See `context/progress-tracker.md` for the live status.

---

## Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 20+ and TypeScript (strict, ESM) |
| Telegram | [GrammY](https://grammy.dev/) |
| AI | OpenAI SDK (direct, no gateway) |
| Validation | [Zod](https://zod.dev/) |
| Browser | Playwright + Chromium |
| Web search | Tavily API |
| Testing | Vitest |
| Deployment | Docker + Railway |

## Features

- **Owner-only Telegram bot** — every update is rejected before the agent loop or tools run unless the sender matches `TELEGRAM_ALLOWED_USER_ID`.
- **OpenAI agent loop** — primary + fallback model, per-chat model switching via `/model`, conversation history, tool-call orchestration.
- **`SOUL.md` personality** — loaded from `/data/SOUL.md` at startup and injected into the system prompt below the hard security rules. Safe default template is created if missing.
- **9 sandboxed tools** — `file_read`, `file_write`, `terminal_exec`, `web_search`, `browser_navigate`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_extract_text`.
- **Hard sandboxing** — file tools confined to `TMP_DIR` with traversal guards, terminal tool gated by a strict allowlist (`pwd, ls, echo, date, node, npm, which, cat, head, tail, wc, find`) with timeout, output cap, sanitized env, and a `path.sep`-anchored cwd containment check.
- **Centralized secret sanitization** (`src/security/sanitize.ts`) — every tool result, log line, error, model observation, and Telegram message is scrubbed before it leaves the process.
- **Telegram task summaries** — after each completed task, the agent sends a short, mobile-friendly summary (title, one-paragraph result, tools used, caveats, next steps). No persisted files, no external services in v1.
- **Persistent state under `/data`** — `SOUL.md`, per-chat session history, and selected models survive restarts on the Railway volume.

## Telegram Commands

| Command | Purpose |
| --- | --- |
| `/start` | Verify access, show available commands. |
| `/help` | Show capabilities and limits. |
| `/status` | Show service status, active model, tool availability. |
| `/reset` | Clear the current chat's conversation history. |
| `/model` | Show current model or switch (primary / fallback / custom / clear). |

Non-whitelisted users receive no useful response and no access to OpenAI, history, or tools.

## Project Layout

```text
src/
  config/      env parsing, model + feature flags
  telegram/    GrammY bot, whitelist middleware, commands, chunking
  agent/      agent runner, OpenAI client wrapper, prompt builder
  soul/       /data/SOUL.md loader and default template
  storage/    /data filesystem helpers + per-chat session CRUD
  tools/      shared registry + Zod schemas
    files/     file_read, file_write (TMP_DIR sandbox)
    terminal/  terminal_exec (allowlist + cwd sandbox)
    search/    web_search (Tavily)
    browser/   navigate, click, fill, screenshot, extract_text
  summary/    Telegram task summary builder
  security/   sanitization, redaction, safe logging
  lib/        small shared utilities
  index.ts    entrypoint, startup validation, graceful shutdown
tests/        mirrors src/
context/      authoritative project docs (read before non-trivial changes)
```

## Prerequisites

- Node.js 20 or newer.
- A Telegram bot token from `@BotFather` and your numeric Telegram user ID.
- An OpenAI API key.
- A Tavily API key.

## Local Setup

```bash
git clone <repo-url> cod3mate
cd cod3mate
npm install

cp .env.example .env
# Fill in TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID, OPENAI_API_KEY,
# OPENAI_PRIMARY_MODEL, OPENAI_FALLBACK_MODEL, TAVILY_API_KEY at minimum.

# Optional for local runs — point DATA_DIR / TMP_DIR at writable paths
# on your machine (Railway provides /data and /tmp/agent-files in prod).

npm run dev        # tsx, hot run from src/
# or
npm run build && npm start
```

Local runs use Telegram long polling, so no public URL or webhook is needed.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run from `src/` with `tsx`. |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm start` | Run the compiled `dist/index.js`. |
| `npm test` | Vitest in watch mode. |
| `npm run test:run` | Vitest single run (used in CI / pre-commit). |
| `npm run typecheck` | `tsc --noEmit` against the full tree. |
| `npm run clean` | Remove `dist/`. |

## Environment Variables

**Required**

| Variable | Description |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot token from `@BotFather`. |
| `TELEGRAM_ALLOWED_USER_ID` | Numeric Telegram user ID of the single owner. |
| `OPENAI_API_KEY` | OpenAI API key. |
| `OPENAI_PRIMARY_MODEL` | Primary model ID (env-driven, never hardcoded). |
| `OPENAI_FALLBACK_MODEL` | Fallback model ID used on retryable errors. |
| `TAVILY_API_KEY` | Tavily web search API key. |

**Optional (with defaults)**

| Variable | Default |
| --- | --- |
| `DATA_DIR` | `/data` |
| `TMP_DIR` | `/tmp/agent-files` |
| `MAX_AGENT_ITERATIONS` | `8` |
| `MAX_TOOL_OUTPUT_CHARS` | `12000` |
| `TELEGRAM_CHUNK_SIZE` | `3500` |
| `LOG_LEVEL` | `info` |
| `ENABLE_FILE_LOGS` | `false` |
| `TAVILY_SEARCH_ENDPOINT` | `https://api.tavily.com/search` |

`.env` is git-ignored. Never commit secrets. Never put raw API keys in `SOUL.md`.

## Runtime Flow

1. `src/index.ts` validates env, ensures `/data` and `TMP_DIR` exist, loads `/data/SOUL.md`.
2. GrammY bot starts with **whitelist middleware registered first** in the chain.
3. Commands are handled before the generic message handler.
4. The agent runner builds the system prompt: security rules > SOUL > tool instructions > history > user message.
5. OpenAI returns a final response or one/more tool calls.
6. The tool registry validates inputs with Zod, runs each tool with a timeout and output cap, and sanitizes the result before the model sees it.
7. The agent loops until a final answer or the iteration limit is reached.
8. The reply is chunked to fit `TELEGRAM_CHUNK_SIZE` and sent to the owner.
9. A Telegram task summary is sent after the task completes.
10. Session history is persisted under `/data/sessions/<chatId>.json`.

## Security Invariants

These are enforced and must not be violated by any change. The full list lives in `AGENTS.md`.

1. Owner-only access — non-whitelisted Telegram updates never reach the agent loop or tools.
2. Zero secret leakage — env values, OpenAI keys, Tavily keys, and bot tokens are redacted before they touch the model, logs, tool results, summaries, or Telegram.
3. File sandbox — file tools stay inside `TMP_DIR` via `resolveSafePath` with `root + path.sep` prefix checks.
4. Terminal sandbox — allowlist, timeout, output cap, cwd containment, sanitized child env.
5. `SOUL.md` is instruction-only — it cannot override security, tool, or access rules. Security rules sit above SOUL in the system prompt.
6. Every tool result passes through `sanitizeToolResult` before reaching the model or Telegram.
7. Task summaries are Telegram-only in v1. No files, no GitHub, no external services.
8. Model IDs come from env. Never hardcoded.
9. Playwright contexts close after each call. The browser closes on graceful shutdown.
10. Must remain deployable from a clean clone with env vars + a mounted `/data`.

## Testing

Vitest covers env validation and redaction, the whitelist middleware, chunking, storage + sessions, SOUL loading, the prompt builder and agent runner (with mocked OpenAI), the tool registry, sanitization, every core tool (files traversal + integration, terminal allowlist + cwd bypass, search with mocked Tavily), and the task summary builder.

```bash
npm run typecheck
npm run test:run
npm run build
```

All three must pass before commit.

## Deployment (Railway, work in progress)

The `Dockerfile` uses a two-stage build:

1. `node:20-slim` builder installs deps and compiles TypeScript to `dist/`.
2. `mcr.microsoft.com/playwright:v1.60.0-jammy` runtime ships Chromium + system libs and runs `node dist/index.js`.

Railway setup:

1. Create a Railway service from this repo.
2. Mount a persistent volume at `/data`.
3. Set the required env vars listed above.
4. Deploy. The bot uses long polling, so no public URL is required for v1.

Webhook mode can be added later if Railway needs HTTP health checks.

## Authoritative Documentation

These files in `context/` are the source of truth and should be read before any non-trivial change:

- `context/project-overview.md` — goals, features, scope, success criteria.
- `context/architecture.md` — system boundaries, runtime flow, storage model, tool registry, invariants.
- `context/code-standards.md` — TypeScript, validation, testing, and tool/file/terminal/browser standards.
- `context/ai-workflow-rules.md` — implementation sequence and when to split work.
- `context/ui-context.md` — Telegram UX, commands, formatting, task summary format, error messages.
- `context/progress-tracker.md` — milestone status, open questions, session notes.
- `AGENTS.md` — distilled invariants and pre-commit checklist for agents working in this repo.

## License

MIT.
