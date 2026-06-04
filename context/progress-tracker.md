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
- ✅ Milestone 7 (Telegram Task Summary) complete (later consolidated — see M8 notes).
- ✅ Milestone 8 (Railway Deployment) complete. Bot is live for the whitelisted owner.

## Current Goal

- All milestones from the original plan are complete. Bot is in active personal use. Future work is incremental hardening and feature requests as they come up.

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
- ✅ **Milestone 7: Telegram Task Summary** — `buildTaskSummary` implemented in `src/summary/mod.ts` producing the exact required structure (short title, one-paragraph Result, Tools used, Caveats, optional Next steps). Full credential sanitization on the summary and all outgoing Telegram responses. Originally delivered as a separate "Working on it..." / "Done." / summary message. **Consolidated during M8** into a single merged Telegram message (answer + compact `—` footer with tools used / failures / iteration-limit notice) because the structured summary repeated the answer paragraph on mobile. The 9 unit tests for `buildTaskSummary` still pass; the function is retained for potential future reuse but is not currently wired into the bot.
- ✅ **Milestone 8: Railway Deployment** — Multi-stage Dockerfile (Node 20 builder → `mcr.microsoft.com/playwright:v1.52.0-jammy` runtime, deps pruned, browser download skipped in builder). `.dockerignore` excludes `.env*`, runtime data, tests, docs, and editor noise. Repo pushed to GitHub; Railway service deploys from `main` automatically. Persistent volume mounted at `/data`. Custom `SOUL.md` uploaded to `/data/SOUL.md` via `railway ssh` after registering the local SSH key with Railway. All required env vars configured in Railway Variables. Bot is online and operational for the whitelisted owner.
- ✅ **Multi-round tool loop** — `runAgent` rewritten as a true bounded `for` loop over `MAX_AGENT_ITERATIONS`. Each iteration is one model call; tool results append and another iteration runs until the model returns a tool-free answer or the limit is hit. Fallback to `OPENAI_FALLBACK_MODEL` is now first-iteration-only (after any tool result, the active model is locked). `iterationLimitHit` is surfaced in the merged-message footer. All 94 tests pass.
- ✅ **Test credentials feature** — `TEST_ACCOUNT_EMAIL` / `TEST_ACCOUNT_PASSWORD` optional env pair. When both are set, the agent receives them through an elevated-priority block in the system prompt (above SOUL, equal priority to security rules) with strict no-echo policy. Both literal values are registered with the central sanitizer at startup so any leak is redacted to `[REDACTED]`. Credentials are never accepted from chat input; the agent refuses any flow that would require the owner to type them. Used silently inside `browser_fill` for live application testing.

## Recently Completed

