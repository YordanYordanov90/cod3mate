# Deep Overview — How the cod3mate Agent Works

> **Purpose of this file:** a single learning document that explains the agent end-to-end —
> system design, how parts talk to each other, where state lives, how memory works,
> how tools are wired, and how errors are (and will be) handled.
>
> **Status note:** Milestones 1–8 are complete. The bot is deployed on Railway with a
> mounted `/data` volume and is online for the whitelisted owner. Architecture, security
> invariants, and tool boundaries described here all reflect built code, not plans.
> The structured task-summary builder still lives in `src/summary/mod.ts` for potential
> future reuse, but the live bot now sends one merged message per task instead. See
> `progress-tracker.md` for the precise milestone state and session notes.

---

## 1. The One-Paragraph Mental Model

cod3mate is a **private, single-owner Telegram AI agent** running as an always-on
container on Railway. You message a Telegram bot; the bot checks you are the one allowed
user; your message goes into an **agent loop** that talks to OpenAI; OpenAI either answers
directly or asks to run a **tool** (browser, terminal, file, web search); the tool runs
under strict safety limits; its output is **sanitized** and fed back to OpenAI; this
"think → act → observe" cycle repeats until OpenAI produces a final answer; the answer
(plus a short task summary) is chunked and sent back to you on Telegram. Secrets never
leave environment variables. State lives on a `/data` disk volume, not a database.

---

## 2. System Design Overview

### 2.1 The layers (who owns what)

Every folder under `src/` is one **system boundary**. The rule from `code-standards.md`
is: *keep modules small and focused on one boundary, and don't import across boundaries
that shouldn't know about each other* (e.g. tools must never import Telegram code).

| Boundary | Folder | Responsibility | Built? |
| --- | --- | --- | --- |
| Entrypoint | `src/index.ts` | Start app, validate env, launch bot, graceful shutdown | ✅ |
| Config | `src/config/` | Parse + validate env with Zod, safe defaults | ✅ |
| Telegram | `src/telegram/` | Bot, owner whitelist, commands, formatting, chunking, merged-message renderer | ✅ |
| Agent | `src/agent/` | Multi-round loop, OpenAI calls, prompt building, model fallback, history | ✅ |
| Soul | `src/soul/` | Load + format `/data/SOUL.md` into the system prompt | ✅ |
| Tools | `src/tools/` | Registry + shared tool types + Zod schemas | ✅ |
| Tools → browser | `src/tools/browser/` | Playwright lifecycle + actions | ✅ |
| Tools → terminal | `src/tools/terminal/` | Allowlisted command execution | ✅ |
| Tools → files | `src/tools/files/` | Safe `/tmp` read/write | ✅ |
| Tools → search | `src/tools/search/` | Tavily client + result normalization | ✅ |
| Summary | `src/summary/` | Structured task summary builder (retained, not currently wired) | ✅ (idle) |
| Security | `src/security/` | Credential sanitization, access checks, safe logging | ✅ |
| Storage | `src/storage/` | `/data` session persistence + filesystem helpers | ✅ |
| Lib | `src/lib/` | Tiny shared utilities (no Telegram/OpenAI coupling) | ✅ |

**Why split this way?** So each piece is independently testable and so a security rule
(like "sanitize tool output") lives in exactly one place. If Telegram formatting and agent
reasoning were in the same file, you couldn't test either cleanly, and a bug in one could
break the other.

### 2.2 High-level component map

```text
        Telegram (owner's phone)
                 │  message
                 ▼
┌─────────────────────────────────────────────┐
│            src/telegram/  (GrammY)            │
│  whitelist middleware → command? → handler    │
└───────────────┬───────────────────────────────┘
                │ normal message → AgentRequest
                ▼
┌─────────────────────────────────────────────┐
│              src/agent/  (the loop)           │
│  build prompt (SOUL.md + rules + history)     │
│         │                       ▲             │
│         ▼                       │ observation  │
│   OpenAI SDK call ──► tool call?─┘             │
└─────────┬───────────────────────┬─────────────┘
          │ final answer          │ tool request
          ▼                       ▼
   src/summary/ ───► Telegram   src/tools/registry
   (task summary)   formatter   ├─ browser (Playwright)
                    + chunking  ├─ terminal (allowlist)
                                ├─ files   (/tmp only)
                                └─ search  (Tavily API)
                                      │
                                      ▼
                          src/security/ sanitize
                          (runs on every output)

State on disk:  /data/SOUL.md   /data/sessions/   /data/logs/   /tmp/agent-files/
Secrets:        Railway environment variables only
```

