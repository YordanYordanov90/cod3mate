# AGENTS.md — cod3mate

Private, single-owner Telegram AI agent on Railway. Owner messages a GrammY bot → whitelist check → OpenAI agent loop → tools (browser, terminal, file, search) → sanitized output → chunked Telegram reply. Secrets never leave env vars.

## Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js + TypeScript (strict, ESM) |
| Telegram | GrammY |
| AI | OpenAI SDK (direct, no OpenRouter) |
| Validation | Zod |
| Browser | Playwright + Chromium |
| Web Search | Tavily API |
| Testing | Vitest |
| Deployment | Docker + Railway |

## Critical Invariants

These must never be violated. Check every change against them.

1. **Owner-only access.** No update from a non-whitelisted user may reach the agent loop or tools. Whitelist middleware is registered **first** in the GrammY chain.
2. **Zero secret leakage.** No env secret may appear in OpenAI prompts, Telegram messages, logs, task summaries, tool results, or session history. Use `src/security/sanitize.ts`.
3. **File sandbox.** File tools must stay inside `TMP_DIR`. Use `resolveSafePath` with the `root + path.sep` prefix check (not bare `startsWith`).
4. **Terminal sandbox.** Bounded by allowlist, timeout, max output, cwd containment (same `path.sep` check), and sanitized child env.
5. **SOUL.md is instruction only.** Never overrides security/tool/access rules. Security rules sit **above** SOUL in the system prompt.
6. **Tool output sanitization.** Every tool result passes through `sanitizeToolResult` before reaching the model or Telegram.
7. **Task summaries are Telegram-only.** No files, no external services, no GitHub in v1.
8. **Environment-driven models.** Model IDs from `OPENAI_PRIMARY_MODEL` / `OPENAI_FALLBACK_MODEL`, never hardcoded.
9. **Browser cleanup.** Playwright contexts close after each invocation. Browser instance closes on graceful shutdown.
10. **Clean-clone deployable.** Must work from a clean clone with env vars + mounted `/data`.

## Security Rules

- All redaction centralized in `src/security/sanitize.ts`.
- Patterns cover: env values, `sk-*` OpenAI keys, `tvly-*` Tavily keys, Telegram bot tokens, common credential shapes.
- Sanitization scope: logs, errors, tool outputs, Telegram responses, task summaries, model observations.
- Never commit `.env`. Never pass secrets into tool child processes unless output is fully sanitized.
- Treat all external data as untrusted: Telegram updates, model outputs, tool inputs, search results, file contents, terminal output.

## Environment Variables

**Required:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID` (int), `OPENAI_API_KEY`, `OPENAI_PRIMARY_MODEL`, `OPENAI_FALLBACK_MODEL`, `TAVILY_API_KEY`

**Optional (defaults):** `DATA_DIR` (`/data`), `TMP_DIR` (`/tmp/agent-files`), `MAX_AGENT_ITERATIONS` (`8`), `MAX_TOOL_OUTPUT_CHARS` (`12000`), `TELEGRAM_CHUNK_SIZE` (`3500`), `LOG_LEVEL` (`info`), `ENABLE_FILE_LOGS` (`false`), `TAVILY_SEARCH_ENDPOINT` (`https://api.tavily.com/search`)

## Registered Tools (9)

| Tool | Module | Sandbox |
| --- | --- | --- |
| `file_read` | `src/tools/files/` | `TMP_DIR` with `resolveSafePath` traversal guard |
| `file_write` | `src/tools/files/` | Same |
| `terminal_exec` | `src/tools/terminal/` | Allowlist + `resolveSafeCwd` + sanitized env + timeout |
| `web_search` | `src/tools/search/` | Tavily API, Bearer auth, key never in result |
| `browser_navigate` | `src/tools/browser/` | Isolated Playwright context per invocation |
| `browser_click` | `src/tools/browser/` | Same |
| `browser_fill` | `src/tools/browser/` | Same |
| `browser_screenshot` | `src/tools/browser/` | Saved under `TMP_DIR/screenshots/` |
| `browser_extract_text` | `src/tools/browser/` | Same |

## Terminal Allowlist

`pwd`, `ls`, `echo`, `date`, `node`, `npm`, `which`, `cat`, `head`, `tail`, `wc`, `find`. Expand only by updating `src/tools/terminal/mod.ts`, adding tests, and noting in the tracker.

## Current Status

- **Milestones 1–6 complete.** Foundation, Telegram shell, SOUL + sessions, OpenAI agent loop, tool registry, 9 core tools — all implemented, tested (74 tests), wired.
- **Milestone 7 in progress:** Telegram task summary builder.
- **Milestone 8 not started:** Railway Docker deployment.

## Before Committing

1. `npm run build` passes.
2. `npm run test:run` passes.
3. `npm run typecheck` passes.
4. No invariant above was violated.
5. `progress-tracker.md` reflects completed and next work.
6. No secrets, `.env`, `/data/`, `/tmp/`, or sensitive screenshots staged.

## Full Details

Architecture, code standards, workflow rules, project structure, and implementation history live in `context/`. Read them before any non-trivial change:

- `context/architecture.md` — system boundaries, runtime flow, storage model, tool registry, invariants
- `context/code-standards.md` — TypeScript rules, validation, testing, tool/file/terminal/browser standards
- `context/ai-workflow-rules.md` — implementation sequence, scoping rules, when to split work
- `context/project-overview.md` — goals, features, scope, success criteria
- `context/ui-context.md` — Telegram UX, commands, formatting, task summary format, error messages
- `context/progress-tracker.md` — milestone status, open questions, session notes
