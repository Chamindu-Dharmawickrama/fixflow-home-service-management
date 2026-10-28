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
| T02 | API platform foundation | COMPLETED | T01 | 2026-10-28 |
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

- **Status:** COMPLETED (two non-blocking checks are pending in §4: the Upstash driver against a live database, and real SIGTERM/SIGINT shutdown)
- **Dependencies:** T01 (met). D-12 was `PROPOSED`; the owner confirmed it at the start of the session, so it is now `ACCEPTED` and the Upstash driver is implemented.
- **Work completed:**
  - `@fixflow/shared`: `ErrorCode` (the ten seeded codes plus `PAYLOAD_TOO_LARGE`), `LIMITS` (D-20 plus pagination bounds), and the envelope types (`ApiErrorBody`, `ApiResponse`, `PaginatedResponse`, `PaginationMeta`, `FieldErrors`, `SortOrder`).
  - `apps/server/src/config/env.ts`: Zod-validated, deeply frozen `Config`. Errors list variable **names** with a fixed "expected" text, never values. Production requires `WEB_ORIGIN` and the Upstash credentials, refuses the memory limiter, and requires `RATE_LIMIT_MULTIPLIER=1`. `config/dotenv.ts` loads a local `.env` in development and test only (resolves F-02).
  - `lib/logger.ts` (pino, pino-http, redaction, pretty output in development only, path without query string, response status only), `middleware/request-id.ts`, `lib/errors.ts` (`AppError` plus eight constructors), `lib/zod-errors.ts`, `middleware/error-handler.ts` (`AppError`, `ZodError`, body-parser 400/413, generic 500 logged with its stack through `res.err`), `middleware/not-found.ts`, `middleware/validate.ts` (typed `validate({ params, query, body })`, parsed values replace the raw input), `lib/pagination.ts` (`createPaginationSchema`, `toPrismaPage`, `paginated`), `lib/clock.ts` (`Clock`, `systemClock`, `FakeClock`).
  - `lib/rate-limit/`: `RateLimiter` interface, `MemoryRateLimiter` (sliding window on the injected clock, idle-key sweep), `UpstashRateLimiter` + `createUpstashRateLimiter` (`@upstash/ratelimit` sliding window, one limiter per distinct rule, timeout raised as an error), the `RATE_LIMITS` map with `resolveRateLimits({ multiplier, overrides })`, and `middleware/rate-limit.ts` (`rateLimit`, `rateLimitByName`, `clientIp`; 429 with `Retry-After`; fails open and logs if the store fails).
  - `app.ts`: `createApp(deps, { extraRouters })` in the mandated order (request ID → logger → helmet → CORS → body parsing → global rate limit → routes → 404 → error handler), `x-powered-by` disabled (resolves F-01), `trust proxy` from config. `deps.ts`: `AppDeps` and `createProductionDeps`. `server.ts`: fail-fast config, graceful SIGTERM/SIGINT shutdown (`lib/shutdown.ts`, 10 s grace period), fatal logging of unhandled rejections and exceptions.
  - Test harness `src/test/`: `buildTestApp`/`buildTestDeps`/`buildTestConfig`, a log-capture stream, throwaway test routes (`/api/v1/__test__/*`, mounted only when a test asks), and `expectApiError`/`bodyOf` helpers. `vitest.integration.config.ts` and a `test:integration` script in `@fixflow/server` separate `*.int.test.ts` (none yet).
  - Docs: `docs/API.md` and `docs/ARCHITECTURE.md` created; `apps/server/.env.example`, `README.md`, traceability, decisions (D-12 `ACCEPTED`, new D-57 `PROPOSED`) and `prompts/README.md` updated.
