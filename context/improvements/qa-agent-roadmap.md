# QA Agent Roadmap

Transform cod3mate from a general-purpose AI assistant into a fully automated QA agent.

## Status Legend

- ⬜ Not started
- 🟡 In progress
- ✅ Done

---

## Phase 1: Assertion Tools

**Goal:** Give the agent pass/fail primitives instead of relying on the model to "guess" from extracted text.

**Status:** ✅ (completed)

### What to build

Create `src/tools/qa/assertions.ts` with these tools:

| Tool | Purpose |
|------|---------|
| `qa_assert_visible` | Assert a selector or text is visible on the current page (cross-frame) |
| `qa_assert_not_visible` | Assert something is NOT shown (e.g. error banner should be absent) |
| `qa_assert_text_contains` | Assert a page element contains expected text |
| `qa_assert_url` | Assert current URL matches a pattern (exact, contains, or regex) |
| `qa_assert_element_count` | Assert the number of matching elements (e.g. "3 rows in the table") |

### Implementation notes

- Each tool returns structured `{ passed: boolean, expected: string, actual: string, message: string }`.
- Reuse the existing `getOrCreatePage` and `resolveLocatorAcrossFrames` from `src/tools/browser/mod.ts` — export them or extract to a shared browser helper.
- Register all assertion tools in `src/index.ts` alongside existing tools.
- Add unit tests in `tests/tools/qa-assertions.test.ts`.

### Exit criteria

- All 5 assertion tools registered and callable by the agent. ✅
- Each returns structured pass/fail (not just text). ✅
- Tests cover: passing assertion, failing assertion, missing element, cross-frame resolution. ✅ (13 tests)
- `npm run build && npm run test:run && npm run typecheck` all pass. ✅

**Implementation notes:** Exported `getOrCreatePage`, `resolveLocatorAcrossFrames`, added `resolveVisibleLocator` + `isVisibleAcrossFrames` helpers in browser/mod.ts for reuse (and testability). Created `src/tools/qa/assertions.ts` + registration in index.ts. All results are `{passed, expected, actual, message}` JSON in content + metadata. Negative assertions (not_visible, count mismatch, missing) return ok:true with passed:false. Cross-frame uses srcdoc iframe in tests.

---

## Phase 2: QA Report Builder

**Goal:** Track test cases during a run and produce a structured pass/fail report.

**Status:** ✅ (completed)

### What to build

1. **QA Report Collector** (`src/tools/qa/report.ts`):
   - In-memory collector that accumulates assertion results during a single agent run.
   - Each entry: `{ name: string, status: 'pass' | 'fail' | 'skip', duration?: number, details?: string }`.
   - Exposed as a singleton or injected per run.

2. **QA Report Formatter**:
   - Produces a Telegram-friendly summary:
     ```
     QA Report: <title>
     Ran: X checks | Passed: Y | Failed: Z

     PASS  Page loads correctly
     FAIL  Dashboard shows user name
           Expected: "Welcome, Test User"
           Actual: element not found
     ```

3. **Persistence** (`/data/qa-reports/`):
   - Save each report as JSON with timestamp + title.
   - Add a `/qa-history` Telegram command to list recent reports (last 10).

### Implementation notes

- Wire assertion tools to automatically push results into the collector.
- The report should be sent as the final Telegram message when the agent finishes a QA-tagged run.
- Reuse `sanitizeString` on all report content before sending.

### Exit criteria

- Assertion results automatically accumulate during a run. ✅ (wired in qa_assert_* executes)
- Agent sends a structured pass/fail report at the end. ✅ (after normal answer for runs that used assertions; also on error paths)
- Reports persist to `/data/qa-reports/`. ✅
- `/qa-history` command works. ✅
- Tests cover: report building, formatting, persistence, empty report edge case. ✅ (7 new tests + updates to assertions tests; total 114)

**Implementation notes:** 
- `src/tools/qa/report.ts`: per-run collector via AsyncLocalStorage (`withQaReportCollector` / recordAssertion / recordQaScreenshot), formatQaReport exactly matching the spec layout, test helpers. Legacy `startQaReport`/`endQaReport` retained for tests only.
- Optional `name` arg added to all 5 assertion tools so the model can label steps nicely in reports (falls back to derived names).
- Assertions time themselves and call recordAssertion (side-effect; no-op if no active report).
- Telegram bot: always starts a report titled from user text for every agent run; after answer (or on catch), ends it; if entries>0 then save + send second sanitized report message.
- `src/storage/qa-reports.ts` + updated ensureDataDirectories + getStoragePaths.
- /qa-history, updated /help /status /start, /qa tools advertised.
- Sanitize applied on all outgoing report text (reuse sanitizeString).
- No changes to runner; qa tools appear in normal "Tools:" footer too.

