# FixFlow — Implementation Progress

Persistent tracker for implementation sessions. Update it at the start of a task (`IN_PROGRESS`) and again at the end.

**Rules**
- Status values: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `COMPLETED`.
- `COMPLETED` means **every** acceptance criterion in the task prompt is met **and** the required verification was actually run and passed. Code that is written but has failing, skipped or unrun checks is `IN_PROGRESS` (or `BLOCKED`, with the blocker named).
- Record the commands you ran and their **actual** results (for example "`npm run test` — 142 passed, 0 failed"). Do not paraphrase a failure as a success.
- Write follow-ups and out-of-scope discoveries in §3. Do not implement them silently.
- Use absolute dates (YYYY-MM-DD).

## 1. Summary

| Task | Name | Status | Depends on | Last updated |
|---|---|---|---|---|
| T01 | Repository, tooling & CI foundation | COMPLETED | — | 2026-10-28 |
| T02 | API platform foundation | NOT_STARTED | T01 | 2026-10-28 |
| T03 | Database schema, migrations & base seed | NOT_STARTED | T02 | 2026-10-28 |
| T04 | Design system, UI primitives & application shells | NOT_STARTED | T01 | 2026-10-28 |
| T05 | Authentication, sessions & access control | NOT_STARTED | T03, T04 | 2026-10-28 |
| T06 | Activity timeline, notifications & email infrastructure | NOT_STARTED | T05 | 2026-10-28 |
| T07 | Business settings & service catalogue management | NOT_STARTED | T06 | 2026-10-28 |
| T08 | Public website & service pages | NOT_STARTED | T07 | 2026-10-28 |
| T09 | Hosted preview deployment (walking skeleton) | NOT_STARTED | T08 | 2026-10-28 |
| T10 | Customer profile & service addresses | NOT_STARTED | T05, T06 | 2026-10-28 |
| T11 | Service request submission & customer request tracking | NOT_STARTED | T07, T10 | 2026-10-28 |
| T12 | Admin request queue & request review | NOT_STARTED | T11 | 2026-10-28 |
| T13 | Admin customer management | NOT_STARTED | T12 | 2026-10-28 |
| T14 | Quotation builder, sending & replacement (admin) | NOT_STARTED | T12 | 2026-10-28 |
| T15 | Customer quotation review & decision | NOT_STARTED | T14 | 2026-10-28 |
| T16 | Technician resource management | NOT_STARTED | T05 | 2026-10-28 |
| T17 | Work-order conversion, scheduling & assignment | NOT_STARTED | T15, T16 | 2026-10-28 |
| T18 | Job lifecycle, completion & customer job tracking | NOT_STARTED | T17 | 2026-10-28 |
| T19 | Scheduling calendar | NOT_STARTED | T17 | 2026-10-28 |
| T20 | Invoice drafting, issuance & voiding | NOT_STARTED | T18 | 2026-10-28 |
| T21 | Manual payment recording & corrections | NOT_STARTED | T20 | 2026-10-28 |
| T22 | Invoice PDF & customer invoice portal | NOT_STARTED | T21 | 2026-10-28 |
| T23 | Admin dashboard, portal overview & list exports | NOT_STARTED | T22 | 2026-10-28 |
| T24 | Showcase demo data & demo-mode safeguards | NOT_STARTED | T23 | 2026-10-28 |
| T25 | End-to-end journey, accessibility & quality hardening | NOT_STARTED | T24 | 2026-10-28 |
| T26 | Production demo release | NOT_STARTED | T09, T25 | 2026-10-28 |
| T27 | Documentation & portfolio package | NOT_STARTED | T26 | 2026-10-28 |

**Planning phase:** completed 2026-10-28. It produced `CLAUDE.md`, `prompts/` (27 task prompts plus an index), `docs/IMPLEMENTATION_PLAN.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/DECISIONS_AND_OPEN_QUESTIONS.md` and this file. No application code was written.

**Before T01:** install Node.js 24 LTS (D-05 / Q-07). Before T04 and T05, review the `PROPOSED` decisions they depend on (see `prompts/README.md`).

## 2. Task log

### T01 — Repository, tooling & CI foundation

