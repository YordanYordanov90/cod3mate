# Progress Tracker

Update this file after every meaningful implementation change.

## Status Legend

- ✅ Done
- 🟡 In progress
- ⬜ Not started
- ⚠️ Blocker / needs decision
- 🔵 Resolved (for Open Questions)

## Current Phase

- ✅ Milestone 1 (Foundation) complete.
- ✅ Milestone 2 (Telegram Bot Shell) complete.
- ✅ Milestone 3 (SOUL and Sessions) complete.
- ✅ Milestone 4 (OpenAI Agent Loop) complete.
- ✅ Milestone 5 (Tool Registry) complete.
- ✅ Milestone 6 (Core Tools) complete and fully tested.
- ✅ Milestone 7 (Telegram Task Summary) complete.

## Current Goal

- ✅ Milestone 7 complete. Next: Railway deployment (Milestone 8).

## Completed

- ✅ Created project-specific planning context for:
  - ✅ project overview
  - ✅ architecture
  - ✅ code standards
  - ✅ AI workflow rules
  - ✅ progress tracking
  - ✅ Telegram UI context
- ✅ Replaced the persisted Markdown + GitHub report system with Telegram-only task summaries for v1. No files saved.
- ✅ **Milestone 1: Foundation** — full TypeScript/Node project bootstrap, strict env validation, folder structure, build/test pipeline, and safe startup logging (no secret values ever emitted). All exit criteria from ai-workflow-rules.md Phase 1 satisfied.
- ✅ **Milestone 2: Telegram Bot Shell** — GrammY bot with owner-only whitelist middleware (first in chain), 5 command shells, pure chunking utility, long-polling startup, graceful shutdown, and comprehensive unit tests. Exit criteria met: non-owners blocked before handlers, chunking works, owner receives clean responses.
- ✅ **Milestone 3: SOUL and Sessions** — Persistent `/data` storage layer, SOUL.md with safe default creation, full per-chat JSON session management, working /reset, history capture on messages, and dependency injection into the bot. Exit criteria met: app starts with SOUL, sessions can be loaded/saved/reset.
- ✅ **Milestone 4: OpenAI Agent Loop** — Full OpenAI integration with client wrapper, security-first + SOUL system prompts, primary/fallback handling, per-chat model switching via /model, and real responses for owner messages. Exit criteria met: owners get model answers, /model works for switching, fallback tested with mocks.
- ✅ **Milestone 5: Tool Registry** — Complete shared tool interface, Zod-validated registry, safe execution (timeout + truncation), credential sanitization on all outputs, and agent runner support for tool calling. Exit criteria met: registry can be called, invalid calls fail safely, results are sanitized before reaching the model.
- ✅ **Milestone 6: Core Tools** — All 9 production tools implemented and registered (file_read, file_write, terminal_exec, web_search, browser_navigate/click/fill/screenshot/extract_text). Dedicated unit tests for files (traversal + integration), terminal (allowlist + cwd sandbox + sibling-prefix bypass), and search (mocked Tavily, error paths, key non-leakage). Registry now honors MAX_TOOL_OUTPUT_CHARS from env. Bot `/start` + `/help` updated to reflect live capabilities.
- ✅ **Milestone 7: Telegram Task Summary** — `buildTaskSummary` implemented in `src/summary/mod.ts` producing the exact required structure (short title, one-paragraph Result, Tools used, Caveats, optional Next steps). Full credential sanitization on the summary and all outgoing Telegram responses. Automatic delivery after every agent task using "Working on it...", "Done.", and "Done with issues." + existing chunking. 9 dedicated unit tests covering construction, sanitization, caveats, and edges. Wired into the message handler via DI; /help and /status updated. All 83 tests green, strict TypeScript, zero secret leakage.

## In Progress

- ⬜ Milestone 8: Railway Deployment (Dockerfile, Playwright deps, volume setup, production validation).

## Next Up

- Railway deployment (Dockerfile, volumes, startup validation) — Milestone 8
- Optional: extend agent runner to use MAX_AGENT_ITERATIONS for true multi-round tool loops
- Review and potentially broaden the terminal command allowlist when real workloads need it

## Implementation Milestones

### ✅ Milestone 1: Foundation