---

## Phase 3: Network & Console Observation

**Goal:** Catch silent API failures, console errors, and JS exceptions that the DOM doesn't reveal.

**Status:** ✅ (completed)

### What to build

| Tool | Purpose |
|------|---------|
| `qa_check_console_errors` | Return any `console.error` / `console.warn` captured since last navigation |
| `qa_check_network_failures` | List failed network requests (4xx, 5xx, timeouts) since last navigation |
| `qa_intercept_api` | Capture the response body of a specific API endpoint pattern for validation |

### Implementation notes

- Hook into Playwright's `page.on('console')` and `page.on('response')` / `page.on('requestfailed')` in the persistent page context.
- Start listeners when the page is created (in `getOrCreatePage`), store events in memory, and expose them through the tools.
- Clear captured events on `browser_navigate` or `browser_reset`.
- Truncate captured response bodies to prevent memory bloat (e.g. 4KB per captured response).

### Exit criteria

- Console errors and network failures are passively captured during browsing. ✅
- Agent can query them at any point during a flow. ✅
- API interception works for a user-specified URL pattern. ✅
- Tests cover: capturing errors, clearing on navigation, truncation. ✅ (6 tests, reliable via Playwright route + evaluate)

**Implementation notes:**
- Added capture state + listeners (console, requestfailed, response) + clear/setup in `src/tools/browser/mod.ts`. Attached in `getOrCreatePage`, cleared explicitly in `browser_navigate` and `browser_reset` (and resetBrowserPage).
- Bodies truncated to 4KB, only text/json etc captured for body; failures (4xx+) and errors collected.
- New `src/tools/qa/monitoring.ts` with 3 tools using the getters. Registered in index.ts.
- Updated help text.
- Exported getters + clear for testability.
- Tests use setContent + route + evaluate + wait, plus direct clear and nav tool for clear-on-nav cases.
- Also updated qa-assertions tests indirectly benefit from clears in reset.

---

## Phase 4: Wait Tools

**Goal:** Prevent flaky QA results caused by timing issues (loading spinners, async data, toast notifications).

**Status:** ✅ (completed)

### What to build

| Tool | Purpose |
|------|---------|
| `browser_wait_for` | Wait for a selector to appear or disappear, with configurable timeout |
| `browser_wait_for_network_idle` | Wait until no pending network requests for N ms |
| `browser_wait_for_text` | Wait until specific text appears anywhere on the page |

### Implementation notes

- Use Playwright's built-in `locator.waitFor()`, `page.waitForLoadState('networkidle')`, and `page.waitForFunction()`.
- Default timeout: 10s. Max allowed: 30s.
- Return elapsed time so the agent (and report) know how long things took.

### Exit criteria

- All 3 wait tools registered and working. ✅
- Agent can use them between navigation and assertion steps. ✅
- Tests cover: element appears, element times out, text appears, network settles. ✅ (6 tests incl. elapsed time reporting, cross-frame via existing helpers)