- Single merged Telegram response per task (replaces 3-message flow).
- True multi-round agent loop bounded by `MAX_AGENT_ITERATIONS`.
- Test-credentials block (`TEST_ACCOUNT_EMAIL` / `TEST_ACCOUNT_PASSWORD`) wired through prompt + sanitizer.
- Railway deployment with Dockerfile, `/data` volume, and custom SOUL.md uploaded over SSH.
- Phase 1 of QA Agent Roadmap: 5 structured assertion tools (`qa_assert_visible`, `qa_assert_not_visible`, `qa_assert_text_contains`, `qa_assert_url`, `qa_assert_element_count`) + shared browser locator helpers + 13 new tests. All return `{passed, expected, actual, message}`; cross-frame supported; build/test/typecheck green (total 107 tests).
- Phase 2 of QA Agent Roadmap: QA Report Collector + Formatter in `src/tools/qa/report.ts` (start/record/end, auto-wired from assertions via optional `name` labels + derived names + timing), persistence under `/data/qa-reports/` via new `src/storage/qa-reports.ts` (save + listRecent summaries), `/qa-history` Telegram command, report auto-emitted as follow-up message (sanitized) for any run that executes qa_assert_* tools (plus error-path handling), updated help/status/start. 7 dedicated report tests + 114 total tests green. Foundation for explicit /qa-test (Phase 5) and scenarios (Phase 7).
- Phase 3 of QA Agent Roadmap: Network & Console Observation — Playwright event listeners (console error/warn, requestfailed, response w/ truncated body + 4xx) in browser core; clear on nav/reset; 3 qa_* tools in qa/monitoring.ts; 6 tests (capture, clear-via-nav, truncation); 120 tests total green.
- Phase 4 of QA Agent Roadmap: Wait Tools — browser_wait_for (selector+state+timeout, cross-frame), browser_wait_for_network_idle, browser_wait_for_text (reuses text resolver); return elapsed ms; 6 tests (appear/timeout/text/idle + elapsed); now 126 tests green.
- Phase 5 of QA Agent Roadmap: Raise Iteration Limit for QA — added `/qa-test <url> <desc>` command (parses URL+description), browser reset via `resetBrowserState`, per-run `maxIterations:25` (env default stays 8 for normal chat), refactored shared `processAgentTask` helper in bot.ts for DRY run/report/merged-send logic. Updated /start /help /status. 126 tests + build + typecheck green. (No new tests needed; leverages existing QA paths.)
- Phase 6 of QA Agent Roadmap: Terminal Allowlist Expansion — added `grep`, `curl`, `npx`, `git` (with strict read-only subcommand/flag guards for git + GET-only + no-write guards for curl). Enhanced `isCommandAllowed` + two new validators in `src/tools/terminal/mod.ts`. Updated tool description for the model. Expanded tests (policy + direct guards + exec + blocked variants) + updated docs (AGENTS, README, roadmap, tracker). 126+ tests green; dangerous ops (git push/reset/clone, curl POST/data/-o etc.) still blocked at the gate. 
- Phase 7 of QA Agent Roadmap: Reusable Test Scenarios — full storage under /data/qa-scenarios (save/load/list by name), scenario-runner.ts with typed steps + $TEST_* substitution (runtime only) + executor (via toolRegistry, integrates with report collector for asserts) + qa_save_scenario tool. /qa-scenarios + /qa-run Telegram commands (with browser reset + report emission like /qa-test). Updated ensure paths, bot deps (testCredentials), index registration, /start/help/status. 8 new tests (then 141). No literal creds in storage. Build/test/typecheck green.
- Phase 8 of QA Agent Roadmap: Multi-App Credential Support — env pattern TEST_CREDENTIALS_<APP>_* parsed in config/env (getAppCredentials + passthrough), legacy TEST_ACCOUNT_* preserved. Prompt updated to inject per-app blocks (names listed + values for model use; selection by context like "test on CloudcastAI"). All values registered w/ sanitizer at start. Extended to scenario substitution (supports $TEST_CREDENTIALS_<APP>_* + legacy), save-tool literal-value guard (across all sets), bot/runner threading of appCredentials map. Updated tests/docs (env.test + prompt.test). 143 tests green.
- Phase 9 of QA Agent Roadmap: Viewport & Responsive Testing — added `browser_set_viewport` tool (presets + custom, using persistent page.setViewportSize()). Updated BrowserTools interface + registration in index. Updated help text. New dedicated tests (presets, custom, validation, post-set viewportSize query + screenshot effect). 143 tests green. Screenshots now reflect viewport changes for QA flows.
- Phase 10 of QA Agent Roadmap: Accessibility Auditing — installed @axe-core/playwright. Added `qa_accessibility_audit` tool in src/tools/qa/accessibility.ts (uses AxeBuilder.analyze(), structured by severity, auto-records to active QA report via recordAssertion for inclusion in reports). Registered in index. Updated bot help/status/start. New tests (violations page, clean page, report integration). 150 tests green. All exit criteria met.
- Medium-issue cleanup: synced AGENTS.md, README.md, architecture.md, SOUL.md (env-only test creds), progress-tracker QA section; tightened `npx` allowlist; blocked `git config`; documented test-credential system-prompt exception in invariants.
- High-priority QA UX: AsyncLocalStorage report collector (no cross-task bleed), QA collection only on `/qa-test`, `/qa-run`, or explicit QA phrasing; screenshots auto-sent to Telegram during active QA runs (`src/telegram/qa-ux.ts`).

## Next Up (incremental, no fixed schedule)

- Further terminal expansions only if real QA workloads demonstrate need (Phase 6 added grep/curl/npx/git-read; npx restricted to known runners, `git config` blocked).
- Decide whether to re-wire the structured summary builder into a separate channel (digest / log / per-task artifact) or remove it.
- Optional: webhook mode in front of long-polling once a public hostname is justified.
- Optional: hot reload of `SOUL.md` without a redeploy.

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

