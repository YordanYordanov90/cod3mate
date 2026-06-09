# Dashboard Implementation Plan

This document is the source of truth for adding a private dashboard to cod3mate.
It is intentionally split into small implementation sessions so backend, artifact
storage, frontend, deployment, and future demo chat work do not blur together.

## Goal

Build a private, read-only Next.js dashboard for the Telegram QA agent.

The dashboard will let the owner inspect QA projects, reports, failed checks, and
screenshots in a web UI instead of relying on Telegram messages for report review.

V1 is not a public SaaS, not a Telegram onboarding flow, and not an in-app agent
chat. Those can be added later as separate work.

## What Is Done So Far

- The Telegram agent is deployed on Railway and works for the whitelisted owner.
- The bot uses GrammY, OpenAI SDK, Zod, Playwright, Tavily, and Vitest.
- Owner-only Telegram access is enforced before commands, agent loop, or tools.
- Secrets and tool outputs are sanitized through `src/security/sanitize.ts`.
- QA tools are implemented:
  - browser navigation, click, fill, wait, viewport, screenshot, extract text
  - QA assertions
  - console and network checks
  - accessibility audit
  - saved scenarios
- QA reports are already persisted as JSON under `/data/qa-reports/`.
- QA scenarios are persisted under `/data/qa-scenarios/`.
- Screenshots are currently saved under `TMP_DIR/screenshots` and sent to
  Telegram during active QA runs.
- There is no HTTP server in the Railway app yet.
- There is no Next.js dashboard app yet.
- There is no Clerk setup yet.
- There is no Vercel deployment yet.

## Chosen V1 Architecture

```text
Telegram owner
  -> Railway agent service
     - GrammY bot
     - OpenAI tool loop
     - QA report storage under /data
     - durable QA screenshots under /data
     - private dashboard API

Vercel Next.js dashboard
  - Clerk auth
  - shadcn/ui
  - Zod validation
  - server-side calls to Railway dashboard API
```

Railway remains the source of truth for real QA reports and screenshots because
the data already lives on the Railway volume. Vercel cannot directly read that
volume, so the dashboard reads through a small authenticated Railway API.

## Access Model Change (2026-06-09)

The dashboard is a **public portfolio**, not an owner-only tool. Any signed-in
Clerk user may view it, and **all** QA reports and screenshots are shown — there
is no owner allowlist and no per-project curation.

- **No owner allowlist.** `DASHBOARD_ALLOWED_CLERK_USER_ID` /
  `DASHBOARD_ALLOWED_EMAIL` are removed. Clerk still gates sign-in (M8).
- **No curation.** `DASHBOARD_PUBLIC_PROJECTS` and `src/lib/curation.ts` were
  considered and then removed by owner decision. Every report/screenshot is
  visible to any signed-in user.
- **Implication (accepted):** screenshots may show logged-in states from test
  accounts (`TEST_ACCOUNT_*` / `TEST_CREDENTIALS_*`) and any tested project. Do
  not run QA against anything that must stay private while this model is in
  effect. If selective exposure is needed later, reintroduce a curation layer.

## Branch And Deployment Workflow

This repo deploys to **two independent services from two different branches**.
They are decoupled: they communicate only over HTTP + env vars, never over git.
Read this before doing agent or dashboard work so changes land in the right
place.

```text
main branch            -> Railway (agent service)
  - GrammY Telegram bot
  - OpenAI tool loop
  - QA reports + screenshots under /data
  - dashboard API (src/dashboard/*)   <- shared API contract

feature/dashboard      -> Vercel (Next.js dashboard, preview deploy)
  - apps/dashboard/*  (Root Directory = apps/dashboard)
  - Clerk auth
  - server-side fetch -> Railway dashboard API
```

### Where to work

| Change type | Branch | Redeploy needed |
| --- | --- | --- |
| Agent / bot / tools (`src/` except `src/dashboard/`) | `main` | Railway (auto on push) |
| Railway dashboard API (`src/dashboard/*`, report/screenshot shapes) | `main` | Railway, **then** sync to `feature/dashboard` |
| Dashboard UI / frontend (`apps/dashboard/*`) | `feature/dashboard` | Vercel (auto on push) |
| Shared report contract (Zod schemas on both sides) | `main` first, then merge into `feature/dashboard` | Railway + Vercel |

### Rules

1. **Agent work happens on `main`.** Railway deploys `main`.
2. **Dashboard UI work happens on `feature/dashboard`.** Vercel previews that
   branch (Root Directory `apps/dashboard`).