- **Status:** COMPLETED (two non-blocking checks are pending in §4: Ctrl+C shutdown and the first GitHub Actions run)
- **Dependencies:** — (Node 24 prerequisite met: v24.22.1)
- **Work completed:**
  - Root npm-workspaces monorepo (`packages/*`, `apps/*`, `e2e`), `.nvmrc` `24`, `engines` `>=24 <25`, `packageManager` `npm@10.9.2`, one root `package-lock.json`.
  - `apps/web`: Next.js 16.4.3 (App Router, Tailwind v4, `src/`, `@/*`) from `create-next-app`, boilerplate removed (Google-font fetch, logos, favicon, dark theme), neutral placeholder page. `/api/v1/:path*` rewrites to `${API_INTERNAL_URL}/api/v1/:path*` (default `http://localhost:4000`). `lib/api/paths.ts` (`apiPath`) is the first real import of `@fixflow/shared`.
  - `apps/api`: Express 5, ESM; `createApp()` in `app.ts`, `server.ts` (validates `PORT`, closes cleanly on SIGINT/SIGTERM), `GET /api/v1/health` returning `{ "data": { "status": "ok" } }` from `modules/health`.
  - `packages/shared` (`@fixflow/shared`): builds to `dist` with declarations; exports `API_PREFIX`. Imported by the API (`app.ts`) and the web app (`next.config.ts`, `lib/api/paths.ts`).
  - `e2e`: Playwright (Chromium) with a config that starts or reuses both servers, plus a two-test smoke spec.
  - Tooling: `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, all kept), ESLint 9 flat config (type-aware typescript-eslint everywhere, Next rules for `apps/web`, `simple-import-sort`), Prettier, Vitest in three workspaces, `concurrently` dev script, `.gitignore`, `.editorconfig`, `.gitattributes`, `.env.example` for each app, `.github/workflows/ci.yml`, README skeleton.
  - Docs: `CLAUDE.md` §6 (added `format` commands and the browser install), `docs/DECISIONS_AND_OPEN_QUESTIONS.md` (D-53, D-54, D-55, all `PROPOSED`), `docs/REQUIREMENTS_TRACEABILITY.md`, `prompts/README.md`.
- **Tests and verification (commands and actual results):**
  - `node --version` → v24.22.1; `npm --version` → 10.9.2.
  - `npm install` → exit 0, 497 packages, 0 vulnerabilities, a single `package-lock.json`.
  - `npm run format:check` → exit 0. `npm run lint` → exit 0. `npm run typecheck` → exit 0 (shared, api, web, e2e). `npm run build` → exit 0 (shared, api, web; Next.js 16.4.3 Turbopack; `/` and `/_not-found` prerendered).
  - `npm run test` → exit 0: 8 passed, 0 failed (shared 3, api 2, web 3).
  - `npm run dev` → web on :3000 and API on :4000 (coloured `[shared]`/`[api]`/`[web]` prefixes). `curl http://localhost:4000/api/v1/health` and `curl http://localhost:3000/api/v1/health` both returned `{"data":{"status":"ok"}}`; the proxied response carried `x-powered-by: Express`, so the API served it. An unknown path through the proxy returned the API's 404. The compiled API (`node apps/api/dist/server.js`, `PORT=4010`) also served the health route, so `@fixflow/shared` resolves at runtime. An invalid `PORT` aborts startup.
  - `npm run test:e2e` → exit 0: 2 passed in Chromium, both against already-running servers and with Playwright starting (and afterwards stopping) both servers.
  - Failure propagation: a deliberately failing test planted in `packages/shared` made `npm run test` exit 1 while `api` and `web` still ran (planted file removed).
  - CI replay: the CI steps (`npm ci`, then `format:check`, `lint`, `typecheck`, `test`, `build`) ran in a clean Linux container (`node:24-slim`, Node v24.22.1, npm 11.19.1) and every step exited 0. The workflow YAML parses and its steps match the local scripts. The lockfile contains the Linux native packages. **This is not a GitHub Actions run.**
  - Problems found and fixed during verification: (1) lint crashed on `vitest.config.mts` because `eslint-config-next` only assigns the TypeScript parser to `.ts`/`.tsx`; I added a parser override and proved with a temporary probe file that type-aware rules (`no-floating-promises`) run on `.mts`; (2) the first container replay printed "ALL STEPS PASSED" although lint had failed, because my harness piped each step through `tail` and hid the exit status; I re-ran it with `pipefail` and per-step exit checks.
- **Known issues / blockers:**
  - Ctrl+C shutdown of `npm run dev` could **not** be verified: in this non-interactive environment even a trivial Node script with a SIGINT handler ignored a genuine `CTRL_C_EVENT`, so the test method was invalid. A forced tree-kill leaves no orphan processes and frees both ports. See §4.
  - ESLint 9.39.5 is flagged deprecated by the registry; TypeScript is held at 6.0.x. Both are forced by peer dependencies (D-53).
  - npm 11.19 warns that the `esbuild` and `unrs-resolver` install scripts are "not yet covered by allowScripts". It is only a warning today; a later npm may block them.
  - The `packages/*`-first order in the root `workspaces` is load-bearing for `npm run build` (D-54).
  - `playwright install chromium` pruned older Playwright browser builds from the global cache (`%LOCALAPPDATA%\ms-playwright`); other projects pinned to an older Playwright need `npx playwright install` again.
- **Later change (2026-10-28, owner request, D-56):** the backend folder `apps/api` was renamed to `apps/server` and its package `@fixflow/api` to `@fixflow/server`. The paths and commands in this entry are as originally recorded.
- **Last updated:** 2026-10-28

### T02 — API platform foundation