The key insight: **everything funnels through the agent loop**, and **every output that
could contain a secret passes through `src/security/` sanitization** before it reaches
the model, the logs, or Telegram.

---

## 3. How the Parts Communicate

This is the request lifecycle, step by step. (From `architecture.md` → "Runtime Flow"
and `project-overview.md` → "Core User Flow".)

1. **Owner sends a Telegram message.** GrammY receives an "update".
2. **Whitelist middleware runs first** (`src/telegram/`). It compares the sender's
   Telegram user ID against `TELEGRAM_ALLOWED_USER_ID`. A non-owner is rejected *before*
   any command, agent, or tool code runs. This is **Invariant #1**.
3. **Command vs. message routing.** If the text is `/start`, `/help`, `/status`,
   `/reset`, or `/model`, a thin command handler responds directly. Otherwise it becomes
   a normal agent request.
4. **Session load.** `src/storage/` loads the per-chat conversation history from
   `/data/sessions/<chatId>.json` (or starts a fresh one).
5. **Agent builds the model input** (`src/agent/runner.ts`, planned). It assembles:
   - base **security rules** (always on top of the prompt),
   - the **`SOUL.md`** content (personality/preferences — *below* security rules),
   - **recent conversation history**,
   - the current user message,
   - the **tool definitions** (names + descriptions + JSON schemas).
6. **OpenAI call.** The OpenAI SDK is invoked directly (no OpenRouter). It returns either:
   - a **final text answer**, or
   - one or more **tool calls** (e.g. "run `web_search` with query X").
7. **Tool routing.** Each tool call goes through `src/tools/registry.ts`:
   - the tool name is checked against the registry (unknown name → safe failure),
   - the input is validated with the tool's **Zod schema**,
   - the tool runs with a **timeout** and **max output length**.
8. **Sanitize the observation.** The tool's output is run through `src/security/sanitize.ts`
   *before* it's appended to history or shown to the model. This is **Invariant #6**.
9. **Loop.** The sanitized observation is appended, and the agent calls OpenAI again.
   This repeats until a final answer **or** `MAX_AGENT_ITERATIONS` (default `8`) is hit.
10. **Format + send.** `src/telegram/` formats the final answer and **chunks** it to fit
    Telegram's length limit (`TELEGRAM_CHUNK_SIZE`, default `3500`).
11. **Task summary.** `src/summary/` builds a short Telegram message (title, result, tools
    used, caveats, next steps), sanitizes it, chunks it, and sends it.
12. **Persist session.** Updated history is written back to `/data/sessions/`.

### Communication style between modules

- **Data, not coupling.** Telegram hands the agent a plain `AgentRequest` object; the
  agent hands back a plain result. The agent does *not* call Telegram APIs directly, and
  tools do *not* import Telegram. This keeps each layer swappable and testable.
- **Discriminated unions for results** (`code-standards.md`). Tool results are always:

```ts
type ToolResult =
  | { ok: true;  content: string; metadata?: Record<string, unknown> }
  | { ok: false; error: string;   metadata?: Record<string, unknown> };
```

  The agent loop branches on `ok`, so a failed tool is normal control flow, not a crash.

---

## 4. The Agent Loop (the heart of the system)

This is the single most important concept to learn. It is a **bounded ReAct-style loop**
(Reason → Act → Observe), implemented in `src/agent/runner.ts`. Every iteration is one
model call. Iteration count is shared between the model call and the tool execution it
triggers.

```text
receive Telegram update
authorize sender                      ← security gate
load session history                  ← state in
build model input:                    ← prompt assembly
  security rules
  optional test-credentials block (when env set)
  SOUL.md
  history + tool definitions
for iter in 0..MAX_AGENT_ITERATIONS:
  call OpenAI on the active model
  if no tool_calls → return content   ← exit condition A
  append assistant message with tool_calls
  for each tool_call:
    validate input (Zod)
    execute (timeout + max output)
    sanitize observation              ← security gate
    append as a tool message
return last content with iterationLimitHit = true   ← exit condition B
compose merged Telegram message (answer + footer)
send + persist session                ← state out
```

