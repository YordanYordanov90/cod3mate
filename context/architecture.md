# Architecture Context

## Stack

| Layer | Technology | Role |
| --- | --- | --- |
| Runtime | Node.js + TypeScript | Application runtime and type-safe implementation |
| Telegram | GrammY | Telegram Bot API framework, middleware, commands, and message handling |
| AI | OpenAI SDK | Direct model calls, tool calling, streaming, and fallback model support |
| Validation | Zod | Runtime validation for env, Telegram commands, tool schemas, and external responses |
| Browser Automation | Playwright + Chromium | Browser navigation, interaction, screenshots, and page extraction |
| Web Search | Tavily API | Direct web search provider for source-backed search results |
| Task Summary | Telegram message | Plain Telegram message describing what was done after a task |
| Deployment | Docker + Railway | Containerized always-on service with persistent `/data` volume |
| Storage | Filesystem | `/data` for durable config/session data and `/tmp` for transient tool files |
| Testing | Vitest | Unit and integration tests for agent loop, tools, formatting, and sanitization |

## System Boundaries

- `src/index.ts` — application entrypoint, startup validation, bot launch, and graceful shutdown.
- `src/config/` — environment parsing, model configuration, feature flags, and safe defaults.
- `src/telegram/` — GrammY bot setup, middleware, commands, message formatting, streaming/chunking, and Telegram-specific error handling.
- `src/agent/` — agent loop, OpenAI request construction, model fallback, tool-call orchestration, and conversation history integration.
- `src/soul/` — loading, validating, and formatting `/data/SOUL.md` for system prompt injection.
- `src/tools/` — tool registry, shared tool types, Zod schemas, and tool implementations.
- `src/tools/browser/` — Playwright browser lifecycle and browser actions.
- `src/tools/terminal/` — constrained command execution, timeouts, output capture, and command policy.
- `src/tools/files/` — safe `/tmp` file reads and writes.
- `src/tools/search/` — direct web search API client and normalized result formatting.
- `src/summary/` — Telegram task summary builder used after a completed agent task.
- `src/security/` — credential sanitization, access control, redaction patterns, and safe logging helpers.
- `src/storage/` — `/data` session persistence and filesystem helpers.
- `src/lib/` — small shared utilities with no Telegram or OpenAI coupling.
- `tests/` — tests organized around the same boundaries as `src/`.

## Runtime Flow

1. `src/index.ts` loads environment variables through `src/config/env.ts`.
2. The app ensures `/data` exists and loads `/data/SOUL.md`.
3. The Telegram bot is created with owner whitelist middleware.
4. Commands are registered before the generic message handler.
5. For normal messages, `telegram/message-handler.ts` creates an agent request.
6. `agent/runner.ts` builds the system prompt from base rules, `SOUL.md`, model policy, and tool instructions.
7. The OpenAI client receives conversation history and tool definitions.
8. Tool calls are routed through `tools/registry.ts`.
9. Tool inputs and outputs are validated and sanitized.
10. The loop continues until the model returns a final answer or a max-iteration guard is reached.
11. Telegram formatting utilities stream or chunk the final answer.
12. Session history is persisted to `/data/sessions`.

## Agent Loop

The agent loop owns all model reasoning and tool orchestration. It is a true **multi-round** loop, not a single tool batch + final call.

Required loop constraints:

- Maximum tool iterations per user message is sourced from `MAX_AGENT_ITERATIONS` (default `8`) for normal chat, or `QA_MAX_ITERATIONS` (default `25`) for `/qa-test`. One iteration = one model call.
- Each tool has an independent timeout.
- Tool outputs are truncated to `MAX_TOOL_OUTPUT_CHARS`.
- Every external input is validated before it enters agent state.
- All model-visible tool output is sanitized.
- Fallback to `OPENAI_FALLBACK_MODEL` is only attempted on the **first** model call. After any tool result is in the conversation, the active model is locked for the remainder of the loop.
- When the iteration limit is reached, the loop returns whatever content is available (or a graceful "limit reached" message if none) plus `iterationLimitHit: true` so the bot can surface the cause.

Pseudo-flow:

