# Custom Telegram AI Agent

## Overview

This project is a private Telegram-controlled AI agent deployed as an always-on Railway service. The agent receives messages only from the owner, uses OpenAI directly for reasoning, can call controlled tools for browser automation, terminal execution, temporary file work, and web search, then streams or chunks responses back to Telegram. It loads behavior, personality, and operating rules from `SOUL.md` at startup and keeps credentials out of model-visible content, tool output, task summaries, and Telegram responses.

## Goals

1. Build a secure personal Telegram agent that responds only to a whitelisted Telegram user ID.
2. Support an agent loop that can reason, call tools, observe results, and produce final answers in Telegram.
3. Integrate OpenAI directly with a primary model and fallback model, including runtime switching through `/model`.
4. Provide reliable Playwright browser automation inside Railway with Chromium dependencies installed in Docker.
5. After completing a task, send a single merged Telegram message: the answer plus an optional compact footer listing tools used and any failures. No files, no external services in this version.
6. Persist `SOUL.md`, session state, and lightweight agent data under Railway volume path `/data`.
7. Sanitize credentials and secrets across logs, tool outputs, model context, task responses, and Telegram messages.
8. Support secure browser-based login testing through `TEST_ACCOUNT_EMAIL` and `TEST_ACCOUNT_PASSWORD` env vars, never accepted from chat input and always silently used inside `browser_fill`.

## Core User Flow

1. The owner sends a Telegram message to the bot.
2. The Telegram middleware verifies the sender against `TELEGRAM_ALLOWED_USER_ID`.
3. The bot loads or updates the conversation session for that chat.
4. The agent builds the model request from `SOUL.md`, current message, recent conversation history, and available tool definitions.
5. OpenAI returns either a final response or one or more tool calls.
6. The tool registry validates and executes each requested tool with Zod schemas.
7. Tool results are sanitized before they are added to conversation history or shown to the model.
8. The agent repeats the think/tool/observe loop until it reaches a final answer or a configured safety limit.
9. The response is formatted for Telegram and streamed or chunked back to the owner.
10. When the task completes, the agent sends a Telegram task summary describing what was done. No file is saved.

## Features

### Telegram Bot

- GrammY-based bot startup and webhook or long-polling support depending on Railway deployment choice.
- Owner-only access through a strict Telegram user ID whitelist.
- Commands:
  - `/start` verifies access and explains available commands.
  - `/help` lists capabilities and security boundaries.
  - `/model` shows the current model and allows switching between configured models.
  - `/reset` clears the current Telegram conversation session.
  - `/status` returns service health, active model, tool availability, and session storage status.

### Agent Runtime

- Agent loop: receive message, construct context, call OpenAI, execute tools, respond.
- Configurable loop limits to avoid runaway tool calls.
- Conversation history stored per Telegram chat or user.
- Tool calls validated with Zod before execution.
- Tool observations sanitized before storage and model reuse.
- OpenAI SDK used directly, with no OpenRouter dependency.

### SOUL.md Integration

- `SOUL.md` is loaded from `/data/SOUL.md` at startup.
- If the file is missing, the app can create a safe default template at `/data/SOUL.md`.
- The content is injected as part of the system prompt on every model request.
- Updates to `SOUL.md` require service restart for the initial version unless hot reload is added later.
- `SOUL.md` must never contain raw API keys; operational secrets belong only in Railway environment variables.

### Tools

- Browser tool using Playwright:
  - Navigate to URLs.
  - Click selectors.
  - Fill form fields.
  - Take screenshots.
  - Extract visible page text or selected content.
- Terminal tool:
  - Execute allowlisted shell commands in the Railway container.
  - Enforce timeout, max output length, working directory restrictions, and sanitization.
- File tool:
  - Read and write files only under `/tmp` for transient task artifacts.
  - Reject path traversal and writes outside the configured safe root.
- Web search tool:
  - Use Tavily directly through the Tavily API.
  - Return normalized result titles, URLs, snippets, and timestamps when available.

### Task Response

- After each completed task, send one merged Telegram message: the agent's answer plus an optional `—` footer.
- Footer surfaces (only when present): tools that succeeded, tools that failed, fallback model usage, iteration-limit cutoff.
- No files are saved and no external services are written to in this version.
- Long messages are chunked using the standard Telegram chunking rules.
- The legacy structured summary builder is retained in `src/summary/mod.ts` for potential future reuse (digests, alternative channels).

### Test Credentials (Optional Browser Login)

