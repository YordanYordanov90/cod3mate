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

The agent loop owns all model reasoning and tool orchestration.

Required loop constraints:

- Maximum tool iterations per user message defaults to `8`.
- Each tool has an independent timeout.
- Tool outputs are truncated to a configured max character count.
- Every external input is validated before it enters agent state.
- All model-visible tool output is sanitized.
- The loop returns a graceful error message if limits are reached.

Pseudo-flow:

```text
receive Telegram update
authorize sender
load session history
build model input with SOUL.md
call OpenAI
if final response: send to Telegram
if tool calls: validate, execute, sanitize, append observations
repeat until final response or limit
persist session
```

## Storage Model

- **Railway environment variables**: API keys, Telegram token, owner user ID, model names, and search API settings.
- **`/data/SOUL.md`**: persistent personality, rules, and high-level operating preferences.
- **`/data/sessions/`**: serialized per-chat conversation history and selected model state.
- **`/data/logs/`**: optional sanitized operational logs if file logging is enabled.
- **`/tmp/agent-files/`**: temporary file-tool workspace. Files here are disposable and may be cleared.

Task summaries are not persisted in this version. They are produced as Telegram messages only.

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
- `MAX_TOOL_OUTPUT_CHARS`, default `12000`
- `TELEGRAM_CHUNK_SIZE`, default `3500`
- `LOG_LEVEL`, default `info`
- `ENABLE_FILE_LOGS`, default `false`

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

Initial tools:

- `browser_navigate`
- `browser_click`
- `browser_fill`
- `browser_screenshot`
- `browser_extract_text`
- `terminal_exec`
- `file_read`
- `file_write`
- `web_search`

## Task Summary Architecture

Task summaries are a Telegram-only output. They are not persisted in this version.

Summary flow:

1. Agent finishes a task.
2. Summary module builds a Telegram-friendly message from the final answer, tools used, and any caveats.
3. Summary passes through credential sanitization.
4. Telegram formatter chunks the message if needed and sends it to the owner.

Summary should include:

- Short task title or topic.
- One-paragraph result.
- Tools used during the task.
- Any important caveats or failed steps.
- Recommended next steps when relevant.

Persisted reports to GitHub, databases, or object storage are explicitly out of scope for this version. If reintroduced later, this section and `progress-tracker.md` must be updated first.

## Deployment Architecture

Railway runs one Dockerized service:

- Build stage installs dependencies and compiles TypeScript.
- Runtime stage includes Node.js and Playwright Chromium dependencies.
- The service starts with `node dist/index.js`.
- Railway volume is mounted at `/data`.
- Health check endpoint may be added if webhook mode or Railway checks require HTTP.

Polling mode is acceptable for the first deployment because it avoids a public webhook setup. Webhook mode can be added later if needed.

## Invariants

1. No Telegram update from a non-whitelisted user may reach the agent loop or tool registry.
2. No secret value from environment variables may be sent to OpenAI, Telegram, logs, task summaries, or session history.
3. File tool operations must stay inside the configured temporary directory.
4. Terminal execution must be bounded by timeout, output length, and command policy.
5. `SOUL.md` is instruction context only; it must not override security, tool, or access-control rules.
6. Tool outputs must be sanitized before being stored or sent to the model.
7. Task summaries are Telegram-only in this version and must not be written to files or external services.
8. Model IDs must be configurable through environment variables rather than hardcoded into business logic.
9. Browser resources must be reused or closed cleanly to avoid memory leaks in the Railway container.
10. Implementation must remain deployable from a clean clone with environment variables and a mounted `/data` volume.