```text
receive Telegram update
authorize sender
load session history
build model input with security rules + optional test creds + SOUL.md
for iter in 0..maxIterations:
  call OpenAI on the active model
  if no tool_calls: return final content
  append assistant message with tool_calls
  for each tool_call:
    validate input (Zod), execute with timeout + max output, sanitize result, append as tool message
return last content with iterationLimitHit = true
persist session
```

## Storage Model

- **Railway environment variables**: API keys, Telegram token, owner user ID, model names, and search API settings.
- **`/data/SOUL.md`**: persistent personality, rules, and high-level operating preferences.
- **`/data/sessions/`**: serialized per-chat conversation history and selected model state.
- **`/data/logs/`**: optional sanitized operational logs if file logging is enabled.
- **`/tmp/agent-files/`**: temporary file-tool workspace. Files here are disposable and may be cleared.
- **`/data/qa-reports/`**: persisted structured QA reports (JSON) when `qa_assert_*` tools run.
- **`/data/qa-scenarios/`**: reusable test scenario JSON files for `/qa-run`.
- **`/data/qa-artifacts/screenshots/`**: durable, report-scoped QA screenshots for the dashboard (private artifacts; planned in `context/dashboard.md` Milestone 3). Distinct from the transient `/tmp/agent-files/screenshots/` workspace.

Task summaries for normal chat are not persisted as files; the bot sends a merged Telegram message. QA reports are an exception and persist under `/data/qa-reports/`.

## Auth and Access Model

- Telegram access is controlled by `TELEGRAM_ALLOWED_USER_ID`.
- The bot must reject all updates from any other Telegram user before command handling, agent execution, or tool execution.
- Group chats are disabled by default. If group support is ever added, access must still require the whitelisted user and explicit command mention.
- OpenAI, Telegram, and search API keys are never stored in files, conversation history, or `SOUL.md`.

## Configuration

Required environment variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `OPENAI_API_KEY`
- `OPENAI_PRIMARY_MODEL`
- `OPENAI_FALLBACK_MODEL`
- `TAVILY_API_KEY`

Optional environment variables:

- `TAVILY_SEARCH_ENDPOINT`, default `https://api.tavily.com/search`
- `DATA_DIR`, default `/data`
- `TMP_DIR`, default `/tmp/agent-files`
- `MAX_AGENT_ITERATIONS`, default `8`
- `QA_MAX_ITERATIONS`, default `25` (used by `/qa-test`)
- `MAX_TOOL_OUTPUT_CHARS`, default `12000`
- `TELEGRAM_CHUNK_SIZE`, default `3500`
- `LOG_LEVEL`, default `info`
- `ENABLE_FILE_LOGS`, default `false`
- `TEST_ACCOUNT_EMAIL` and `TEST_ACCOUNT_PASSWORD` — optional legacy pair.
- `TEST_CREDENTIALS_<APP>_EMAIL` / `TEST_CREDENTIALS_<APP>_PASSWORD` — optional per-app pairs (e.g. `CLOUDCASTAI`).
- When set, complete credential sets are injected into the **system prompt only** (elevated block above SOUL) for `browser_fill` login flows. Values are sanitizer-registered and must never appear in Telegram, logs, or tool output. **Chat-supplied credentials are refused.** This is an intentional tradeoff for automated QA; API keys and production secrets must never use this mechanism.

Model defaults:

- Primary model: `gpt-5.4-nano` (display name: GPT-5.4 Nano).
- Fallback model: `gpt-5-mini` (display name: GPT-5 Mini).
- Model identifiers must be environment-driven because exact API model IDs can change.

Web search defaults:

- Tavily is the selected direct web search provider.
- The implementation should use `TAVILY_API_KEY` and default to Tavily's search endpoint unless `TAVILY_SEARCH_ENDPOINT` is set.
- Tavily responses must be normalized before being returned to the agent.

Terminal policy:

- Terminal execution requires an explicit command allowlist before Phase 6 begins.
- The initial implementation must fail closed if the allowlist is missing or empty.
- The allowlist should be documented in config and covered by tests before `terminal_exec` is enabled.

## Tool Registry

Each tool definition must include:

