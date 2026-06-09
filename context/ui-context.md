# UI Context

## Interface Surface

The primary interface is Telegram chat. All agent output should be designed for Telegram readability, command ergonomics, and message length constraints.

A second, private surface is now being added: a read-only QA dashboard (see `context/dashboard.md` and the "Dashboard UI" section below). The dashboard does not change Telegram behavior — it is a separate read-only viewer for QA reports and screenshots.

## Telegram Experience

The bot should feel like a private technical operator:

- concise for routine command responses
- focused on a single merged response per task (answer + compact footer)
- explicit about tool failures and safety limits
- calm when refusing access or rejecting unsafe operations
- readable on mobile Telegram clients

## Commands

| Command | Purpose | Response Style |
| --- | --- | --- |
| `/start` | Verify access and introduce the bot | short welcome and command list |
| `/help` | Show capabilities and limits | compact grouped list |
| `/status` | Show service status | short diagnostic summary |
| `/reset` | Clear conversation history | confirmation message |
| `/model` | Show or switch model | current model plus allowed options |

There is no `/report` command in this version. Each completed task is delivered as a single merged Telegram message: the answer plus an optional compact footer with tools used and any failures.

## Message Formatting

- Default to plain text unless Markdown formatting is needed.
- Escape content if Telegram MarkdownV2 or HTML mode is used.
- Avoid deeply nested lists because Telegram mobile rendering becomes noisy.
- Prefer short headings for long answers.
- Put critical status first, supporting details after.
- For tool results, summarize output instead of dumping long raw text.
- For task summaries, send a concise Telegram message describing what was done. Do not save to files or external services in this version.

## Telegram Length Limits

- Telegram messages have a hard length limit, so responses must be chunked.
- Use `TELEGRAM_CHUNK_SIZE`, default `3500`, to leave room for formatting overhead.
- Split on paragraph boundaries where possible.
- If paragraph splitting is not possible, split on sentence or word boundaries.
- Preserve code blocks only if they fit in one chunk.
- For very long outputs, prefer a tighter task summary with key details over many Telegram messages.

## Task Response Format

Each completed task produces **one merged Telegram message**. There is no "Working on it..." preamble and no separate `Done.` / summary message — those were collapsed because the summary repeated the answer on mobile and felt like a double reply.

Shape:

```text
[(used fallback model: <model-id>)]

<the agent's answer>

[—
Tools: <comma-separated successes>
Failed: <comma-separated failures>
Stopped at iteration limit — break the task into smaller steps.]
```

Rules:

- The fallback-model line appears only when the fallback was actually used.
- The footer block (everything below the `—` separator) appears only when there is something to report. With no tool use and no fallback, the message is just the answer.
- Successes and failures are listed by tool name. Browser/login flows therefore reveal which steps ran without exposing arguments or values.
- The iteration-limit line appears only when `iterationLimitHit` is true.
- Use plain text by default. Only switch to Markdown when it genuinely helps readability.
- Never include raw tool output, full logs, or secrets.
- The standalone summary builder in `src/summary/mod.ts` is no longer wired into the message handler but is retained for future reuse (digests, alternative renderers).

## Status Messages

While the agent is working on a normal message, the bot sends Telegram's native **typing** chat action (`sendChatAction: typing`), refreshed every 4 seconds until the reply is sent. This shows "typing..." in the chat header without adding extra messages.

The bot speaks through the merged response message itself, not through status preambles. Reserved status phrases that may still appear inside the answer or in error paths:

- `Stopped at iteration limit — break the task into smaller steps.` — surfaced in the footer when the agent exits the loop because `MAX_AGENT_ITERATIONS` was reached.
- `Sorry, I encountered an error while talking to the model. Please try again or use /status.` — sent when the agent throws an unhandled error.
- `I could not complete that safely.` — used in the answer text when security policy blocks an action.

## Error Messages

Errors should be safe and useful:

- Do not include API keys, tokens, request bodies, raw stack traces, or full tool output.
- Include the failing subsystem when safe:
  - Telegram
  - OpenAI
  - browser
  - terminal
  - file
  - search
- Include a next step if the owner can fix it, such as missing environment variable or unavailable search provider.

## Access Denied Behavior

For non-whitelisted users:

- Do not reveal capabilities.
- Do not reveal owner identity.
- Do not call OpenAI or tools.
- Preferred response is either silence or a minimal denial, depending on Telegram bot behavior chosen during implementation.

## Visual Assets

The initial project does not require custom visual assets. Browser screenshots produced by the browser tool are task artifacts, not UI assets.

## Dashboard UI (v1, in progress)

A private, read-only QA dashboard is now in scope. Full plan and milestones live in `context/dashboard.md`. This section captures the UI surface only.

Purpose:

- Let the owner inspect QA projects, reports, failed checks, and screenshots in a web UI instead of relying solely on Telegram messages.

Surface and stack:

- Separate Next.js (App Router) app under `apps/dashboard`, deployed on Vercel.
- shadcn/ui + Tailwind, Zod-validated server-side data access.
- Clerk sign-in required; any signed-in user may view all reports (no owner allowlist or curation). Signed-out users are blocked.
- Read-only in v1: no agent chat, no rerun buttons, no deletion, no dashboard-triggered tool execution.

Planned screens:

- `/` — reports overview: project filter, summary cards (total runs, pass rate, failed checks, latest run), recent reports table with pass/fail badges, plus empty/error/loading states.
- `/reports/[id]` — report detail: title, project, date, duration, pass/fail summary, failed checks first, full assertion list, safe details text, and a screenshot gallery loaded through authenticated server-side calls.

Design intent:

- Dense, calm, operational. Dark mode first.
- Screenshots are private artifacts loaded through the authenticated Railway API, never public static assets.
- Old reports without optional screenshot/project metadata must still render via compatibility fallbacks.

## Future Demo Chat UI

Out of scope for dashboard v1. A future portfolio/demo agent chat must be a separate surface (likely `/demo`) with demo-safe storage, approved demo URLs only, and stricter tool limits. It must never read private `/data`, private reports, or screenshots. See `context/dashboard.md`.
