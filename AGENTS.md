# AGENTS.md — cod3mate

Private, single-owner Telegram AI agent on Railway. Owner messages a GrammY bot → whitelist check → OpenAI multi-round tool loop → tools (browser, terminal, file, search, QA) → sanitized output → chunked Telegram reply.

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
2. **Zero secret leakage in outputs.** API keys, tokens, and env secrets must not appear in Telegram messages, logs, task summaries, tool results, or session history. Use `src/security/sanitize.ts`. **Exception (browser QA only):** when `TEST_ACCOUNT_*` or `TEST_CREDENTIALS_<APP>_*` are set, those throwaway test-account values are injected into the **system prompt only** (never from chat) so the model can run `browser_fill` login flows; all values are sanitizer-registered and must never be echoed in replies.
3. **File sandbox.** File tools must stay inside `TMP_DIR`. Use `resolveSafePath` with the `root + path.sep` prefix check (not bare `startsWith`).
4. **Terminal sandbox.** Bounded by allowlist, timeout, max output, cwd containment (same `path.sep` check), and sanitized child env. `npx` is restricted to known QA runners; `git config` is blocked.
5. **SOUL.md is instruction only.** Never overrides security/tool/access rules. Security rules sit **above** SOUL in the system prompt.
6. **Tool output sanitization.** Every tool result passes through `sanitizeToolResult` before reaching the model or Telegram.
7. **Task responses are Telegram-only** for the main answer (merged message + optional QA report follow-up). QA reports persist under `/data/qa-reports/`; no GitHub or external report services in v1.
8. **Environment-driven models.** Model IDs from `OPENAI_PRIMARY_MODEL` / `OPENAI_FALLBACK_MODEL`, never hardcoded.
9. **Browser lifecycle.** One shared Chromium instance and a **persistent tab/context** across tool calls within a process (multi-step QA). Call `browser_reset` for a clean session. Full browser shutdown on graceful exit.
10. **Clean-clone deployable.** Must work from a clean clone with env vars + mounted `/data`.

## Security Rules

- All redaction centralized in `src/security/sanitize.ts`.
- Patterns cover: env values, `sk-*` OpenAI keys, `tvly-*` Tavily keys, Telegram bot tokens, common credential shapes.
- Sanitization scope: logs, errors, tool outputs, Telegram responses, task summaries, model observations.
- Never commit `.env`. Never pass secrets into tool child processes unless output is fully sanitized.
- Treat all external data as untrusted: Telegram updates, model outputs, tool inputs, search results, file contents, terminal output.
- **Do not** accept test passwords from Telegram chat — only env-configured test credentials.

## Environment Variables

**Required:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID` (int), `OPENAI_API_KEY`, `OPENAI_PRIMARY_MODEL`, `OPENAI_FALLBACK_MODEL`, `TAVILY_API_KEY`

**Optional (defaults):** `DATA_DIR` (`/data`), `TMP_DIR` (`/tmp/agent-files`), `MAX_AGENT_ITERATIONS` (`8` — chat default), `QA_MAX_ITERATIONS` (`25` — `/qa-test`), `MAX_TOOL_OUTPUT_CHARS` (`12000`), `TELEGRAM_CHUNK_SIZE` (`3500`), `LOG_LEVEL` (`info`), `ENABLE_FILE_LOGS` (`false`), `TAVILY_SEARCH_ENDPOINT` (`https://api.tavily.com/search`), plus legacy `TEST_ACCOUNT_EMAIL`/`_PASSWORD` and Phase 8 `TEST_CREDENTIALS_<APP>_*` pairs (sanitized + system-prompt-injected per app).

## Registered Tools (~26)

Registered at startup in `src/index.ts` (see startup log for exact count).

| Category | Tools | Sandbox / notes |
| --- | --- | --- |
| Files | `file_read`, `file_write` | `TMP_DIR` + `resolveSafePath` |
| Terminal | `terminal_exec` | Allowlist + `resolveSafeCwd` + guards on `git` / `curl` / `npx` |
| Search | `web_search` | Tavily; key never in result |
| Browser | `browser_navigate`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_extract_text`, `browser_inspect_form`, `browser_reset`, `browser_wait_for`, `browser_wait_for_network_idle`, `browser_wait_for_text`, `browser_set_viewport` | Persistent tab; cross-frame; screenshots under `TMP_DIR/screenshots/` |
| QA assertions | `qa_assert_visible`, `qa_assert_not_visible`, `qa_assert_text_contains`, `qa_assert_url`, `qa_assert_element_count`, `qa_assert_status` | Structured pass/fail; feed QA report collector |
| QA observe | `qa_check_console_errors`, `qa_check_network_failures`, `qa_intercept_api` | Passive capture since last navigate/reset |
| QA other | `qa_accessibility_audit`, `qa_save_scenario` | axe-core; persist scenarios to `/data/qa-scenarios/` |

## Terminal Allowlist

Base commands: `pwd`, `ls`, `echo`, `date`, `node`, `npm`, `npx`, `which`, `cat`, `head`, `tail`, `wc`, `find`, `grep`, `curl`, `git`.

- **curl:** GET/HEAD/OPTIONS only; no `-d`, `-F`, `-o`, POST, etc.
- **git:** read-only subcommands only (`status`, `log`, `diff`, …); **no** `config`, `push`, `clone`, `commit`, `reset`, `checkout`, `fetch`, …
- **npx:** `vitest`, `playwright`, `@playwright/test`, `typescript`/`tsc`, `eslint`, `tsx`, `prettier`, and `--version` only; no `-y` / arbitrary packages.

Expand only by updating `src/tools/terminal/mod.ts`, adding tests, and noting in the tracker.

## Telegram QA Commands

| Command | Purpose |
| --- | --- |
| `/qa-test` | LLM-driven QA with `QA_MAX_ITERATIONS`, browser reset, auto report on assertions |
| `/qa-run <name>` | Execute saved scenario (no LLM for steps) |
| `/qa-scenarios` | List saved scenarios |
| `/qa-history` | List recent QA reports |
| `/qa-report <id>` | Full saved report by id |

## Current Status

- **Milestones 1–8 complete.** Foundation through Railway deployment; bot live for whitelisted owner.
- **QA Agent Roadmap (Phases 1–10) complete.** Assertions, reports, monitoring, waits, `/qa-test`, terminal expansion, scenarios, multi-app creds, viewport, a11y. See `context/improvements/qa-agent-roadmap.md`.
- **150+ Vitest tests** (browser integration tests require `npx playwright install`).

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
- `context/improvements/qa-agent-roadmap.md` — QA feature phases and exit criteria