- **Dependencies added (all in `apps/server`):** `pino` (logger, in the approved stack), `pino-http` (request logging with request IDs, mandated by the prompt), `helmet` (security headers, in the stack), `zod` (validation, in the stack), `@upstash/ratelimit` and `@upstash/redis` (distributed rate limiting, D-12), `cors` and `@types/cors` (CORS restricted to `WEB_ORIGIN`, mandated by the prompt; not named in the stack table), `pino-pretty` (dev dependency; readable logs in development only).
- **Tests and verification (commands and actual results, final state):**
  - `npm run format:check` → exit 0. `npm run lint` → exit 0. `npm run typecheck` → exit 0 (shared, server, web, e2e). `npm run build` → exit 0.
  - `npm run test` → exit 0: **278 passed, 0 failed** (shared 14 in 3 files, server 261 in 18 files, web 3 in 1 file).
  - `npm run test:integration -w @fixflow/server` → exit 0 ("No test files found"; the script uses `--passWithNoTests` until T03 adds integration tests).
  - `npm run test:e2e` → exit 0: 2 passed in Chromium. This starts the API through `npm run dev:server` (`tsx watch`), so it exercises the new startup path and the web proxy.
  - Real processes: the compiled server in development mode (`PORT=4010`) returned `{"data":{"status":"ok"}}` with `x-request-id`, helmet headers and no `X-Powered-By`; an unknown path returned the 404 error body echoing the caller's `x-request-id`; CORS sent `Access-Control-Allow-Origin` and `-Credentials` to `http://localhost:3000` and nothing to `https://evil.example.com`. `NODE_ENV=production PORT=notaport node dist/server.js` exited with code 1 and printed `PORT: is invalid; expected an integer between 1 and 65535` (the secret token set alongside it was not printed). A production boot with a complete configuration and a fake Upstash host served health with JSON logs.
  - Test sensitivity (mutation) check: with redaction removed, the CORS origin check replaced by a plain string, or the 500 body leaking `error.message`, 21 tests failed; all were then reverted and the suites pass again.
  - Problems found and fixed during verification: (1) ESLint (type-aware) rejected untyped Supertest bodies, `expect.any(...)` inside object matchers, method-style function types and `String(req.id)`; fixed in the code and tests without relaxing any rule. (2) Booting the real server showed every log line carrying all response headers (about 1.5 kB with the CSP), so responses are now logged by status only. (3) Booting against an unreachable Upstash host showed requests taking 2 s with **no log**, because `@upstash/ratelimit` reports a timeout as success; the adapter now raises it as an error (logged, then fail-open) and the timeout is 1 s. Re-checked on the compiled server: the error is logged and the request returns 200 in about 1 s.
- **Acceptance criteria:**

  | # | Criterion | Result | Evidence |
  |---|---|---|---|
  | 1 | Missing required variable → non-zero exit, names variable, no values | Pass | `server.startup.test.ts` spawns the real `server.ts` (exit 1, names `WEB_ORIGIN`/`UPSTASH_REDIS_REST_URL`/`PORT`, values absent); `config/env.test.ts`; compiled-server check above |
  | 2 | Error contract for 400, 404, 413, 422, 429, 500; no stack in a 500 | Pass | `middleware/error-handler.test.ts` asserts status, `code`, `message`, `fieldErrors`, `requestId` and the absence of stack and internal message |
  | 3 | `x-request-id` on every response; valid incoming ID propagated | Pass | `middleware/request-id.test.ts` (success, 404, 500, 429, preflight; invalid IDs replaced) |
  | 4 | Logger redacts cookies, authorization, sensitive fields; test captures output | Pass | `lib/logger.test.ts` (direct logger and through the app) |
  | 5 | helmet headers; CORS allows `WEB_ORIGIN` with credentials, rejects others with no ACAO header | Pass | `middleware/security.test.ts` (look-alike hosts, other ports/schemes, `null`, preflight) |
  | 6 | Pagination schema rejects `pageSize > 100`, bad `sort`, bad `order` with 422; builder gives correct `skip`/`take` | Pass | `lib/pagination.test.ts`, `middleware/validate.test.ts` |
  | 7 | Memory limiter: 429 + `Retry-After` over the limit, resets after the window (fake clock) | Pass | `lib/rate-limit/memory.test.ts`, `middleware/rate-limit.test.ts` |
  | 8 | `GET /api/v1/health` still returns `{ data: { status: "ok" } }` with no database | Pass | `app.test.ts`; `AppDeps` has no database; E2E proxy smoke test; curl on the running server |
  | 9 | `docs/API.md` and `docs/ARCHITECTURE.md` exist and match the implementation | Pass | Written from the final code; the middleware order, limits, header names and error shapes were cross-checked against the tests |
