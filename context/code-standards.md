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
- Keep OpenAI client creation in `src/agent/openai-client.ts` or equivalent.
- Do not hardcode final model IDs in business logic; read them from validated config.
- System prompt construction must be centralized and testable.
- `SOUL.md` is injected as part of system instructions on every request.
- Security rules must be placed above personality guidance in the system prompt.
- Implement model fallback for recoverable model/API failures only.
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

## Task Summary

- Task summaries are produced as plain Telegram messages, not files.
- Keep the summary builder in `src/summary/` and free of Telegram client coupling; it returns text only.
- The summary must include: short title, one-paragraph result, tools used, caveats, and recommended next steps when relevant.
- Run summaries through credential sanitization before sending.
- Use the standard Telegram chunking utility for long summaries.
- Do not write summaries to disk, GitHub, or any external service in this version.

## Security

- Centralize redaction in `src/security/sanitize.ts`.
- Build redaction patterns from:
  - environment variable values
  - common API key patterns
  - Telegram bot token shape
  - OpenAI key shape
- Sanitization must run on:
  - logs
  - errors
  - tool outputs
  - Telegram task summaries
  - Telegram responses
  - model-visible observations
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
