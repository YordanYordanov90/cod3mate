# Custom Telegram AI Agent

## Overview

This project is a private Telegram-controlled AI agent deployed as an always-on Railway service. The agent receives messages only from the owner, uses OpenAI directly for reasoning, can call controlled tools for browser automation, terminal execution, temporary file work, and web search, then streams or chunks responses back to Telegram. It loads behavior, personality, and operating rules from `SOUL.md` at startup and keeps credentials out of model-visible content, tool output, task summaries, and Telegram responses.

## Goals

1. Build a secure personal Telegram agent that responds only to a whitelisted Telegram user ID.
2. Support an agent loop that can reason, call tools, observe results, and produce final answers in Telegram.
3. Integrate OpenAI directly with a primary model and fallback model, including runtime switching through `/model`.
4. Provide reliable Playwright browser automation inside Railway with Chromium dependencies installed in Docker.
5. After completing a task, send a clear Telegram message describing what was done, what tools were used, and any follow-up notes. Do not persist reports to files or external services in this version.
6. Persist `SOUL.md`, session state, and lightweight agent data under Railway volume path `/data`.
7. Sanitize credentials and secrets across logs, tool outputs, model context, task summaries, and Telegram messages.

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

### Task Summary

- After each completed task, send a Telegram message summarizing what was done.
- Summary should include: short title, one-paragraph result, tools used, any important caveats, and recommended next steps if relevant.
- No files are saved and no external services are written to in this version.
- Long summaries are chunked using the standard Telegram chunking rules.
- A saved/persisted reports system may be added in a later version; it is out of scope here.

### Deployment

- Railway service built from a Dockerfile.
- Docker image includes Node.js, Playwright, Chromium, and required system dependencies.
- Persistent Railway volume mounted at `/data`.
- Runtime configuration supplied through Railway environment variables.
- Service designed to stay always on.

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

### Out of Scope

- Multi-user collaboration beyond a single whitelisted owner.
- Public bot access.
- OpenRouter or other model gateway integrations.
- Long-term database-backed memory beyond lightweight session persistence.
- Full web dashboard UI.
- Arbitrary unrestricted shell execution.
- Permanent file storage outside `/data`.
- Persisted report archives to GitHub, databases, or object storage.
- OAuth login flows.

## Success Criteria

1. A whitelisted Telegram user can message the bot and receive an AI response from OpenAI.
2. A non-whitelisted Telegram user receives no useful response and no tool access.
3. The agent can perform at least one successful browser automation task with Playwright in Railway.
4. The agent can run a constrained terminal command and return sanitized output.
5. The agent can read and write a temporary file under `/tmp` while rejecting unsafe paths.
6. The agent can perform a web search through the configured direct API.
7. After completing a task, the agent sends a Telegram task summary describing what was done, including tools used and any caveats. Nothing is persisted to files or external services.
8. `/model` can show and switch between primary and fallback configured models.
9. `SOUL.md` is loaded from `/data` and included in model instructions.
10. Build, lint, and tests pass before deployment.