**Implementation notes:**
- Added `waitForAcrossFrames` helper (modeled on resolve* for cross-frame support) in `src/tools/browser/mod.ts`.
- Implemented `browser_wait_for` (selector + state + timeout), `browser_wait_for_network_idle`, `browser_wait_for_text` (reuses resolveTextLocatorAcrossFrames) inside createBrowserTools.
- All return elapsed ms in content + metadata (success or timeout info); always ok:true so agent can continue (like assertions).
- Default 10s, max 30s enforced in schema.
- Registered in index.ts (as browser_*), added to /help.
- New test file `tests/tools/browser-wait.test.ts` using setContent + delayed evaluate/route for reliable async sim + timeout cases.
- Integrated with existing page lifecycle (clears etc from phase3 don't affect waits).

---

## Phase 5: Raise Iteration Limit for QA

**Goal:** Real QA flows need 20+ tool calls. The current limit of 8 is too low.

**Status:** ✅ (completed)

### What to build

Add a `/qa-test <url> <description>` command that:
- Temporarily sets `maxIterations` to 25 for that run (env default remains 8 for normal chat).
- Resets browser state (fresh Playwright context + clears observation buffers) before starting.
- Reuses the existing report collection (QA reports auto-emit when qa_assert_* are used during the run).

### Implementation notes

- Added `/qa-test` command to `src/telegram/bot.ts` (parses optional leading URL + freeform description; supports no-URL form).
- Refactored generic text handler logic into internal `processAgentTask(ctx, instruction, {maxIterations?}, logLabel?)` so /qa-test and normal chat share append/history/run/merged-send/report-emit/error paths (no duplication).
- Extended `BotDependencies.runAgent` signature (and the bound `runAgentForChat` in `src/index.ts`) to accept optional `maxIterations` (falls back to env.MAX_AGENT_ITERATIONS).
- Injected `resetBrowser` (wrapper over exported `resetBrowserState`) into bot deps; /qa-test calls it before delegating to processor.
- `/start`, `/help`, and `/status` updated to document the command + 25-iter behavior.
- Kept default at 8; only QA explicit runs get the bump. Report "tagging" is via the title + the higher-iter capability (report emission unchanged: only when assertions recorded).
- All 126 tests, build, and typecheck pass.

### Exit criteria

- QA-tagged runs (/qa-test) can execute 20+ tool calls without hitting the limit. ✅
- Normal chat stays at the env default (8). ✅
- `/qa-test` command documented in `/help`. ✅ (also in /start and status)

---

## Phase 6: Terminal Allowlist Expansion

**Goal:** Enable the agent to run project test suites, check builds, and inspect logs.

**Status:** ✅ (completed)

### What to build

Expand `ALLOWED_BASE_COMMANDS` in `src/tools/terminal/mod.ts`:

| Command | Justification |
|---------|--------------|
| `grep` | Search logs and output |
| `curl` | Hit health endpoints, check API responses |
| `npx` | Run test suites (`npx vitest`, etc.) |
| `git` | Read-only: `git status`, `git log`, `git diff` |

### Implementation notes

- Expanded `DEFAULT_SAFE_COMMANDS` + `ALLOWED_BASE_COMMANDS` with the 4 new bases.
- Added `isGitReadOnlyCommand` (subcommand allowlist for status/log/diff/show/branch/remote/ls-files/rev-parse/etc + broad mutating keyword + --force/--hard blocker; handles -C etc).
- Added `isCurlSafeCommand` (token parser: permits GET/HEAD/OPTIONS via -X/--request; blocks all -d/--data, -F/--form, -T/--upload, -o/-O writes, cookie-jar writes).
- Enhanced `isCommandAllowed` to dispatch to the guards for git/curl (other new cmds like grep/npx use base-only, like prior npm/node).
- Updated `terminal_exec` description (longer but precise) so the model in tool defs knows exact safe usage + what is blocked.
- Exported the two guards for testability.
- In `tests/tools/terminal.test.ts`:
  - Expanded policy tests (positive for all 4, negative for classic + all dangerous git/curl variants).
  - Direct unit tests for `isGitReadOnlyCommand` + `isCurlSafeCommand`.
  - Execution tests (using --version + safe status/grep-pipe for the new cmds) + execute-time rejection for bad variants.
- Also updated AGENTS.md + README.md terminal allowlist mentions.
- All new commands work inside the existing cwd-sandbox + sanitized-env + timeout + truncate machinery.
- `git push`, `git reset --hard`, `curl -X POST`, `curl -d ...`, `curl -o file` etc. are rejected at allow-check (never reach exec).

### Exit criteria

- New commands work in the sandbox. ✅
- `git push`, `git reset --hard`, etc. are still blocked. ✅ (plus equivalent for curl)
- Tests cover new allowlist entries + blocked dangerous variants. ✅ (multiple its + direct guard tests)

---

## Phase 7: Reusable Test Scenarios

**Goal:** Save and re-run test plans without re-describing them every time.

**Status:** ✅ (completed)

### What to build

1. **Scenario storage** (`/data/qa-scenarios/`):
   - JSON files defining test flows (example in the original spec).
   - `$TEST_EMAIL` / `$TEST_PASSWORD` (and $TEST_ACCOUNT_* aliases) resolve from env credentials at /qa-run time only (never persisted literally).

2. **Telegram commands**:
   - `/qa-scenarios` — list saved scenarios.
   - `/qa-run <name>` — execute a saved scenario and produce a QA report.

3. **Scenario executor** (`src/tools/qa/scenario-runner.ts`):
   - Loads a scenario, executes steps sequentially (via toolRegistry), collects assertion results into the active QA report.
   - Also provides `qa_save_scenario` tool.

### Implementation notes

- Added `QA_SCENARIOS_DIR` + paths/ensure to `src/storage/mod.ts`.
- New `src/storage/qa-scenarios.ts`: ensure/save/load/list (name-based .json, similar slug/normalize to reports).
- `src/tools/qa/scenario-runner.ts`:
  - Types `QaScenario` / `ScenarioStep` (supports all example actions + more from browser/qa tools: navigate, fill, click, reset, waits, all 5 asserts, etc.).
  - `substituteStep` + cred placeholder replacement (done in-memory at exec only).
  - `executeScenarioSteps(scenario, {testCredentials?, registry?})` — loops, maps action->tool, calls registry.execute (assert tools auto `recordAssertion` when report active).
  - `createQaSaveScenarioTool({dataDir})` — Zod-validated tool the agent can call; stores with $VARS intact.
- Wired in `src/index.ts`: register qa_save_scenario after other QA tools; pass testCredentials (conditional) to bot.
- In `src/telegram/bot.ts`:
  - Extended BotDependencies + destructure with testCredentials.
  - `/qa-scenarios` command (lists name/desc/stepCount/saved).
  - `/qa-run <name>`: loads, resets browser (clean state), appends to session, starts report, calls executor, sends exec summary + formatted report (if any assertions) + saves report. Error paths emit partial reports. Uses stopTyping.
  - Updated /start, /help (including tool list), /status.
- New dedicated test file `tests/tools/qa-scenarios.test.ts` (storage roundtrips, name normalize, substitution of both $ styles, executor counts/success/fail/unknown with fake registries, report collector interaction, save tool roundtrip + validation). +8 tests, total 141.
- Also updated bot help/status/start to document.
- No credential values ever written to disk (only placeholders); substitution only in executor memory before tool args.
- /qa-run is direct (no LLM iterations) — great for long deterministic plans on top of the Phase 5 25-iter bump for exploratory /qa-test.

### Exit criteria

- Scenarios can be saved, listed, and executed. ✅
- `/qa-run login-flow` produces a full QA report. ✅ (via the assertions inside the scenario steps + report collector)
- Variable substitution works for credentials. ✅ (tested + only at runtime)

---

## Phase 8: Multi-App Credential Support

**Goal:** Support different test credentials per project (PineForge, CloudcastAI, Cody).

**Status:** ✅ (completed)

### What to build

- Support env var pattern: `TEST_CREDENTIALS_<APP>_EMAIL` / `TEST_CREDENTIALS_<APP>_PASSWORD` (e.g. TEST_CREDENTIALS_CLOUDCASTAI_EMAIL).
- (Chose env scan over json file for v1; json could be future.)
- Agent selects by app context (e.g. "test the login on CloudcastAI") because all sets + names are listed in the elevated prompt block (model "knows" the values per app).
- All credential values (legacy + multi) registered with the sanitizer at startup.
- Backward compat for legacy single TEST_ACCOUNT_* and old $TEST_* placeholders.
- Extended to scenario substitution ($TEST_CREDENTIALS_<APP>_* supported in step values) and save-tool literal guard (blocks persisting real values for any app).
- No qa_select tool needed; handled via system prompt (lists available apps + per-app values under names).

### Implementation notes

- `src/config/env.ts`: schema .passthrough(), added getAppCredentials() parser (dynamic keys), updated getEnvSummary + added TestCredentials type (reexported).
- `src/agent/prompt.ts`: PromptContext now has testCredentials (legacy) + appCredentials (multi map). buildTestCredentials generalized to build per-app blocks (lists app names prominently + values; model instructed to pick by context). buildSystemPrompt updated. (Values still injected so model can use in fills, like legacy.)
- `src/agent/runner.ts`: AgentInput + buildSystemPrompt call now thread appCredentials.
- `src/index.ts`: parse legacy + appCredentials = getAppCredentials(env), register *all* secrets with sanitizer, log apps, pass both to bot creation + runAgentForChat closure + qaSaveScenario tool. qa save reg moved after parse.
- `src/telegram/bot.ts`: BotDependencies + destructure + usage in /qa-run (and inherited for LLM runs) now carry/pass appCredentials to executeScenarioSteps and implicitly to prompt via bound runner. Updated /qa-run opts.
- `src/tools/qa/scenario-runner.ts`: updated sub/execute to accept+use app map for $TEST_CREDENTIALS_<APP> placeholders (case insen regex), save tool accepts+guards against literals from legacy+all apps.
- Tests: prompt.test extended with multi block test; qa-scenarios.test still passes (legacy path); full suite +1 test (142 total).
- Also updated docs, env summary, etc. All values sanitized (registerSecret for every email/pass), never from chat, prompt rules etc.
- Legacy single still works unchanged for existing setups.

### Exit criteria

- Multiple credential sets work. ✅ (env parsed, prompt lists, sub supports)
- Agent picks the right one based on context. ✅ (via prompt block + model reasoning; e.g. task mentioning app name)
- All values sanitized. ✅ (at startup for every one; guard in save; sub only runtime)

---

## Phase 9: Viewport & Responsive Testing

**Goal:** Test apps at different screen sizes (mobile, tablet, desktop).

**Status:** ✅ (completed)

### What to build

Add a `browser_set_viewport` tool with presets:

| Preset | Dimensions |
|--------|-----------|
| `mobile` | 375 x 812 |
| `tablet` | 768 x 1024 |
| `desktop` | 1280 x 800 |
| `wide` | 1920 x 1080 |
| custom | `{ width, height }` |

### Implementation notes

- Added `browser_set_viewport` inside createBrowserTools in `src/tools/browser/mod.ts` (with VIEWPORT_PRESETS const, zod schema with refine for preset-or-custom, execute using page.setViewportSize on the persistent page from getOrCreatePage).
- Updated BrowserTools interface and return object.
- Registered in `src/index.ts` alongside other browser tools.
- Updated help text in `src/telegram/bot.ts` (and implicitly available in tool defs for model).
- New test file `tests/tools/browser-viewport.test.ts` (presets, custom, validation, query via page.viewportSize(), screenshot after set to confirm layout effect).
- Viewport changes affect screenshots/extracts as expected (verified in tests via size query post-set).
- No changes needed to QA reports (tool usage appears in response footers; "consider" was optional).
- All 143 tests, build, typecheck pass.

### Exit criteria

- Viewport tool works with presets and custom sizes. ✅
- Screenshots reflect the viewport change. ✅ (tool sets size; subsequent screenshots use it; tests confirm via page.viewportSize() and screenshot metadata)

---

## Phase 10: Accessibility Auditing

**Goal:** Catch accessibility issues automatically as part of QA runs.

**Status:** ✅ (completed)

### What to build

- Install `@axe-core/playwright` as a dependency.
- Add a `qa_accessibility_audit` tool that runs axe-core on the current page.
- Returns structured violations with severity (critical, serious, moderate, minor).
- Include a11y results in QA reports when the tool is used.

### Implementation notes

- Added `src/tools/qa/accessibility.ts` with `createQaAccessibilityTools` using `new AxeBuilder({page}).analyze()` (handles browser injection/eval internally).
- Tool `qa_accessibility_audit` (no args): returns JSON with summary + violations grouped by severity (critical/serious/moderate/minor), plus counts in metadata.
- Integrates with QA report: calls `recordAssertion` with synthetic entry (fail if critical/serious present) so a11y findings appear in structured reports from assertions or /qa-run scenarios.
- Registered in `src/index.ts` (after other qa tools).
- Updated help/start/status texts in `src/telegram/bot.ts`.
- New test `tests/tools/qa-accessibility.test.ts` (page with violations, "clean" page with 0 critical, and report recording integration).
- npm install done for dep; 150 tests, build, typecheck pass.
- No auto-run in scenarios (configurable per note, but not required for exit); agent can call tool explicitly.

### Exit criteria

- `qa_accessibility_audit` returns structured violation data. ✅
- Agent can include a11y findings in QA reports. ✅ (via record + tool result in runs)
- Tests cover: page with violations, clean page. ✅

---

## Summary

| Phase | Name | Dependencies | Effort |
|-------|------|-------------|--------|
| 1 | Assertion Tools | None | Medium |
| 2 | QA Report Builder | Phase 1 | Medium |
| 3 | Network & Console Observation | None | Medium |
| 4 | Wait Tools | None | Small |
| 5 | Raise Iteration Limit | None | Small |
| 6 | Terminal Allowlist Expansion | None | Small |
| 7 | Reusable Test Scenarios | Phases 1, 2 | Large |
| 8 | Multi-App Credentials | None | Medium |
| 9 | Viewport & Responsive Testing | None | Small |
| 10 | Accessibility Auditing | None | Medium |

Phases 1-5 are the core QA capabilities. Phases 6-10 are enhancements.

Phases 3, 4, 5, 6, 8, 9 have no dependencies and can be done in any order.
Phases 1 → 2 → 7 must be done in sequence.