### ✅ Milestone 8: Railway Deployment

- ✅ Multi-stage `Dockerfile` (Node 20 builder, Playwright Jammy runtime, dev deps pruned, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in builder)
- ✅ Playwright/Chromium dependencies bundled via `mcr.microsoft.com/playwright:v1.52.0-jammy`
- ✅ `.dockerignore` excludes secrets, runtime data, tests, docs
- ✅ Railway service deploys from GitHub `main` (auto-deploy on push)
- ✅ Persistent volume attached and mounted at `/data`
- ✅ All required env vars configured in Railway Variables; missing-var crash on first deploy confirmed fail-fast behavior works
- ✅ Custom `SOUL.md` uploaded to `/data/SOUL.md` via `railway ssh "cat > /data/SOUL.md" < ./SOUL.md` after registering the local SSH key with Railway
- ✅ Production startup validated: env loaded, SOUL loaded from volume, browser initialized, bot polling, owner can interact

## Open Questions

- 🔵 Resolved: Confirmed OpenAI model IDs — `OPENAI_PRIMARY_MODEL=gpt-5.4-nano`, `OPENAI_FALLBACK_MODEL=gpt-5-mini`.
- 🔵 Resolved: Use Tavily as the direct web search provider for this stack.
- 🔵 Resolved: v1 will use Telegram-only task summaries. No GitHub repo, no file persistence for reports.
- 🔵 Resolved (M6): Initial terminal allowlist scoped to safe diagnostics — `pwd, ls, echo, date, node, npm, which, cat, head, tail, wc, find`. Will broaden only when a real workload requires it.
- 🔵 Resolved (M3): Missing `/data/SOUL.md` creates a safe default template and logs a warning (does not fail startup).
- 🔵 Resolved (M8): First Railway deployment uses Telegram long polling. Webhook mode can be added later if a public HTTPS endpoint is justified.
- 🔵 Resolved (M8): `MAX_AGENT_ITERATIONS` now drives a true multi-round tool loop. Each iteration is one model call; fallback is first-iteration-only.
- 🔵 Resolved (M8): Task response collapsed to a single merged Telegram message (answer + footer) instead of `Working on it...` / answer / `Done.` + summary. Structured `buildTaskSummary` retained for potential future reuse.

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
- ✅ 2026-06-01 / 2026-06-02: Completed Milestone 8 (Railway Deployment) and shipped two follow-up improvements driven by real owner usage:
  - **Deploy:** wrote multi-stage Dockerfile (Node 20 builder → Playwright Jammy runtime), `.dockerignore`, pushed to GitHub, connected Railway service, attached `/data` volume, configured env vars, registered local SSH key, and uploaded a custom `SOUL.md` over `railway ssh`.
  - **Single merged Telegram message:** the original "Working on it..." / answer / "Done." + structured summary flow read as a duplicate reply on mobile because the summary repeated the answer paragraph. Replaced with one merged message: `(used fallback model: ...)` (optional) + answer + optional `—` footer (`Tools: ...`, `Failed: ...`, iteration-limit notice). Updated `/help` to describe the new shape. The structured `buildTaskSummary` and its 9 tests are retained but no longer wired into the bot.
  - **Multi-round tool loop:** `runAgent` rewritten as a true bounded `for` loop over `MAX_AGENT_ITERATIONS` so the agent can complete real workflows (navigate → fill email → fill password → click submit → navigate to dashboard → screenshot → extract text). Fallback to `OPENAI_FALLBACK_MODEL` is now first-iteration-only — once any tool result is in the conversation, the active model is locked. `iterationLimitHit` is surfaced in the merged-message footer.
  - **Test credentials feature:** `TEST_ACCOUNT_EMAIL` / `TEST_ACCOUNT_PASSWORD` env pair (already scaffolded in `src/agent/prompt.ts` + `src/index.ts`) confirmed working in production. The agent uses them silently inside `browser_fill` and refuses any flow that would require the owner to send credentials in chat. Both values registered with the central sanitizer.
  - All 94 tests still pass; strict TypeScript and lint clean. Bot is online for the whitelisted owner.