3. **Keep the branches in sync.** Regularly `git merge main` into
   `feature/dashboard` so the frontend's API expectations match what Railway is
   actually serving.
4. **API contract changes go to `main` first.** Anything that changes the
   Railway dashboard API (`src/dashboard/*`) or the report/screenshot JSON shape
   must land on `main` and deploy to Railway **before** the Vercel dashboard
   relies on it. Otherwise the dashboard gets `invalid_response` (schema drift)
   or `404`/empty data (missing route).
5. **Different branches do NOT break the agent ↔ dashboard link.** Connectivity
   depends only on env vars + a matching API contract, not on git branches.

### What can break (and the fix)

- **Schema drift:** report JSON / API route changes on `main` + Railway deploy,
  but `feature/dashboard` still has old Zod schemas → merge `main` into the
  dashboard branch.
- **Missing route:** dashboard calls a new API on `feature/dashboard` that
  Railway (`main`) doesn't serve yet → land the backend route on `main` + deploy
  Railway first.
- **Env mismatch:** Vercel `DASHBOARD_API_TOKEN` must equal Railway's;
  `DASHBOARD_API_BASE_URL` must point at the live Railway URL.

### Promoting to production (later)

When the dashboard is production-ready: merge `feature/dashboard` -> `main`,
then point the Vercel production branch at `main` (or keep the preview workflow
until then). See Milestone 12.

## Security Rules

- Telegram remains owner-only (unchanged and unaffected by the dashboard).
- The dashboard is read-only.
- Dashboard sign-in uses Clerk (any authenticated user may view all reports).
- Railway dashboard API uses server-to-server bearer token auth.
- Vercel must never expose `DASHBOARD_API_TOKEN` to the browser.
- Dashboard API responses must be sanitized before returning data.
- Screenshots are served only through the authenticated server-side proxy
  (token never reaches the browser), with safe path resolution and containment.
- No dashboard-triggered agent runs.
- No terminal, file, browser, or OpenAI tool execution from the dashboard.
- No connection flow between dashboard users and Telegram.

## Implementation Milestones

### Milestone 0 - Planning Branch And Plan File

Status: complete.

Purpose: create the docs-only planning foundation before code work.

Steps:

1. Create or switch to branch `feature/dashboard`.
2. Add `context/dashboard.md`.
3. Document the current state, architecture, security model, implementation
   phases, and future demo chat direction.
4. Do not change runtime code.
5. Do not scaffold Next.js.
6. Do not add API routes.
7. Do not modify production behavior.

Verification:

- `git status --short --branch` shows branch `feature/dashboard`.
- Only docs are changed.
- No `.env`, `/data`, `/tmp`, screenshots, generated files, or secrets are
  staged.

### Milestone 1 - Context And Scope Update

Purpose: officially bring the dashboard into project scope.

Steps:

1. Update `context/project-overview.md` to include private dashboard v1 as a
   future feature now being implemented.
2. Update `context/architecture.md` with the Railway dashboard API and Vercel
   dashboard relationship.
3. Update `context/ui-context.md` with the new dashboard UI surface.
4. Update `context/progress-tracker.md` with a new dashboard section.
5. Keep all existing security invariants intact.
6. Add new dashboard invariants:
   - private Clerk-protected dashboard
   - server-to-server Railway API token
   - private screenshot artifacts
   - no dashboard-triggered agent/tool execution in v1

What not to do:

- Do not add code.
- Do not add dependencies.
- Do not change package scripts.

Verification:

- Context docs clearly separate private dashboard v1 from future portfolio demo
  chat.
- The docs no longer imply that dashboard work is out of scope.

### Milestone 2 - Backend Report Contract

Status: complete.

Purpose: define report shapes for dashboard use without building API routes.

Steps:

1. Add Zod schemas for dashboard report data.
2. Keep compatibility with existing saved QA reports.
3. Normalize stored reports into dashboard-friendly data.
4. Include fields:
   - `id`
   - `title`
   - `project`
   - `startedAt`
   - `endedAt`
   - `durationMs`
   - `summary`
   - `entries`
   - `screenshots`
5. Default project grouping:
   - infer project from target URL hostname when available
   - otherwise use `unknown`
6. Add tests for old report compatibility and project fallback.

What not to do:

- Do not add HTTP routes.
- Do not add screenshot serving.
- Do not add frontend code.

Verification:

- `npm run test:run`
- `npm run build`
- `npm run typecheck`

### Milestone 3 - Durable Screenshot Artifacts

Status: complete.

Purpose: make screenshots available to the future dashboard.