- Stable tool name.
- Human-readable description for model tool selection.
- Zod input schema.
- Zod output schema or normalized output type.
- Timeout.
- Execution function.
- Sanitization policy.

Core tools (M6): `file_read`, `file_write`, `terminal_exec`, `web_search`, and browser actions (`browser_navigate`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_extract_text`, …).

QA extensions (see `src/tools/qa/` and `AGENTS.md`): assertion tools (`qa_assert_*`), network/console observation (`qa_check_*`, `qa_intercept_api`), `qa_accessibility_audit`, `qa_save_scenario`, plus browser wait/viewport helpers. Full list is registered in `src/index.ts`.

### Browser state model

- One lazy-launched Chromium process per service instance.
- One persistent `BrowserContext` + `Page` reused across tool calls so multi-step flows share DOM state.
- `browser_reset` closes context/page and clears passive network/console capture buffers.
- `closeBrowser()` on graceful shutdown.
- Cross-frame resolution for click/fill/assert on embedded auth widgets (Clerk, Auth0, etc.).

## Task Response Architecture

Each completed task produces **one merged Telegram message**: the agent's answer followed by an optional compact metadata footer. There is no separate "Working on it..." preamble and no separate "Done." / structured summary message — those were collapsed during M8 because the structured summary repeated the answer on mobile.

Response flow:

1. The bot receives a non-command message from the verified owner.
2. The agent loop runs (multi-round, bounded by `MAX_AGENT_ITERATIONS`).
3. The bot composes a single message containing:
   - An optional `(used fallback model: <id>)` line when the fallback model produced the answer.
   - The agent's final content.
   - An optional footer separated by `—`, containing any of:
     - `Tools: <comma-separated tools that succeeded>`
     - `Failed: <comma-separated tools that failed>`
     - `Stopped at iteration limit — break the task into smaller steps.` when `iterationLimitHit` is true.
4. The merged message passes through `sanitizeString` and is chunked with `TELEGRAM_CHUNK_SIZE`.

The full structured summary builder still lives in `src/summary/mod.ts` (with its 9 tests) but is no longer wired into the bot. It is retained as a reusable building block in case a future channel (digest, log, alternative renderer) needs it.

Persisted reports to GitHub, databases, or object storage remain out of scope. If reintroduced, update this section and `progress-tracker.md` first.

## Repository And Branch Layout

The codebase is intentionally split across two branches. Each branch maps to one production service; they are not required to share the same tree at every moment.

```text
main  ──────────────────────────►  Railway (Telegram agent + dashboard API)
  src/          agent, tools, telegram, storage, security
  src/dashboard/  read-only HTTP API for reports + screenshots
  (no apps/dashboard/)

feature/dashboard  ──────────────►  Vercel (Next.js QA dashboard)
  apps/dashboard/   Clerk UI, server-side Railway client, screenshot proxy
  package.json      npm workspaces + dashboard:* scripts
  (agent src/ may be behind main until git merge)
```

| Concern | Branch | Path |
| --- | --- | --- |
| Telegram bot, agent loop, tools | `main` | `src/` (except dashboard HTTP layer) |
| QA report + screenshot persistence | `main` | `/data` on Railway volume |
| Railway dashboard API | `main` | `src/dashboard/*` |
| Next.js dashboard UI | `feature/dashboard` | `apps/dashboard/*` |
| Shared planning docs | **both** (keep identical) | `context/` |

**Sync rules (summary):** agent and API changes land on `main` first; dashboard UI on `feature/dashboard`; merge `main` → `feature/dashboard` regularly for contract parity; keep `context/` the same on both branches. Full rules in `context/dashboard.md`.

## Deployment Architecture

Railway runs one Dockerized service (from `main`):

- Build stage installs dependencies and compiles TypeScript.
- Runtime stage includes Node.js and Playwright Chromium dependencies.
- The service starts with `node dist/index.js`.
- Railway volume is mounted at `/data`.
- Health check endpoint may be added if webhook mode or Railway checks require HTTP.

Polling mode is acceptable for the first deployment because it avoids a public webhook setup. Webhook mode can be added later if needed.

Vercel hosts the Next.js dashboard (from `feature/dashboard`, Root Directory `apps/dashboard`). It has no access to the Railway volume; all QA data is fetched server-side over HTTPS to the Railway dashboard API.

## Dashboard Architecture (v1)

A private, read-only dashboard lets the owner inspect QA reports and screenshots in a web UI. Full plan, milestones, and interface contracts live in `context/dashboard.md`. This section captures the system relationship.

```text
Telegram owner
  -> Railway agent service
     - GrammY bot (unchanged)
     - OpenAI tool loop (unchanged)
     - QA reports + durable screenshots under /data
     - private dashboard HTTP API (bearer-token auth)

Vercel Next.js dashboard
  - Clerk auth (any signed-in user; all reports shown)
  - shadcn/ui, Zod validation
  - server-side calls to the Railway dashboard API
```

Key points:

- Railway stays the source of truth for real QA reports and screenshots because that data already lives on the Railway `/data` volume. Vercel cannot read that volume directly, so the dashboard reads through the authenticated Railway API.
- The Railway dashboard API is an HTTP layer (Node built-in `http`) added **alongside** Telegram long-polling; the bot keeps polling unchanged. It is started only when `DASHBOARD_API_ENABLED` is true and requires bearer-token auth on all dashboard routes.
- The Next.js dashboard talks to Railway **server-side only**. `DASHBOARD_API_TOKEN` must never be exposed to the browser.
- Screenshots are served through the authenticated API with safe path resolution and containment (resolved root + `path.sep`), never as public static files.

Planned Railway dashboard API (read-only):

- `GET /health`
- `GET /api/dashboard/health`
- `GET /api/dashboard/projects`
- `GET /api/dashboard/reports?project=&limit=&cursor=`
- `GET /api/dashboard/reports/:id`
- `GET /api/dashboard/reports/:id/screenshots`
- `GET /api/dashboard/screenshots/:reportId/:filename`

Planned backend env:

- `DASHBOARD_API_ENABLED`
- `DASHBOARD_API_TOKEN`
- `DASHBOARD_API_PORT` or Railway `PORT`

Planned dashboard (Vercel) env:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `DASHBOARD_API_BASE_URL`
- `DASHBOARD_API_TOKEN`

A future portfolio/demo chat is out of scope for dashboard v1 and must use a separate surface with demo-safe storage and stricter tool limits.

## Invariants

1. No Telegram update from a non-whitelisted user may reach the agent loop or tool registry.
2. No secret value from environment variables may appear in Telegram, logs, task summaries, tool results, or session history. **Exception:** throwaway test-account email/password env vars may be included in the OpenAI system prompt only (never from chat); they remain sanitizer-redacted everywhere else.
3. File tool operations must stay inside the configured temporary directory.
4. Terminal execution must be bounded by timeout, output length, and command policy.
5. `SOUL.md` is instruction context only; it must not override security, tool, or access-control rules.
6. Tool outputs must be sanitized before being stored or sent to the model.
7. Task responses are Telegram-only in this version and must not be written to files or external services. Each completed task delivers exactly one merged message (answer + optional metadata footer).
8. Model IDs must be configurable through environment variables rather than hardcoded into business logic.
9. Browser resources use a persistent tab within one Chromium instance; reset or shutdown must not leak memory on Railway.
10. Implementation must remain deployable from a clean clone with environment variables and a mounted `/data` volume.

### Dashboard invariants (v1)

These extend, and never weaken, the invariants above.

11. The dashboard is a public portfolio: the Vercel frontend is Clerk-protected (any signed-in user may view all reports; no owner allowlist or per-project curation), and the Railway dashboard API requires a server-to-server bearer token on every dashboard route.
12. `DASHBOARD_API_TOKEN` is server-side only and must never be exposed to the browser or any client component.
13. QA screenshots are private artifacts. They are served only through the authenticated API with safe path resolution and containment (resolved root + `path.sep`), never as public static files.
14. The dashboard is read-only in v1: no dashboard-triggered agent runs and no terminal, file, browser, or OpenAI tool execution from the dashboard.
15. Dashboard API responses are sanitized before returning data, and the dashboard API must not weaken Telegram owner-only access or any existing invariant.