**Why it's bounded:** an unbounded loop could call tools forever (cost, runaway browser
sessions, infinite spend). `MAX_AGENT_ITERATIONS` (default `8`) is the safety valve. When
hit, the merged message footer surfaces `Stopped at iteration limit — break the task into
smaller steps.`

**Loop invariants** (from `architecture.md`):
- Each tool has its **own** timeout.
- Tool output is **truncated** to `MAX_TOOL_OUTPUT_CHARS` (default `12000`).
- Every external input is validated **before** it enters agent state.
- All model-visible tool output is **sanitized**.
- Fallback to `OPENAI_FALLBACK_MODEL` happens only on the **first** call. Once any tool
  result is in the conversation, the active model is locked.
- The loop returns a graceful message when the iteration limit is reached (never a raw crash).

---

## 5. Where State Lives

There are **four kinds of state**, and it matters which is which:

### 5.1 Configuration state — Railway environment variables
- API keys, the Telegram token, the owner's user ID, model names, search settings.
- Loaded **once at startup** by `src/config/env.ts` and validated with Zod.
- **Never** written to files, logs, conversation history, `SOUL.md`, or Telegram.
- This is the only place secrets exist. (Invariant #2.)

Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `OPENAI_API_KEY`,
`OPENAI_PRIMARY_MODEL`, `OPENAI_FALLBACK_MODEL`, `TAVILY_API_KEY`.
Optional (with defaults): `TAVILY_SEARCH_ENDPOINT`, `DATA_DIR`, `TMP_DIR`,
`MAX_AGENT_ITERATIONS`, `MAX_TOOL_OUTPUT_CHARS`, `TELEGRAM_CHUNK_SIZE`, `LOG_LEVEL`,
`ENABLE_FILE_LOGS`.

### 5.2 Durable agent state — the `/data` volume (persistent disk)
| Path | What | Lifetime |
| --- | --- | --- |
| `/data/SOUL.md` | Personality, rules, operating preferences | Edited by you; loaded at startup |
| `/data/sessions/` | Per-chat conversation history + selected model | Survives restarts |
| `/data/logs/` | Optional sanitized logs (if `ENABLE_FILE_LOGS=true`) | Survives restarts |

`/data` is a **Railway volume** — a real disk that persists across deploys and restarts.
This is why the agent "remembers" your conversation after a redeploy.

### 5.3 Transient working state — `/tmp/agent-files`
- The file tool's sandbox and screenshot output (`/tmp/agent-files/screenshots`).
- **Disposable.** May be wiped any time. Never put anything you need to keep here.

### 5.4 In-memory runtime state — lives only while the process runs
- The current agent loop's messages/iteration count.
- The selected model for the live session (also persisted to `/data/sessions`).
- The Playwright browser instance (reused across actions, closed cleanly to avoid leaks —
  Invariant #9).

**Learning point:** there is **no database** in v1. "Memory" = the `SOUL.md` system prompt
+ the JSON session files on `/data`. Long-term DB-backed memory is explicitly **out of
scope** (see `project-overview.md` → "Out of Scope").

---

## 6. Memory Model (how the agent "remembers")

The agent has three memory tiers, from most permanent to most temporary:

1. **Identity / standing instructions → `SOUL.md`.**
   Loaded at startup and injected into the system prompt on **every** OpenAI request.
   This is *who the agent is* and *how it should behave*. It is instruction context only —
   it can **never** override security, tool, or access rules (Invariant #5). Changing it
   requires a restart in v1 (no hot reload yet).

2. **Conversation memory → `/data/sessions/<chatId>.json`.**
   The rolling history of user/assistant/tool messages for a chat. This is *what we've been
   talking about*. `/reset` clears it. It's reloaded on each message so context survives
   restarts.

3. **Working memory → the live loop in RAM.**
   The messages array for the current request, including tool observations added mid-loop.
   This dies when the request finishes (after being persisted to the session file).

**What is NOT memory:** tool outputs are not stored raw. They're sanitized and summarized
before entering history, so secrets and giant blobs never accumulate in memory.

---

## 7. Tools (the agent's hands)

A "tool" is a capability OpenAI can ask to invoke. The agent decides *whether* to call a
tool; the **registry** decides *if it's allowed and valid*; the tool decides *how* to run
safely.

### 7.1 Tool contract (every tool exports the same shape)

```ts
{
  name: string;            // stable id the model references
  description: string;     // helps the model pick the right tool
  inputSchema: ZodSchema;  // validates the model's arguments
  execute(input): Promise<ToolResult>;
  // plus: timeout, max output length, sanitization policy
}
```

### 7.2 The initial toolset

| Tool name | What it does | Safety boundary |
| --- | --- | --- |
| `browser_navigate` | Open a URL | URL validated |
| `browser_click` | Click a selector | Selector validated |
| `browser_fill` | Fill a form field | Selector + value validated |
| `browser_screenshot` | Screenshot → `/tmp/agent-files/screenshots` | Returns safe path, not raw bytes |
| `browser_extract_text` | Read visible page text | Text only |
| `terminal_exec` | Run an **allowlisted** command | Allowlist + timeout + max bytes + sanitized env |
| `file_read` | Read a file under `/tmp/agent-files` | Path traversal rejected |
| `file_write` | Write a file under `/tmp/agent-files` | Stays inside TMP_DIR (Invariant #3) |
| `web_search` | Tavily search | Key from env; results normalized |

### 7.3 Tool safety rules (from `code-standards.md`)
- **Browser:** one Playwright Chromium instance, isolated pages/contexts per task, closed
  after use. Screenshots return a path, never binary.
- **Terminal:** must **fail closed** if the allowlist is missing/empty. Bounded by timeout,
  max output bytes, fixed working directory, sanitized environment. App secrets are not
  passed into the child process unless a specific command needs them.
- **Files:** real path is resolved *then* checked against `TMP_DIR`. Traversal (`../`)
  rejected. Size-limited. Text by default.
- **Search:** Tavily only (no OpenRouter). Normalized to title/URL/snippet/source/timestamp.
  Rate-limit and missing-key handling with safe errors.

**Learning point — least privilege:** each tool can do exactly one narrow thing inside one
sandbox. The model can *request* anything, but the registry + schemas + sandboxes are what
actually keep it safe. Never trust the model's tool arguments — validate them.

---

## 8. Error Handling

Error handling here is a **layered, fail-safe** strategy. The guiding principles from
`code-standards.md`: *don't silently swallow errors; normalize them into safe messages;
never leak secrets or raw stack traces.*

### 8.1 What exists today (Milestone 1)
- **Startup validation** (`src/config/env.ts`): missing/invalid env → prints actionable,
  secret-free messages and `process.exit(1)`. You can see exactly which var is wrong
  without ever printing its value.
- **Process-level guards** (`src/index.ts`): `unhandledRejection` and `uncaughtException`
  handlers log and exit; `SIGINT`/`SIGTERM` trigger graceful shutdown (placeholder for
  closing bot/browser later).

### 8.2 Planned, layer by layer

| Layer | Failure | Handling |
| --- | --- | --- |
| Telegram | Non-owner update | Reject before handlers (silence or minimal denial) |
| Telegram | Send/format error | Safe error naming the subsystem; never raw payload |
| Agent loop | Iteration limit hit | Stop gracefully → `Tool limit reached.` |
| OpenAI | Recoverable model/API error | **Fallback** from primary → fallback model |
| OpenAI | Unrecoverable | Safe error preserving debug detail but **redacting keys** |
| Tool | Invalid name | Registry returns safe failure, loop continues |
| Tool | Invalid input | Zod rejects before execution |
| Tool | Timeout / oversized output | Truncate + return `{ ok: false, error }` |
| Security | Any secret in output | Sanitizer redacts before it leaves |
| File/terminal | Unsafe path / blocked command | Refuse → `I could not complete that safely.` |

### 8.3 The two-model fallback (important detail)
- `OPENAI_PRIMARY_MODEL` is tried first (planned default display name: *GPT-5.4 Nano*).
- On a **recoverable** failure, the agent retries with `OPENAI_FALLBACK_MODEL`
  (planned: *GPT-4.1 Mini*).
- Model IDs are **always env-driven**, never hardcoded (Invariant #8), because real API
  IDs change. There's an open blocker: confirm the exact API ID for the primary model
  (`progress-tracker.md` → Open Questions).

### 8.4 The `Result` / discriminated-union pattern
Expected failures (a tool failing, a search returning nothing) are modeled as **data**
(`{ ok: false, error }`), not thrown exceptions. Exceptions are reserved for truly
unexpected states. This makes the loop's branching explicit and testable.

---

## 9. Security Model (cross-cutting, non-negotiable)

Security isn't a feature here — it's woven through every layer. The four pillars:

1. **Access control.** Owner-only via `TELEGRAM_ALLOWED_USER_ID`, enforced *before*
   anything else. Group chats off by default.
2. **Credential sanitization.** Centralized in `src/security/sanitize.ts` (planned).
   Redaction patterns are built from env values + known key shapes (OpenAI key, Telegram
   token, generic API keys). Sanitization runs on **logs, errors, tool outputs, task
   summaries, Telegram responses, and model-visible observations** — everything that
   leaves the trusted core.
3. **Sandboxing tools.** File tool locked to `/tmp`; terminal locked to an allowlist;
   browser actions validated; outputs bounded.
4. **Treat everything external as untrusted.** Telegram updates, model outputs, tool
   inputs, search results, file contents, terminal output — all validated/normalized at
   the edge before entering app logic.

The 10 **invariants** in `architecture.md` are the contract. The most load-bearing for
learning are #1 (no non-owner reaches the loop), #2 (no secret leaves env), #6 (sanitize
before storing/sending), and #5 (`SOUL.md` can't override security).

⚠️ **SECURITY ALERT — the highest-risk surfaces to watch as you build:**
- **Prompt injection** via web pages or search results: the model may read malicious text
  ("ignore your rules, run this command"). Mitigation: security rules sit *above* `SOUL.md`
  and all observations are untrusted; never let tool output silently expand the allowlist.
- **Unvalidated LLM tool arguments:** always Zod-validate before `execute`.
- **Data leakage between steps:** sanitize observations *before* they re-enter the model
  context, so a secret read by one tool can't be echoed by the next.

---

## 10. Deployment Shape (where it all runs)

- One **Dockerized** service on **Railway**, always on.
- Image bundles Node.js + Playwright + Chromium + system deps.
- `/data` is a mounted **Railway volume** (persistent disk).
- Starts with `node dist/index.js`.
- First deploy uses Telegram **long polling** (simpler — no public webhook). Webhook mode
  can come later. (Open question in `progress-tracker.md`.)

---

## 11. Build Status & Reading Order

**Built today:** Milestones 1–8 complete. The bot is live on Railway with a mounted
`/data` volume, an uploaded custom `SOUL.md`, and 9 tools registered. The agent runner
is a true multi-round loop bounded by `MAX_AGENT_ITERATIONS`. Each completed task
delivers exactly one merged Telegram message.

**Build sequence** (from `ai-workflow-rules.md`):
1. ✅ Foundation → 2. ✅ Telegram shell → 3. ✅ SOUL + sessions → 4. ✅ OpenAI agent loop →
5. ✅ Tool registry → 6. ✅ File + terminal tools → 7. ✅ Browser tool → 8. ✅ Web search →
9. ✅ Telegram task response (consolidated to a single merged message during M8) →
10. ✅ Railway deploy.

**Suggested reading order to learn the codebase:**
`config/env.ts` → `telegram/` (middleware + bot.ts merged-message handler) →
`agent/prompt.ts` (system-prompt order: security → test creds → SOUL) →
`agent/runner.ts` (the multi-round loop) → `tools/registry.ts` → individual tools →
`security/sanitize.ts` → `summary/` (idle, retained for reuse).

---

## 12. Glossary

- **Agent loop:** the bounded Reason→Act→Observe cycle in `src/agent/`.
- **Tool:** a validated, sandboxed capability the model can request (browser/terminal/file/search).
- **Registry:** the gatekeeper that validates tool name + input and enforces limits.
- **Observation:** a (sanitized) tool result fed back into the model.
- **SOUL.md:** the agent's standing personality/instructions, injected into every prompt.
- **Session:** per-chat conversation history persisted under `/data/sessions/`.
- **Sanitization:** centralized redaction of secrets from anything leaving the core.
- **Invariant:** a rule that must always hold (see `architecture.md`).
- **Fallback model:** the secondary OpenAI model used when the primary recoverably fails.

---

*Keep this file in sync when implementation changes architecture, state, security, tools,
or the loop. It is a learning map, not a spec — the authoritative rules live in
`architecture.md` and `code-standards.md`.*