- **Status:** NOT_STARTED
- **Dependencies:** T01
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T03 — Database schema, migrations & base seed

- **Status:** NOT_STARTED
- **Dependencies:** T02
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T04 — Design system, UI primitives & application shells

- **Status:** NOT_STARTED
- **Dependencies:** T01
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T05 — Authentication, sessions & access control

- **Status:** NOT_STARTED
- **Dependencies:** T03, T04
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T06 — Activity timeline, notifications & email infrastructure

- **Status:** NOT_STARTED
- **Dependencies:** T05
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T07 — Business settings & service catalogue management

- **Status:** NOT_STARTED
- **Dependencies:** T06
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T08 — Public website & service pages

- **Status:** NOT_STARTED
- **Dependencies:** T07
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T09 — Hosted preview deployment (walking skeleton)

- **Status:** NOT_STARTED
- **Dependencies:** T08
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T10 — Customer profile & service addresses

- **Status:** NOT_STARTED
- **Dependencies:** T05, T06
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T11 — Service request submission & customer request tracking

- **Status:** NOT_STARTED
- **Dependencies:** T07, T10
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T12 — Admin request queue & request review

- **Status:** NOT_STARTED
- **Dependencies:** T11
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T13 — Admin customer management

- **Status:** NOT_STARTED
- **Dependencies:** T12
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T14 — Quotation builder, sending & replacement (admin)

- **Status:** NOT_STARTED
- **Dependencies:** T12
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T15 — Customer quotation review & decision

- **Status:** NOT_STARTED
- **Dependencies:** T14
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T16 — Technician resource management

- **Status:** NOT_STARTED
- **Dependencies:** T05
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T17 — Work-order conversion, scheduling & assignment

- **Status:** NOT_STARTED
- **Dependencies:** T15, T16
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T18 — Job lifecycle, completion & customer job tracking

- **Status:** NOT_STARTED
- **Dependencies:** T17
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T19 — Scheduling calendar

- **Status:** NOT_STARTED
- **Dependencies:** T17
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T20 — Invoice drafting, issuance & voiding

- **Status:** NOT_STARTED
- **Dependencies:** T18
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T21 — Manual payment recording & corrections

- **Status:** NOT_STARTED
- **Dependencies:** T20
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T22 — Invoice PDF & customer invoice portal

- **Status:** NOT_STARTED
- **Dependencies:** T21
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T23 — Admin dashboard, portal overview & list exports

- **Status:** NOT_STARTED
- **Dependencies:** T22
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T24 — Showcase demo data & demo-mode safeguards

- **Status:** NOT_STARTED
- **Dependencies:** T23
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T25 — End-to-end journey, accessibility & quality hardening

- **Status:** NOT_STARTED
- **Dependencies:** T24
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T26 — Production demo release

- **Status:** NOT_STARTED
- **Dependencies:** T09, T25
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

### T27 — Documentation & portfolio package

- **Status:** NOT_STARTED
- **Dependencies:** T26
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
- **Last updated:** 2026-10-28

## 3. Follow-ups and deferred items

| ID | Raised in | Description | Proposed task | Status |
|---|---|---|---|---|
| F-01 | T01 | The API still sends `X-Powered-By: Express`. Remove it when helmet is added. | T02 | Open |
| F-02 | T01 | `--env-file-if-exists=.env` prints ".env not found. Continuing without it." twice on every API start without a `.env`. Decide whether T02's config loading should replace the flag. | T02 | Open |
| F-03 | T01 | `next.config.ts` reads `API_INTERNAL_URL` at **build** time (the rewrite destination is baked into the build manifest) and falls back to `http://localhost:4000`. A Vercel build that forgets the variable would proxy to localhost without any error. Set it in the Vercel project, and consider failing the build when `VERCEL` is set and the variable is not. | T09 | Open |
| F-04 | T01 | D-55: Cache Components needs `<Suspense>` around runtime reads, and routes stay mounted (`<Activity>`) after navigation. Design the shells and route protection with that in mind, and ask the owner to confirm D-55 first. | T04, T05 | Open |
| F-05 | T01 | D-53: revisit TypeScript 7 and ESLint 10 once `typescript-eslint` and the Next.js lint plugins support them (ESLint 9 is registry-deprecated). Also review the npm `allowScripts` warning for `esbuild` and `unrs-resolver`. | T25 | Open |

## 4. Pending external verifications

Track checks that could not run because a credential or service was unavailable. Mark each one done when it has been performed.

| Check | Raised in | Needs | Status |
|---|---|---|---|
| Pressing Ctrl+C in `npm run dev` stops the shared watcher, API and web server and frees ports 3000 and 4000 | T01 | An interactive terminal (Windows PowerShell or Git Bash). Not verifiable in the non-interactive agent shell. | Pending |
| `.github/workflows/ci.yml` passes on GitHub Actions | T01 | The repository pushed to GitHub (a Linux container replay has already passed all steps) | Pending |