- `TEST_ACCOUNT_EMAIL` and `TEST_ACCOUNT_PASSWORD` may be configured in Railway / `.env.local`.
- When both are set, the agent receives them through an elevated-priority block in the system prompt (above SOUL, equal priority to security rules) with strict no-echo policy.
- Both literal values are registered with the central sanitizer so any accidental leak in tool output, replies, or logs is redacted to `[REDACTED]`.
- Credentials are never accepted from chat input; the agent refuses any flow that would require the owner to type them into Telegram.
- Used silently inside `browser_fill` for live application testing (e.g. logging into a deployed site to verify protected pages).

### Deployment

- Railway service built from a Dockerfile.
- Docker image includes Node.js, Playwright, Chromium, and required system dependencies.
- Persistent Railway volume mounted at `/data`.
- Runtime configuration supplied through Railway environment variables.
- Service designed to stay always on.

### Private Dashboard (v1, in progress)

A private, read-only web dashboard for inspecting QA results. Previously listed as a future web UI, it is now being implemented. Full plan and milestones live in `context/dashboard.md`.

- Lets the owner review QA projects, reports, failed checks, and screenshots in a web UI instead of relying solely on Telegram messages.
- Railway remains the source of truth for QA reports and screenshots because that data already lives on the Railway volume.
- The Next.js dashboard (deployed on Vercel) reads through a small authenticated Railway dashboard API; Vercel cannot read the Railway volume directly.
- Dashboard v1 is a public portfolio (read-only): Clerk sign-in for any user (all reports shown; no owner allowlist or curation), server-to-server bearer token on the Railway API.
- Screenshots are private artifacts served through the authenticated API, never as public static files.
- No dashboard-triggered agent runs and no terminal/file/browser/OpenAI tool execution from the dashboard in v1.
- A future portfolio/demo chat is explicitly separate work with its own demo-safe storage and stricter tool limits (see `context/dashboard.md`).

## Scope

### In Scope

- TypeScript and Node.js project setup.
- GrammY Telegram bot.
- OpenAI SDK integration with model selection and fallback.
- Zod validation for environment variables, commands, tool inputs, and tool outputs.
- Playwright browser tool running in containerized Railway.
- Terminal tool with strict safety constraints.
- File tool limited to `/tmp`.
- Web search through direct API integration.
- Telegram task summary after completed tasks.
- Railway Docker deployment.
- Credential sanitization middleware.
- Per-user or per-chat conversation history.
- Private, read-only QA dashboard v1 (see `context/dashboard.md`):
  - Authenticated, read-only Railway dashboard API (health, projects, reports, screenshots).
  - Durable QA screenshot artifacts under `/data/qa-artifacts`.
  - Next.js dashboard on Vercel with Clerk sign-in (all reports shown), calling Railway server-side only.

### Out of Scope

- Multi-user collaboration beyond a single whitelisted owner.
- Public bot access.
- OpenRouter or other model gateway integrations.
- Long-term database-backed memory beyond lightweight session persistence.
- Public or multi-tenant SaaS dashboard. (A private, read-only owner-only dashboard v1 is in scope — see `context/dashboard.md`.)
- Dashboard-triggered agent runs or any terminal/file/browser/OpenAI tool execution from the dashboard in v1.
- Public portfolio/demo agent chat. (Explicitly deferred to separate future work with demo-safe storage and stricter tool limits.)
- Arbitrary unrestricted shell execution.
- Permanent file storage outside `/data`.
- Persisted report archives to GitHub, databases, or object storage. (QA reports/screenshots persist on the Railway `/data` volume only; no external store.)
- OAuth login flows for the Telegram agent itself. (Clerk auth applies only to the separate dashboard frontend.)

## Success Criteria

1. A whitelisted Telegram user can message the bot and receive an AI response from OpenAI.
2. A non-whitelisted Telegram user receives no useful response and no tool access.
3. The agent can perform at least one successful browser automation task with Playwright in Railway.
4. The agent can run a constrained terminal command and return sanitized output.
5. The agent can read and write a temporary file under `/tmp` while rejecting unsafe paths.
6. The agent can perform a web search through the configured direct API.
7. After completing a task, the agent sends one merged Telegram message containing the answer and an optional footer with tools used / failures / iteration-limit notice. Nothing is persisted to files or external services.
8. `/model` can show and switch between primary and fallback configured models.
9. `SOUL.md` is loaded from `/data` and included in model instructions.
10. Build, lint, and tests pass before deployment.