- ✅ 2026-06-01: Pinned Playwright **1.60.0** in `package.json` + `mcr.microsoft.com/playwright:v1.60.0-jammy` runtime image (was 1.52.0 in Docker vs 1.60.0 from npm lock — browser version mismatch in production).
- ✅ 2026-06-??: Completed Phase 1 (Assertion Tools) from `context/improvements/qa-agent-roadmap.md`. Created `src/tools/qa/assertions.ts` (5 tools), exported browser helpers (`getOrCreatePage`, `resolveLocatorAcrossFrames`, new `resolveVisibleLocator` + `isVisibleAcrossFrames`), wired registration in `src/index.ts`, added `tests/tools/qa-assertions.test.ts` (covers pass/fail/missing/cross-frame using setContent + srcdoc iframes for isolation). `npm run build && npm run test:run && npm run typecheck` verified. Updated roadmap + this tracker. 107 tests passing. Foundation for future QA report builder (Phase 2). No invariants violated (sandboxing, sanitization not impacted as assertions produce only DOM-derived pass/fail data).

## QA Roadmap Progress (from context/improvements/qa-agent-roadmap.md)

- ✅ Phase 1: Assertion Tools
- ✅ Phase 2: QA Report Builder (depends on 1) — collector, auto-wiring from assertions, Telegram emission + /data persistence, /qa-history command, full tests
- ✅ Phase 3: Network & Console Observation — passive Playwright listeners in browser/mod for console (error/warn), network failures (4xx+ + aborted), responses (w/ truncated bodies); 3 qa_ tools; clear on nav/reset; tests for capture + clear + truncation.
- ✅ Phase 4: Wait Tools — browser_wait_for (w/ appear/disappear states + cross-frame), network_idle, wait_for_text; elapsed time reporting; registered + tested.
- ✅ Phase 5: Raise Iteration Limit for QA — `/qa-test`, `QA_MAX_ITERATIONS` env, shared `processAgentTask`.
- ✅ Phase 6: Terminal expansion — grep, curl, npx, git with guards.
- ✅ Phase 7: Reusable scenarios — `/qa-scenarios`, `/qa-run`, `qa_save_scenario`.
- ✅ Phase 8: Multi-app credentials — `TEST_CREDENTIALS_<APP>_*`.
- ✅ Phase 9: Viewport — `browser_set_viewport`.
- ✅ Phase 10: Accessibility — `qa_accessibility_audit` + axe-core.
- ✅ Post-roadmap hardening: `qa_assert_status`, `/qa-report`, extended scenario steps, `QA_MAX_ITERATIONS`, session QA snapshots, docs/SOUL/architecture sync, tighter `npx` + blocked `git config`.

- ✅ 2026-06-??: Completed Phase 2 (QA Report Builder). `src/tools/qa/report.ts` (collector + exact formatQaReport + record from assertions), `src/storage/qa-reports.ts`, wired start/end around every agent run in bot.ts (report only sent/persisted when assertions actually used; sanitized; works on error paths too). Optional `name` on qa_assert tools for nice labels. /qa-history command + help/status updates. 114 tests, clean build/typecheck. All invariants respected (sanitization on output, no new secret paths, /data under ensure). Ready for Phase 3 (console/net) or Phase 5 (tagging + iter bump).
- ✅ 2026-06-??: Completed Phase 3 (Network & Console Observation). Listeners for console (error/warn), requestfailed, response (w/ 4KB truncate + 4xx capture) attached in getOrCreatePage + cleared in navigate/reset. 3 new qa_check_ / qa_intercept_ tools in src/tools/qa/monitoring.ts (query current captured). Registered + help updated. 6 new tests using route/evaluate for hermetic sim (now 120 total). All checks green. Passive, no active intercept needed.
- ✅ 2026-06-??: Completed Phase 4 (Wait Tools). Added waitForAcrossFrames helper + 3 browser_wait_* tools (default 10s, max 30s, return elapsed for QA reports). Reuses cross-frame text resolver. Registered in index, listed in /help. New browser-wait.test.ts (6 tests: appear/timeout/hidden/text/network + elapsed). 126 tests, clean build/typecheck. No flakiness primitives before; now agent can do nav → wait → assert reliably.
