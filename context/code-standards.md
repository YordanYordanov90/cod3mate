# Code Standards

## General

- Keep modules small and focused on one system boundary.
- Prefer explicit, boring code over clever abstractions.
- Validate unknown input at the edge before it enters application logic.
- Treat Telegram updates, model outputs, tool inputs, web search results, file contents, and terminal output as untrusted.
- Never log raw request bodies, environment variables, tool outputs, or credentials.
- Make failures actionable: include safe context, not secret values.
- Keep feature work incremental and covered by tests where behavior matters.

## TypeScript

- Use strict TypeScript settings.
- Avoid `any`; use `unknown` at boundaries and narrow with Zod or type guards.
- Export types from the module that owns the behavior.
- Prefer discriminated unions for tool results and agent loop states.
- Use `async`/`await` consistently for asynchronous flow.
- Use `Result`-style return objects only where they simplify expected failure handling.
- Do not silently swallow errors; normalize them into safe error messages.

## Validation

- All environment variables must be parsed by a Zod schema at startup.
- Every Telegram command with arguments must validate those arguments.
- Every tool must validate input before execution.
- External API responses should be normalized before use.
- File paths must be resolved and checked against the allowed root before reading or writing.
- Model-selected tool names must be checked against the registry.

## OpenAI Integration

- Use the official OpenAI SDK directly.
- Keep OpenAI client creation in `src/agent/client.ts` or equivalent.
- Do not hardcode final model IDs in business logic; read them from validated config.
- System prompt construction must be centralized and testable. Order is non-negotiable: security rules → optional test-credentials block → SOUL.
- `SOUL.md` is injected as part of system instructions on every request.
- Security rules must be placed above personality guidance and above any test-credentials block in the system prompt.
- The agent runner is a true multi-round loop bounded by `MAX_AGENT_ITERATIONS`. Each iteration is one model call; tool results are appended and another iteration runs until the model returns a tool-free answer or the limit is hit.
- Implement model fallback for recoverable model/API failures only, and only on the first iteration. Once any tool result is in the conversation, the active model is locked.
- Preserve enough model error detail for debugging while redacting keys and sensitive payloads.

## GrammY and Telegram

- Register access-control middleware before all commands and message handlers.
- Keep Telegram formatting separate from agent reasoning.
- Respect Telegram message length limits by chunking long responses.
- Use MarkdownV2 or HTML formatting only through a formatter that escapes user and model content safely.
- Commands should be thin entrypoints that call services.
- Do not execute tools directly from Telegram handlers; route through the agent or a dedicated service.

## Tooling Standards

- Each tool lives in its own module or folder when it has multiple actions.
- Each tool exports:
  - `name`
  - `description`
  - `inputSchema`
  - `execute`
- Tool output must be normalized into a consistent shape:

```ts
type ToolResult =
  | { ok: true; content: string; metadata?: Record<string, unknown> }
  | { ok: false; error: string; metadata?: Record<string, unknown> };
```

- Tool outputs must pass through credential sanitization before returning to the agent.
- Tool execution must enforce timeouts.
- Tool execution must enforce max output length.
- Tool modules should not import Telegram code.

## Browser Tool

- Use Playwright Chromium.
- Prefer one browser instance with isolated pages or contexts per task.
- Close pages after task completion unless a session requires reuse.
- Screenshots should be saved under `/tmp/agent-files/screenshots`.
- Screenshot paths returned to the agent must be local safe paths, not raw binary content.
- Browser actions must validate selectors and URLs.
- Do not disable Chromium sandbox unless Railway runtime requires it and the reason is documented.

## Terminal Tool

- Terminal execution must be constrained.
- Commands must run with:
  - timeout
  - max output bytes
  - controlled working directory
  - sanitized environment
- Do not pass application secrets into the child process environment unless a specific command requires them and the output is fully sanitized.
- Reject obviously destructive commands unless an explicit allowlist is designed later.
- Prefer an allowlist for the initial version, such as `node --version`, `npm --version`, `pwd`, `ls`, and safe diagnostic commands.

## File Tool

- Read and write only under `TMP_DIR`, default `/tmp/agent-files`.
- Resolve real paths before access checks.
- Reject path traversal.
- Limit file size for reads and writes.
- Write text content by default.
- Binary support is out of scope for the initial version unless needed by screenshots.

## Web Search Tool

- Use Tavily as the direct search API.
- Read credentials from `TAVILY_API_KEY`.
- Allow `TAVILY_SEARCH_ENDPOINT` override for testing or provider-compatible deployments.
- Normalize results into title, URL, snippet, source, and timestamp when present.
- Include source URLs in model-visible output.
- Apply rate limit handling and safe error messages.
- Do not use OpenRouter.

## Task Response

- Each completed task produces exactly one merged Telegram message (answer + optional `—` footer with tools used, failures, and iteration-limit notice when applicable).
- Build the merged message inside the Telegram message handler (`src/telegram/bot.ts`), not in the agent runner — keep agent output free of Telegram-specific formatting.
- Run the merged message through `sanitizeString` before delivery and chunk with `TELEGRAM_CHUNK_SIZE`.
- The structured summary builder in `src/summary/mod.ts` is retained for potential future reuse (digests, alternative channels) but is not currently wired into the bot. Keep it free of Telegram client coupling so it stays reusable.
- Never include raw tool output, full logs, or secrets in the response.
- Do not write responses to disk, GitHub, or any external service in this version.

## Security

- Centralize redaction in `src/security/sanitize.ts`.
- Build redaction patterns from:
  - environment variable values registered via `registerSecret`
  - common API key patterns
  - Telegram bot token shape
  - OpenAI key shape
  - Tavily key shape
- Sanitization must run on:
  - logs
  - errors
  - tool outputs
  - Telegram responses (merged answer + footer)
  - model-visible observations
- Optional test credentials (`TEST_ACCOUNT_EMAIL` / `TEST_ACCOUNT_PASSWORD`):
  - Both values are registered with the sanitizer at startup so any accidental leak is redacted.
  - They are injected into the system prompt only, with strict no-echo rules.
  - They are never accepted from chat input or session history.
- Never write `.env` files into the repository.
- Provide `.env.example` with names only and safe placeholder values.

## Testing

- Use Vitest.
- Unit test:
  - env validation
  - access control decisions
  - prompt construction
  - model selection
  - tool registry validation
  - path safety
  - credential sanitization
  - Telegram chunking
  - task summary construction
- Integration test:
  - agent loop with mocked OpenAI tool calls
  - end-to-end Telegram task summary delivery with a mocked Telegram client
  - browser tool smoke test where CI/runtime supports it

## File Organization

- `src/index.ts` — bootstraps the service.
- `src/config/` — env and app configuration.
- `src/telegram/` — bot, middleware, commands, and formatting.
- `src/agent/` — model calls, loop, prompt, and sessions.
- `src/tools/` — registry and tool implementations.
- `src/summary/` — Telegram task summary builder.
- `src/security/` — sanitization, access checks, and safe logging.
- `src/storage/` — `/data` and `/tmp` filesystem utilities.
- `src/lib/` — shared utilities.
- `tests/` — test files mirroring `src`.
- `context/` — project planning and implementation context.

## Protected Files

- `context/*.md` should be updated intentionally when requirements or architecture change.
- Generated Playwright browser binaries must not be committed.
- Runtime data under `/data` and `/tmp` must not be committed.
- Secrets, `.env`, session dumps, and screenshots with sensitive content must not be committed to the public project repository.