Steps:

1. Add durable artifact storage under `/data/qa-artifacts/screenshots/`.
2. During active QA collection, copy or save screenshots into a report-scoped
   durable folder.
3. Extend saved QA report JSON with screenshot metadata.
4. Preserve existing Telegram screenshot delivery.
5. Preserve existing transient `TMP_DIR/screenshots` behavior for normal tool
   calls.
6. Add path safety helpers for durable screenshot files.
7. Use the same containment pattern as file sandboxing: resolved root plus
   `path.sep`.

What not to do:

- Do not add dashboard API routes.
- Do not add frontend code.
- Do not make screenshots public.

Verification:

- Tests cover durable screenshot path safety.
- Tests cover screenshot metadata in saved reports.
- Manual smoke: run a QA task and confirm:
  - Telegram still receives screenshots
  - report JSON references durable screenshot metadata
  - no secrets appear in the report
- `npm run test:run`
- `npm run build`
- `npm run typecheck`

### Milestone 4 - Railway Dashboard API Foundation

Status: complete.

Purpose: add the smallest HTTP layer with auth and health only.

Steps:

1. Add an HTTP server using Node built-in `http`.
2. Add env vars:
   - `DASHBOARD_API_ENABLED`
   - `DASHBOARD_API_TOKEN`
   - `DASHBOARD_API_PORT` or Railway `PORT`
3. Start the HTTP server only when enabled.
4. Add endpoints:
   - `GET /health`
   - `GET /api/dashboard/health`
5. Require bearer token auth for dashboard API routes.
6. Keep bot polling unchanged.
7. Add graceful shutdown for the HTTP server.

What not to do:

- Do not add report list/detail routes yet.
- Do not add screenshot routes yet.
- Do not add frontend code.

Verification:

- Tests cover API disabled mode.
- Tests cover missing, invalid, and valid bearer token.
- Local smoke with `curl`.
- Bot startup still works.
- `npm run test:run`
- `npm run build`
- `npm run typecheck`

### Milestone 5 - Railway Reports API

Status: complete.

Purpose: expose read-only report list and report detail data.

Steps:

1. Add `GET /api/dashboard/projects`.
2. Add `GET /api/dashboard/reports?project=&limit=&cursor=`.
3. Add `GET /api/dashboard/reports/:id`.
4. Read from `/data/qa-reports/`.
5. Normalize all reports through the dashboard report contract.
6. Sanitize response strings.
7. Ignore corrupt report files safely.
8. Support old report JSON files that do not yet include screenshots or project
   metadata.

What not to do:

- Do not serve screenshot binaries yet.
- Do not add frontend code.
- Do not add write, update, or delete routes.

Verification:

- Tests cover report sorting.
- Tests cover project filtering.
- Tests cover limit and cursor behavior if cursor is implemented in this
  milestone.
- Tests cover missing report.
- Tests cover corrupt report ignored.
- Tests cover auth required.
- `npm run test:run`
- `npm run build`
- `npm run typecheck`

### Milestone 6 - Railway Screenshot API

Status: complete.

Purpose: serve private screenshot artifacts safely.

Steps:

1. Add `GET /api/dashboard/reports/:id/screenshots`.
2. Add `GET /api/dashboard/screenshots/:reportId/:filename`.
3. Require bearer token auth.
4. Serve only files inside `/data/qa-artifacts/screenshots/`.
5. Reject traversal attempts.
6. Reject unknown report IDs.
7. Reject unsupported extensions.
8. Return safe image headers:
   - `Content-Type`
   - `Cache-Control: private, max-age=300`

What not to do:

- Do not add frontend code.
- Do not expose screenshots as public static assets.
- Do not serve files outside the durable artifact root.

Verification:

- Tests cover valid image response.
- Tests cover missing file.
- Tests cover invalid extension.
- Tests cover traversal attempts.
- Tests cover auth required.
- Manual smoke with one real screenshot.
- `npm run test:run`
- `npm run build`
- `npm run typecheck`

### Milestone 7 - Next.js Dashboard Scaffold

Status: complete.

Purpose: add frontend app structure without dashboard features.

Steps:

1. Convert the repo to npm workspaces.
2. Add `apps/dashboard`.
3. Add Next.js App Router with TypeScript.
4. Add Tailwind.
5. Add shadcn/ui base setup.
6. Add Clerk dependencies.
7. Add dashboard env validation with Zod.
8. Add placeholder pages only:
   - `/`
   - `/reports`
   - `/reports/[id]`
9. Keep backend scripts working.

