# AI Workflow Rules

## Approach

Build this project incrementally using the context files as the source of truth. The project starts with planning, then moves through foundation, Telegram access control, OpenAI agent loop, tools, Telegram task summaries, and Railway deployment. Each implementation unit should be small enough to verify with tests or a manual smoke check before moving forward.

## Operating Rules

- Read the relevant context files before implementing a feature.
- Update context files when the implementation changes architecture, scope, storage, security rules, or workflow.
- Prefer one complete vertical slice over several half-built subsystems.
- Keep security constraints active from the first implementation step.
- Treat all external data as untrusted.
- Do not add model providers, databases, dashboards, or multi-user support unless the context files are updated first.

## Scoping Rules

- Work on one feature unit at a time.
- Prefer small, verifiable increments over broad speculative changes.
- Do not combine unrelated system boundaries in one implementation step.
- Every unit should end with one of:
  - passing tests
  - a build check
  - a manual smoke test
  - a documented blocker in `progress-tracker.md`

## Implementation Sequence

### Phase 1: Project Foundation

1. Initialize TypeScript Node.js project.
2. Add linting, formatting, build, and test scripts.
3. Install core dependencies:
   - `typescript`
   - `tsx`
   - `vitest`
   - `grammy`
   - `openai`
   - `zod`
   - `playwright`
4. Add folder structure from `architecture.md`.
5. Add validated environment configuration.
6. Add `.env.example`.
7. Add basic health startup logging with sanitized output.

Exit criteria:

- `npm run build` passes.
- `npm test` runs.
- Missing required env vars fail with clear safe messages.

### Phase 2: Telegram Shell

1. Create GrammY bot.
2. Add owner whitelist middleware.
3. Add `/start`, `/help`, `/status`, `/reset`, and `/model` command shells. There is no `/report` command in this version.
4. Add Telegram message chunking and safe formatting.
5. Add tests for whitelist and chunking.

Exit criteria:

- Non-owner updates are blocked before handlers.
- Owner can receive command responses.
- Long messages are chunked safely.

### Phase 3: SOUL.md and Sessions

1. Implement `/data` directory resolution.
2. Load `/data/SOUL.md` at startup.
3. Create default `SOUL.md` if missing, if this behavior is accepted.
4. Add per-chat session persistence under `/data/sessions`.
5. Add `/reset` implementation.
6. Test SOUL loading and session persistence.

Exit criteria:

- The app starts with an existing `SOUL.md`.
- Session history can be loaded, saved, and reset.

### Phase 4: OpenAI Agent Loop

1. Create OpenAI client wrapper.
2. Build system prompt with security instructions and `SOUL.md`.
3. Implement conversation history management.
4. Implement model selection and `/model` switching.
5. Add fallback model behavior.
6. Implement agent loop without tools first.
7. Add mocked OpenAI tests.

Exit criteria:

- Owner messages receive OpenAI responses.
- `/model` can inspect and switch configured models.
- Fallback behavior is tested with mocked failures.

### Phase 5: Tool Registry

1. Define shared tool interface.
2. Add registry lookup and schema validation.
3. Add tool result normalization.
4. Add tool timeout and output truncation wrapper.
5. Add credential sanitization before results return to the agent.
6. Add tests for invalid tool names, invalid input, and sanitized output.

Exit criteria:

- The model can request a registered tool.
- Invalid tool calls fail safely.
- Tool observations are sanitized.

### Phase 6: File and Terminal Tools

1. Implement file read/write under `/tmp/agent-files`.
2. Add path traversal protection.
3. Implement constrained terminal execution.
4. Add the approved terminal command allowlist, timeout, and max output length.
5. Add tests for safe and unsafe paths.
6. Add tests for command policy and sanitization.

Exit criteria:

- File tool can read/write safe temp files.
- Unsafe paths are rejected.
- Terminal output is bounded and sanitized.

### Phase 7: Browser Tool

1. Add Playwright browser lifecycle manager.
2. Implement navigation.
3. Implement click and fill.
4. Implement visible text extraction.
5. Implement screenshots under `/tmp/agent-files/screenshots`.
6. Add browser smoke test where environment supports Chromium.

Exit criteria:

- Browser can open a page, extract text, and take a screenshot.
- Browser resources close cleanly.

### Phase 8: Web Search Tool

1. Configure Tavily as the direct search API.
2. Implement Tavily search client.
3. Normalize search results.
4. Add error handling for missing keys, rate limits, and failed responses.
5. Add mocked API tests.

Exit criteria:

- Agent can call search and receive normalized source-backed results.
- No OpenRouter dependency exists.

### Phase 9: Telegram Task Response

Initial implementation produced a separate "Working on it..." preamble, the answer, and a structured `Done.` / `Done with issues.` summary. Mobile testing during M8 showed this read as a duplicate reply (the summary repeated the answer paragraph). Phase 9 was therefore consolidated:

1. Each completed task produces **one merged Telegram message**: the agent's answer plus an optional `—` footer (`Tools: ...`, `Failed: ...`, fallback notice, iteration-limit notice).
2. Build the merged message in the Telegram message handler. The agent runner stays Telegram-agnostic.
3. Run the merged message through `sanitizeString` before delivery and chunk it with `TELEGRAM_CHUNK_SIZE`.
4. The structured `buildTaskSummary` from `src/summary/mod.ts` is retained for potential future reuse (digests, alternative channels) but is no longer wired into the bot.

Exit criteria:

- After a completed task, the owner receives exactly one Telegram message describing the result, with the footer surfacing only the metadata that adds value.
- No files are written and no external services are called.
- Long messages are chunked safely.

Out of scope: GitHub persistence, Markdown report files, `/report` command, and any persisted report archive.

### Phase 10: Railway Deployment

1. Add Dockerfile with Playwright and Chromium dependencies.
2. Add `.dockerignore`.
3. Add Railway deployment notes.
4. Verify production build starts with required environment variables.
5. Document Railway volume mount at `/data`.
6. Decide polling vs webhook for first deployment.

Exit criteria:

- Docker image builds.
- Service starts in production mode.
- Deployment instructions are complete.

## When to Split Work

Split an implementation step if it combines:

- Telegram access control and OpenAI agent reasoning.
- OpenAI integration and tool implementation.
- Browser automation and terminal execution.
- Telegram task summary formatting and unrelated agent reasoning changes.
- Railway deployment and feature development.
- Storage model changes and unrelated command behavior.

If a change cannot be verified quickly, split it.

## Handling Missing Requirements

- Do not invent product behavior not defined in the context files.
- If a requirement is ambiguous, add it to `progress-tracker.md` under Open Questions.
- If model IDs are uncertain, keep them environment-driven and document the expected display names.
- Use Tavily for web search unless the context files are explicitly updated.
- If terminal command policy is too restrictive for a real use case, update `architecture.md` and tests before expanding it.

## Protected Files

Do not modify these unless explicitly instructed or the context requires an update:

- `.env`
- `/data/SOUL.md`
- `/data/sessions/*`
- generated screenshots containing private information
- third-party library internals

## Keeping Docs in Sync

Update the relevant context file whenever implementation changes:

- System boundaries or folder ownership.
- Security invariants.
- Environment variable requirements.
- Tool behavior.
- Storage model.
- Deployment flow.
- Current phase and completed work.

## Before Moving to the Next Unit

1. The current unit works end to end within its defined scope.
2. No invariant in `architecture.md` was violated.
3. `progress-tracker.md` reflects completed and next work.
4. Tests relevant to the unit pass.
5. `npm run build` passes once the TypeScript project exists.
