# UI Context

## Interface Surface

This project does not have a web UI in the initial scope. The primary interface is Telegram chat. All user-facing output should be designed for Telegram readability, command ergonomics, and message length constraints.

## Telegram Experience

The bot should feel like a private technical operator:

- concise for routine command responses
- detailed for completed task summaries
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

There is no `/report` command in this version. Task summaries are delivered automatically as Telegram messages when the agent finishes a task.

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

## Task Summary Format

Task summaries are Telegram messages, not files. Use a simple, mobile-friendly shape:

```text
<Short Task Title>

Result:
<One short paragraph describing what was done.>

Tools used: <comma-separated list, or "none">

Caveats:
<Any failed steps, partial results, or things the owner should know. Skip this section if there are none.>

Next steps:
<Optional follow-up suggestions. Skip this section if there are none.>
```

Notes:

- Use plain text by default; only use Markdown when it genuinely helps readability.
- Keep "Result" to one short paragraph. Push detail into "Caveats" or "Next steps" only when useful.
- Do not include raw tool output, full logs, or secrets.
- A persisted Markdown report format may be reintroduced in a later version; if so, update this section first.

## Status Messages

Use consistent status phrasing:

- `Working on it...` when a longer agent task starts.
- `Tool limit reached.` when max iterations are hit.
- `I could not complete that safely.` when security policy blocks an action.
- `Done.` followed by the task summary block when a task completes successfully.
- `Done with issues.` followed by the task summary block when the task partially completed and the caveats section is populated.

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

## Future Web UI

A web dashboard is out of scope for v1. If added later, create a separate frontend context update covering:

- dashboard goals
- auth model
- design system
- session viewer
- task summary history (if persistence is added)
- tool audit log