Dashboard env:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `DASHBOARD_API_BASE_URL`
- `DASHBOARD_API_TOKEN`
- (no owner allowlist / no curation env — all reports are shown)

What not to do:

- Do not build full report UI.
- Do not call Railway API yet.
- Do not change backend runtime behavior.

Verification:

- Backend checks still work.
- Dashboard build works.
- Workspace scripts clearly separate backend and dashboard commands.

### Milestone 8 - Clerk-Protected Dashboard Shell

Status: complete. Built after M7 -> M9 -> M10 -> M11 per the deferred build
order. Clerk is a privacy gate, not a dependency for the data/UI work (M9 only
needs `DASHBOARD_API_BASE_URL` + `DASHBOARD_API_TOKEN`; M10/M11 just render
data), so those were developed locally without auth first.

Hard constraint: Milestone 8 (Clerk sign-in) MUST be completed before
Milestone 12 (Vercel deployment). The dashboard must never be deployed without
Clerk auth gating sign-in. Note: as of 2026-06-09 the dashboard is a public
portfolio — any signed-in user may view all reports (no owner allowlist, no
curation).

Implementation notes:

- `@clerk/nextjs` v7 (current SDK). Next.js 16 uses `proxy.ts` (not
  `middleware.ts`); Clerk middleware lives at `apps/dashboard/src/proxy.ts`.
- `ClerkProvider` is mounted inside `<body>` in the root layout with the
  `dynamic` prop and the `@clerk/ui` `shadcn` theme (matches the dark shadcn
  design system; `@clerk/ui/themes/shadcn.css` imported in `globals.css`).
- `proxy.ts` protects every route except `/sign-in(.*)` and `/sign-up(.*)`;
  `auth.protect()` redirects signed-out users to the sign-in page.
- **Access model updated 2026-06-09 (see "Access Model Change" above):** the
  owner allowlist was removed, then the `DASHBOARD_PUBLIC_PROJECTS` curation
  layer was also removed by owner decision. Any signed-in Clerk user may view
  all reports. `src/lib/auth.ts` is just `isSignedIn()` (authentication only);
  `checkOwner`/`isOwner`, the `Unauthorized` state, and `curation.ts` are gone.
- Authenticated shell: a `(dashboard)` route group layout renders a top bar with
  the Clerk `UserButton` for any signed-in user (no owner gate).
- Custom auth pages: `app/sign-in/[[...sign-in]]` and
  `app/sign-up/[[...sign-up]]`.
- The screenshot proxy route (`/api/screenshots/...`) checks `isSignedIn()` and
  streams the binary (token stays server-side); no per-project gate.

Purpose: gate the portfolio dashboard behind Clerk sign-in before deployment.

Steps:

1. Add Clerk provider.
2. Add Clerk middleware.
3. Add authenticated shell layout (any signed-in user).
4. Add unauthenticated state (redirect to sign-in).
5. Keep routes read-only.

What not to do:

- Do not call Railway API yet.
- Do not show real reports yet.
- Do not add agent chat.

Verification:

- Signed-out user is redirected to sign-in.
- Signed-in user reaches the dashboard shell and sees all reports.
- Dashboard build passes.

### Milestone 9 - Dashboard API Client

Status: complete.

Purpose: connect the dashboard server-side code to Railway.

Steps:

1. Add a server-only Railway dashboard API client.
2. Include `DASHBOARD_API_TOKEN` only in server-side requests.
3. Validate responses with Zod.
4. Add helpers:
   - `listProjects`
   - `listReports`
   - `getReport`
   - `getReportScreenshots`
5. Add typed error handling for unavailable Railway API, invalid schema, and
   auth failure.

What not to do:

- Do not build the full UI yet.
- Do not expose the Railway token to client components.
- Do not add dashboard-triggered agent runs.

Verification:

- Tests mock `fetch`.
- Tests cover success.
- Tests cover invalid schema.
- Tests cover Railway auth failure.
- Tests cover Railway unavailable.
- Dashboard build passes.

### Milestone 10 - Reports Overview UI

Status: complete.

Purpose: build the first useful dashboard screen.

Steps:

1. Make `/` the reports dashboard, not a marketing page.
2. Add project filter.
3. Add summary cards:
   - total runs
   - pass rate
   - failed checks
   - latest run
4. Add recent reports table.
5. Show status badges for pass/fail.
6. Add empty state.
7. Add error state.
8. Add loading/skeleton states where appropriate.
9. Keep the design dense, calm, and operational.

What not to do:

