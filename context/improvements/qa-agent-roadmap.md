# QA Agent Roadmap v2 — Harness Improvements

Phases 1–10 of the original QA roadmap are complete (assertions, reports, monitoring, waits, `/qa-test`, terminal expansion, scenarios, multi-app creds, viewport, a11y). This v2 roadmap captures the next round of improvements, inspired by minimal agent harnesses like [Pi](https://pi.dev/): better context engineering, lower token cost, and a better owner experience during long QA runs.

All work must preserve the existing invariants in `AGENTS.md` and `context/architecture.md` (owner-only access, sanitization, sandboxes, Telegram-only responses).

## Status Legend

- ⬜ Not started
- 🟡 In progress
- ✅ Done

---

## Phase 1: Context Compaction

**Goal:** Keep long `/qa-test` runs (up to `QA_MAX_ITERATIONS` = 25 model calls, tool outputs up to `MAX_TOOL_OUTPUT_CHARS` = 12k chars each) from blowing up the context window, degrading model quality, and inflating cost.

**Status:** ✅

### What to build

- A compaction step inside the agent loop (`src/agent/runner.ts`):
  - When accumulated conversation history exceeds a configurable threshold (e.g. `AGENT_COMPACTION_THRESHOLD_CHARS`), summarize the **older** tool results and assistant turns into a single compact "progress so far" assistant message.
  - Always preserve: the system prompt, the original user task, the most recent N exchanges, and all assertion results (pass/fail entries must never be lost — the QA report collector already holds them independently).
  - The summary itself must pass through `sanitizeString` before entering history.
- New optional env vars with safe defaults: `AGENT_COMPACTION_THRESHOLD_CHARS`, `AGENT_COMPACTION_KEEP_RECENT` (number of recent messages kept verbatim).
- Compaction may use the active model with a small, fixed summarization prompt; on failure, fall back to simple truncation of oldest tool outputs (never fail the run).

### Exit criteria

- A 25-iteration QA run with large tool outputs stays under the threshold after compaction.
- Assertion results and final report are unaffected by compaction.
- Tests cover: threshold trigger, recent-message preservation, sanitization of summaries, fallback truncation path.
- `npm run build && npm run test:run && npm run typecheck` all pass.

---

## Phase 2: Mode-Scoped Tool Exposure (Progressive Disclosure)

**Goal:** Stop sending all ~26 tool definitions on every model call. Normal chat rarely needs `qa_assert_element_count` or `qa_intercept_api`. Scoping tools by mode reduces token cost and improves model tool selection.

**Status:** ✅

### What to build

- Introduce tool sets in the registry (`src/tools/registry.ts`):
  - **chat** set: core tools (`file_read`, `file_write`, `terminal_exec`, `web_search`, basic browser tools).
  - **qa** set: everything in chat **plus** all `qa_*` tools, waits, viewport, and `qa_accessibility_audit`.
- The agent loop selects the tool set based on run mode (`/qa-test` and `/qa-run` → qa set; normal messages → chat set).
- Keep registration in `src/index.ts` unchanged — scoping happens at request-build time, not at registration.
- Optional escape hatch: a config flag to always expose the full set (for debugging).

### Exit criteria

- Normal chat requests include only the chat tool set; `/qa-test` includes the full set.
- No tool becomes unreachable in its intended mode (test both directions).
- Startup log still reports the full registered count.
- Tests cover set membership, mode selection, and the escape hatch.

---

## Phase 3: Mid-Run Steering

**Goal:** Let the owner influence a running QA task instead of waiting for up to 25 iterations. A Telegram message sent during a run becomes a steering instruction injected before the next model call (e.g. "skip the login test, check the dashboard instead").

**Status:** ✅

### What to build

- A per-chat pending-steering queue:
  - While an agent run is active for a chat, incoming non-command owner messages are captured as steering messages instead of starting a new run.
  - Before each loop iteration, drain the queue and append the steering text as a user message (sanitized, validated as plain text).
- Acknowledge receipt in Telegram ("Steering noted — applying on the next step.").
- A way to cancel: `/stop` (or steering text "stop") ends the run gracefully after the current tool finishes, returning a partial report.
- Owner-only as always — steering goes through the same whitelist middleware.

### Exit criteria

- A message sent mid-run is injected before the next model call and visibly changes agent behavior.
- `/stop` terminates the loop after the in-flight tool call, with a partial answer/report.
- Concurrent-run edge cases tested: steering with no active run falls through to a normal message.
- No security invariant weakened (chat-supplied credentials still refused).

---

## Phase 4: QA Run Transcript Export (Dashboard)

**Goal:** Extend the dashboard (see `context/dashboard.md`) to render the full transcript of a QA run — model reasoning, tool calls, tool results, and screenshots inline — not just the final report. The Pi `/share`/`/export` idea applied to QA.

**Status:** ✅

### What to build

- Persist a structured, sanitized run transcript alongside each QA report under `/data/qa-reports/` (or a sibling `/data/qa-transcripts/`):
  - Entries: model messages, tool calls (name + sanitized args), sanitized tool results (truncated), screenshot references to durable artifacts.
  - Every persisted string passes through the central sanitizer; transcripts are private artifacts like screenshots.
- Dashboard API: `GET /api/dashboard/reports/:id/transcript` (bearer-token auth, read-only, same containment rules as screenshots).
- Dashboard UI: a transcript view per report with inline screenshots.

### Exit criteria

- Each `/qa-test` run produces a persisted, sanitized transcript linked to its report id.
- Transcript is retrievable only through the authenticated dashboard API.
- No secrets or raw credentials appear in any persisted transcript (tests assert sanitizer coverage).
- Dashboard invariants 11–15 in `context/architecture.md` hold unchanged.

---

## Phase 5: Lightweight Rewind (`/rewind`)

**Goal:** A more surgical alternative to `/reset`: drop the last N exchanges from the chat session without wiping the whole conversation.

**Status:** ✅

### What to build

- `/rewind [n]` Telegram command (default `n = 1`):
  - Removes the last `n` user/assistant exchange pairs (including any tool messages belonging to them) from the persisted session in `/data/sessions/`.
  - Replies with a short confirmation of what was removed (message count, not content).
- Validate `n` with Zod (positive int, sane upper bound).
- No effect on QA reports or scenarios — session history only.

### Exit criteria

- `/rewind` removes exactly the intended exchanges and persists the trimmed session.
- Tool messages are never orphaned (an assistant tool-call message and its tool results are removed together).
- Edge cases tested: empty session, `n` larger than history, invalid input.
- `/help` documents the command.

---

## Phase 6: Per-Turn QA State Injection

**Goal:** During QA runs, inject a small live-state block before each model call (current URL, viewport, console error count, network failure count, assertions passed/failed so far) so the model stops wasting iterations re-orienting itself with `browser_extract_text`.

**Status:** ✅

### What to build

- A QA state snapshot helper that reads from already-available sources (no new browser actions):
  - Current page URL and viewport from the persistent Playwright page.
  - Passive console error / network failure counts from the existing capture buffers.
  - Running pass/fail tally from the QA report collector.
- Inject the snapshot as a compact, clearly delimited system/user message before each iteration **in QA mode only**; replace the previous snapshot rather than accumulating (keep history lean — this composes with Phase 1 compaction).
- Snapshot content is sanitized and size-capped.

### Exit criteria

- Each QA iteration sees an up-to-date state block; old snapshots do not accumulate in history.
- Measurably fewer redundant `browser_extract_text` / `qa_check_*` calls in a representative QA scenario.
- Normal chat mode is unaffected.
- Tests cover snapshot content, replacement behavior, sanitization, and size cap.

---

## Explicitly Not Adopted (from Pi)

Considered and rejected to keep the project focused:

- **Multi-provider support.** OpenAI direct, no gateways — per `AGENTS.md`. Abstraction cost not justified for a single-owner bot.
- **Extension/plugin system.** One owner, fixed toolset; a plugin architecture is accidental complexity.
- **No-sandbox philosophy.** Pi pushes safety to the environment; cod3mate keeps in-process sandboxing (file/terminal containment, sanitization). These invariants are non-negotiable.

## Suggested Order

1. Phase 1 (compaction) — highest impact on QA run reliability and cost.
2. Phase 2 (mode-scoped tools) — cheap token win, better tool selection.
3. Phase 3 (steering) — biggest owner-UX improvement.
4. Phase 6 (state injection) — composes with compaction; do after Phase 1.
5. Phase 5 (rewind) — small standalone quality-of-life command.
6. Phase 4 (transcript export) — depends on dashboard v1 milestones landing first.