- **Known issues / blockers:**
  - The Upstash driver is tested against a mocked client only (no credentials). Manual verification steps are in `docs/API.md` §7. See §4.
  - `SIGTERM`/`SIGINT` shutdown is unit-tested with a fake server and fake timers, but real signal delivery could not be tested: Windows does not deliver `SIGTERM` to Node, and the Docker daemon was not running. See §4.
  - While Redis is unreachable every request is delayed by up to 1 s and the API fails open (D-57). A circuit breaker would avoid the delay but is out of scope.
  - Configuration errors are reported in two passes: invalid or missing individual variables first, then cross-variable and production rules, so a second run can reveal more problems.
  - Express adds a weak `ETag` to JSON responses and no `Cache-Control`. Harmless for the current endpoints, but see F-07.
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
| F-01 | T01 | The API still sends `X-Powered-By: Express`. Remove it when helmet is added. | T02 | Resolved in T02 (`x-powered-by` disabled; asserted in `security.test.ts`) |
| F-02 | T01 | `--env-file-if-exists=.env` prints ".env not found. Continuing without it." twice on every API start without a `.env`. Decide whether T02's config loading should replace the flag. | T02 | Resolved in T02 (`.env` is loaded in code in development and test only; the flags were removed; D-57) |
| F-03 | T01 | `next.config.ts` reads `API_INTERNAL_URL` at **build** time (the rewrite destination is baked into the build manifest) and falls back to `http://localhost:4000`. A Vercel build that forgets the variable would proxy to localhost without any error. Set it in the Vercel project, and consider failing the build when `VERCEL` is set and the variable is not. | T09 | Open |
| F-04 | T01 | D-55: Cache Components needs `<Suspense>` around runtime reads, and routes stay mounted (`<Activity>`) after navigation. Design the shells and route protection with that in mind, and ask the owner to confirm D-55 first. | T04, T05 | Open |
| F-05 | T01 | D-53: revisit TypeScript 7 and ESLint 10 once `typescript-eslint` and the Next.js lint plugins support them (ESLint 9 is registry-deprecated). Also review the npm `allowScripts` warning for `esbuild` and `unrs-resolver`. | T25 | Open |
| F-06 | T02 | `axios` (`^1.21.0`) is declared in `apps/server/package.json` (it came with the T01 scaffold commit) but nothing imports it, it is not in the approved stack, and the T01 record does not mention it. Recommend removing it (`npm uninstall axios -w @fixflow/server`) unless the owner added it on purpose. Left untouched because it is outside T02's scope. | Owner decision, then any task | Open |
| F-07 | T02 | API responses carry a weak `ETag` and no `Cache-Control`. Before authenticated or customer-specific data is served (T05), decide whether to send `Cache-Control: no-store` on private responses and disable ETags, so neither a browser nor an intermediary reuses another session's data. | T05 | Open |
| F-08 | T02 | D-57: verify the real `TRUST_PROXY` hop count behind Vercel's rewrite and Render's load balancer, so the global per-IP limit and later per-IP limits key on the real client rather than a proxy (the production default is 1 hop and is unverified). Already part of T09's rate-limit keying check. | T09 | Open |
| F-09 | T02 | Add each task's named rate limits to `RATE_LIMITS` (`lib/rate-limit/limits.ts`) and attach them with `rateLimitByName`: login, register, google, forgot, reset, logout (T05), request submission (T11), quotation decisions (T15), demo-account writes (T24). | T05, T11, T15, T24 | Open |

## 4. Pending external verifications

Track checks that could not run because a credential or service was unavailable. Mark each one done when it has been performed.

| Check | Raised in | Needs | Status |
|---|---|---|---|
| Pressing Ctrl+C in `npm run dev` stops the shared watcher, API and web server and frees ports 3000 and 4000 | T01 | An interactive terminal (Windows PowerShell or Git Bash). Not verifiable in the non-interactive agent shell. | Pending |
| `.github/workflows/ci.yml` passes on GitHub Actions | T01 | The repository pushed to GitHub (a Linux container replay has already passed all steps) | Pending |
| The Upstash rate limiter works against a real Upstash Redis database: 4th request in a minute returns 429 with `Retry-After`, keys `fixflow:ratelimit:*` appear, and the counter survives an API restart | T02 | An Upstash database's REST URL and token. Steps are in `docs/API.md` §7 (use `RATE_LIMIT_MULTIPLIER=0.01`). The adapter itself is unit-tested with a mocked client. | Pending |
| A real `SIGTERM` (and Ctrl+C) makes the API stop accepting connections, finish in-flight requests, log "Shutting down" and exit 0 | T02 | A Linux shell or container (for example `docker run node:24-slim`, Docker daemon was not running) or an interactive terminal. Windows does not deliver `SIGTERM` to Node. The shutdown sequence is unit-tested with a fake server and timers. | Pending |