- ✅ `package.json` (ESM, scripts for build/dev/test/typecheck, core deps + dev tooling)
- ✅ `tsconfig.json` (strict mode, NodeNext, noUnused*, exactOptional etc.)
- ✅ source folder structure (full per architecture.md: config, telegram, agent, soul, tools/*, summary, security, storage, lib + tests mirror)
- ✅ env validation (Zod schema for all required + optional vars with defaults; fails fast with actionable messages, zero secret leakage)
- ✅ test runner (Vitest + 3 passing tests covering load, failure modes, redaction)
- ✅ build script (`npm run build` / `typecheck` / `test:run` all green)
- ✅ `.env.example` + `.gitignore` (protects .env, data/, dist/, etc.)
- ✅ basic health startup logging + sanitized summary + graceful shutdown skeleton in `src/index.ts`

### ✅ Milestone 2: Telegram Bot Shell

- ✅ GrammY bot startup with long-polling (fire-and-forget poller + stop fn)
- ✅ Owner whitelist middleware (registered first; silent drop for non-owners per UI rules)
- ✅ `/start`, `/help`, `/status`, `/reset`, `/model` thin command shells (no /report)
- ✅ Telegram formatting + safe chunking utility (pure, well tested, respects TELEGRAM_CHUNK_SIZE)
- ✅ Unit tests for whitelist decision (including middleware integration), chunking, and bot creation

### ✅ Milestone 3: SOUL and Sessions

- ✅ `/data` + sessions directory creation at startup (`ensureDataDirectories`)
- ✅ `/data/SOUL.md` loading with safe default template creation + warning log when missing
- ✅ Per-chat session persistence under `/data/sessions/<chatId>.json` (load/save/reset/append)
- ✅ Real `/reset` command that clears persisted history for the current chat
- ✅ Basic user message history capture in the generic text handler
- ✅ Full DI for session functions into the bot (testable)
- ✅ 33 tests passing, including dedicated suites for storage, sessions, and soul loading

### ✅ Milestone 4: OpenAI Agent Loop

- ✅ OpenAI SDK wrapper (`createOpenAIClient`) with typed chat completions
- ✅ System prompt construction (`buildSystemPrompt`) — security rules first, then SOUL
- ✅ Agent runner (`runAgent`) with primary + fallback logic on retryable errors
- ✅ Conversation history integration (session → OpenAI messages)
- ✅ Per-chat model selection + full `/model` switching support (primary / fallback / custom / clear)
- ✅ Real agent responses for owner text messages (replaces placeholder)
- ✅ Comprehensive mocked tests for prompt, runner, and fallback behavior
- ✅ 38 tests passing, clean build with strict TypeScript

### ✅ Milestone 5: Tool Registry

- ✅ Shared Tool interface + ToolResult normalization (code-standards compliant)
- ✅ ToolRegistry with registration, lookup, Zod input validation
- ✅ OpenAI-compatible tool definition generation (JSON Schema from Zod)
- ✅ Safe execution wrapper (timeout + output truncation)
- ✅ Centralized credential sanitization (`src/security/sanitize.ts`) applied to all tool results
- ✅ Agent runner extended to support tool_calls + tool result feedback loop
- ✅ Dedicated registry + sanitization test suites
- ✅ Registry runtime limits (`maxOutputChars`, `timeoutMs`) configurable at startup; wired to `MAX_TOOL_OUTPUT_CHARS` in `src/index.ts`

### ✅ Milestone 6: Core Tools

- ✅ file_read + file_write with full path traversal protection under TMP_DIR (exported `resolveSafePath`)
- ✅ terminal_exec with conservative allowlist (pwd, ls, echo, node/npm --version, etc.), sanitized env, timeout
- ✅ Hardened terminal cwd sandbox using `root + path.sep` prefix check (closes the `/tmp/agent-files-evil` sibling-prefix bypass)
- ✅ Full browser toolset (navigate, click, fill, screenshot, extract_text) using isolated Playwright contexts
- ✅ web_search via Tavily with normalized title/url/snippet output, safe error paths, and Bearer-token isolation
- ✅ All 9 core tools registered and immediately available to the agent loop
- ✅ Browser auto-closes on shutdown; TMP dir ensured at startup
- ✅ Bot `/start` + `/help` updated to advertise live agent + sessions + tools
- ✅ Dedicated unit tests added: `tests/tools/files.test.ts`, `tests/tools/terminal.test.ts`, `tests/tools/search.test.ts`
- ✅ All 74 tests green, strict TypeScript build clean

### ✅ Milestone 7: Telegram Task Summary

- ✅ task summary structure (title, result, tools used, caveats, next steps) per ui-context.md
- ✅ summary builder `buildTaskSummary` in `src/summary/mod.ts` consuming AgentResult + userRequest
- ✅ credential sanitization via `sanitizeString` inside the builder (and on main content delivery)
- ✅ Telegram chunked delivery using existing `sendSafe` + "Working on it...", "Done.", "Done with issues."
- ✅ 9 dedicated unit tests in `tests/summary/summary.test.ts` (structure, caveats, sanitization, edge cases)
- ✅ Wired into message handler + DI; /help and /status updated; 83 tests green

### ⬜ Milestone 8: Railway Deployment

- ⬜ Dockerfile
- ⬜ Playwright/Chromium dependencies
- ⬜ Railway volume documentation
- ⬜ production startup validation

## Open Questions

- 🔵 Resolved: Confirmed OpenAI model IDs — `OPENAI_PRIMARY_MODEL=gpt-5.4-nano`, `OPENAI_FALLBACK_MODEL=gpt-5-mini`.
- 🔵 Resolved: Use Tavily as the direct web search provider for this stack.
- 🔵 Resolved: v1 will use Telegram-only task summaries. No GitHub repo, no file persistence for reports.
- 🔵 Resolved (M6): Initial terminal allowlist scoped to safe diagnostics — `pwd, ls, echo, date, node, npm, which, cat, head, tail, wc, find`. Will broaden only when a real workload requires it.
- 🔵 Resolved (M3): Missing `/data/SOUL.md` creates a safe default template and logs a warning (does not fail startup).
- ⬜ Should the first Railway deployment use Telegram long polling or webhook mode? Polling is simpler for v1.
- ⬜ Should `MAX_AGENT_ITERATIONS` drive a true multi-round tool loop in the agent runner? Currently runner handles one tool batch + one follow-up call. Revisit if real tasks need it.

## Architecture Decisions

- Use TypeScript and Node.js for a typed Telegram bot runtime.
- Use GrammY for Telegram because it is lightweight, mature, and TypeScript-friendly.
- Use the OpenAI SDK directly; do not use OpenRouter.
- Keep model IDs in environment variables because public display names may not match API identifiers.
- Use Tavily for direct web search.
- Store persistent agent data under Railway volume path `/data`.
- Limit file tool access to `/tmp/agent-files`.
- v1 task summaries are Telegram-only; durable report archives to GitHub or any external store are explicitly out of scope until context files are updated.
- Enforce Telegram user whitelist before all command and message handling.
- Centralize credential sanitization and run it across logs, tool results, model observations, Telegram responses, and task summaries.

## Session Notes

- The workspace started empty except for `.DS_Store`.
- The six reference files were templates with placeholder sections.
- The created context files are the initial project plan and should guide implementation.
- ✅ 2026-05-30: Completed Milestone 1 (Foundation). Initialized npm + TS, installed grammy/openai/zod/playwright/vitest, full src/ tree, Zod env with safe errors + redaction, Vitest + passing tests, tsc build green, tsx dev, sanitized startup logs, .env.example + strict .gitignore. Ready for Milestone 2.
- ✅ 2026-05-30: Completed Milestone 2 (Telegram Bot Shell). GrammY bot, owner whitelist middleware (first), /start /help /status /reset /model shells, pure chunkMessage + sendChunked, long-polling + graceful shutdown wiring in index.ts. 16 tests passing. Non-owners silently dropped. No agent/tools yet.
- ✅ 2026-05-30: Completed Milestone 3 (SOUL + Sessions). Storage helpers, SOUL loader with safe default creation + warn, full session CRUD under /data/sessions, real /reset command, user message history capture, DI into bot. 33 tests green. SOUL now always present at startup.
- ✅ 2026-05-30: Completed Milestone 4 (OpenAI Agent Loop). OpenAI client wrapper, security-first prompt builder (rules > SOUL), runner with fallback, real agent responses for normal messages, full /model switching (primary/fallback/custom/clear) persisted per chat, history fed to model. 38 tests green. Owner messages now get actual model output.
- ✅ 2026-05-30: Completed Milestone 5 (Tool Registry). Defined Tool interface + ToolResult, full ToolRegistry with Zod validation + OpenAI schema conversion, timeout + truncation wrapper, centralized sanitization (redacts keys/tokens), and agent runner now handles tool_calls + tool results. 48 tests. Registry is live and ready for tools to be registered in M6.
- ✅ 2026-05-30: Completed Milestone 6 (Core Tools). Implemented and registered: file_read/write (path-safe), terminal_exec (narrow allowlist), 5 browser tools (Playwright isolated contexts), web_search (Tavily). Agent can now use real tools. Browser lifecycle managed.
- ✅ 2026-05-30: M6 hardening + closure. Fixed terminal cwd sibling-prefix bypass with explicit `path.sep` check (`resolveSafeCwd`). Wired `MAX_TOOL_OUTPUT_CHARS` into `ToolRegistry.configure()`. Refreshed bot `/start` + `/help` copy to advertise live agent, sessions, and 9 tools. Added dedicated suites: files (9), terminal (12), search (5 with mocked fetch). 74 tests green, strict TS build clean. M6 is now considered fully complete.
- ✅ 2026-05-30: Completed Milestone 7 (Telegram Task Summary). Implemented `src/summary/mod.ts` with `buildTaskSummary` (title derivation, one-paragraph result, tools list, caveats for fallback/failures/limits, conservative next-steps). Full sanitization on summary + main content. Integrated "Working on it..." + "Done."/"Done with issues." delivery in message handler with DI. Updated /help and /status. 9 new tests (structure, sanitization, edges) + full suite at 83 passing. All invariants respected. M7 complete; ready for M8 Railway deploy.
- Next: Milestone 8 — Railway Dockerfile, Playwright Chromium system deps, volume mount at /data, production validation from clean clone.