- Do not add report detail screenshot gallery in this milestone.
- Do not add public portfolio pages.
- Do not add agent chat.

Verification:

- Manual desktop viewport check.
- Manual mobile viewport check.
- No text overflow.
- Dashboard build passes.

### Milestone 11 - Report Detail And Screenshot Gallery UI

Status: complete.

Purpose: inspect one report deeply.

Steps:

1. Build `/reports/[id]`.
2. Show:
   - title
   - project
   - date
   - duration
   - pass/fail summary
3. Show failed checks first.
4. Show full assertion list.
5. Show details text safely.
6. Add screenshot gallery.
7. Load screenshots through authenticated server-side proxying or private
   Railway API calls.
8. Add empty state for reports without screenshots.
9. Add old-report compatibility UI for missing optional metadata.

What not to do:

- Do not expose screenshots publicly.
- Do not add report deletion.
- Do not add rerun buttons.
- Do not add agent chat.

Verification:

- Manual QA with a report that has no screenshots.
- Manual QA with a report that has multiple screenshots.
- Manual QA with failed assertions.
- Manual QA with old report JSON.
- Dashboard build passes.

### Milestone 12 - Deployment

Purpose: deploy the portfolio dashboard after backend and frontend are verified.

Precondition: Milestone 8 (Clerk sign-in shell) must be complete before this
milestone. Do not deploy without Clerk auth. Note: any signed-in user sees all
reports (no curation), so only run QA against projects you're fine exposing.

Railway steps:

1. Set `DASHBOARD_API_ENABLED=true`.
2. Set `DASHBOARD_API_TOKEN`.
3. Confirm service URL.
4. Confirm bot still polls Telegram.
5. Confirm dashboard API health endpoint works.

Vercel steps:

1. Deploy `apps/dashboard`.
2. Configure Clerk env vars.
3. Configure `DASHBOARD_API_BASE_URL`.
4. Configure `DASHBOARD_API_TOKEN`.
5. (no curation env to configure.)

Verification:

- Signed-in user can log in and view all reports.
- Report list loads.
- Report detail loads.
- Screenshots render.
- Signed-out user is blocked.
- Railway API rejects missing token.
- Railway API rejects invalid token.

## Future Portfolio Demo Chat

Do not implement this in v1.

Future demo chat should be a separate surface, likely under `/demo`, with separate
storage and stricter tool access.

Recommended constraints:

- No Telegram connection flow.
- No access to private `/data`.
- No access to private reports or screenshots.
- No terminal tool.
- No arbitrary file read/write.
- Browser QA only against approved demo URLs.
- Demo scenarios only.
- Demo credentials only from safe env vars.
- Strict rate limits.
- Clear separation between private dashboard data and demo data.

## Public Interfaces Planned For V1

Railway API:

- `GET /health`
- `GET /api/dashboard/health`
- `GET /api/dashboard/projects`
- `GET /api/dashboard/reports?project=&limit=&cursor=`
- `GET /api/dashboard/reports/:id`
- `GET /api/dashboard/reports/:id/screenshots`
- `GET /api/dashboard/screenshots/:reportId/:filename`

Backend env:

- `DASHBOARD_API_ENABLED`
- `DASHBOARD_API_TOKEN`
- `DASHBOARD_API_PORT` or Railway `PORT`

Dashboard env:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `DASHBOARD_API_BASE_URL`
- `DASHBOARD_API_TOKEN`
- (no owner allowlist / no curation env — all reports are shown)

## Defaults And Assumptions

- Dashboard app will live in the same repo under `apps/dashboard`.
- Dashboard v1 is private and read-only.
- Backend and frontend work happen in separate sessions.
- No CRUD-style dashboard routes in v1.
- No dashboard-triggered QA runs in v1.
- No database in v1.
- Railway remains the source of truth for real QA reports.
- Vercel talks to Railway server-side.
- Clerk protects the dashboard UI.
- Server-to-server token protects Railway API.
- Project grouping defaults to target hostname when available.
- Missing project becomes `unknown`.
- Durable screenshots live under `/data/qa-artifacts`.
- Screenshots are private.

## Milestone Completion Checklist

Before closing any implementation milestone:

1. Confirm no security invariant was weakened.
2. Confirm no secrets or sensitive screenshots are staged.
3. Run the milestone-specific tests.
4. Run backend checks when backend code changed:
   - `npm run build`
   - `npm run test:run`
   - `npm run typecheck`
5. Run dashboard checks when dashboard code changed.
6. Update this file with completed status.
7. Update `context/progress-tracker.md` when meaningful work is completed.
