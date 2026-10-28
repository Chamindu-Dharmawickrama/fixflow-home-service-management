# T02 — API Platform Foundation

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T02 |
| Title | API platform foundation |
| Phase | 1 — Foundation |
| Objective | Give the Express API its cross-cutting platform: validated configuration, structured and redacted logging, security middleware, a consistent error contract, request validation, pagination, a clock, rate limiting, and an app factory with a test harness. Every later module builds on these. |

## B. Context

- Read first: `CLAUDE.md` §7–§9 and §11; spec §13.2–13.3, §14.5, §15.1–15.2, §16 (Observability, Security, Portability), §21.2.
- Decisions: D-12 (Upstash rate limiting, **PROPOSED**; confirm before implementing the Upstash adapter), D-14 (health), D-20 (validation limits), D-33 (error conventions), D-34 (pagination), D-11 (CSRF; middleware lands in T05), D-06 (`trust proxy` behind Vercel/Render).
- Requirements: API-01…API-04, NFR-04, NFR-07, NFR-09, NFR-10, SEC-DATA-04, SEC-AUTH-06 (mechanism), BR-06 (limits constants), DEP-02.

## C. Prerequisites

- T01 `COMPLETED`: the monorepo, `createApp()`, `/api/v1/health` and Vitest + Supertest exist.

## D. Scope

**In scope**
- `src/config/env.ts`: a Zod schema for all API env vars known now: `NODE_ENV`, `PORT`, `LOG_LEVEL`, `WEB_ORIGIN`, `TRUST_PROXY`, `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (optional as a pair), `RATE_LIMIT_DRIVER` (`memory`|`upstash`, defaulting to `upstash` when credentials exist, otherwise `memory`; never `memory` silently in production — fail fast instead). It parses once and exports a typed, frozen config. On failure it lists the **names** of missing or invalid variables and never prints values. Later tasks extend this schema.
- `src/lib/logger.ts`: pino, plus pino-http with a request ID (accept an incoming `x-request-id` if it is valid, else generate a UUID; echo it in the response header). Pretty output in dev only. Redaction covers `req.headers.cookie`, `req.headers.authorization`, `res.headers["set-cookie"]`, and any body/field named `credential`, `token`, `password`, `secret`. Request bodies are not logged by default.
- Security: `helmet` (API defaults), CORS limited to `WEB_ORIGIN` with credentials, `app.disable('x-powered-by')`, `trust proxy` from config, JSON body limit (100 kb), `express.json()` strict.
- Error model: `AppError` (status, code, message, optional `fieldErrors`, optional safe `details`) with helper constructors (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `validation`, `rateLimited`). `ErrorCode` lives in `@fixflow/shared` as a string-literal union/const object. Seed it with the platform codes (`BAD_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `STALE_STATE`, `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`); later tasks add domain codes.
- A central error handler maps each failure as follows:
  - `AppError` → its status
  - `ZodError` → `422 VALIDATION_ERROR`, with `fieldErrors` keyed by dotted path (`lines.2.quantity`)
  - malformed JSON → `400 BAD_REQUEST`
  - payload too large → `413`
  - unknown errors → `500 INTERNAL_ERROR`, with a generic message, logged with the stack server-side only

  Every error body includes `requestId`. Unmatched routes → `404 NOT_FOUND`.
- `validate({ params, query, body })` middleware or typed helper using Zod. Parsed values replace the raw input on a typed request object. Body schemas are strict.
- `src/lib/pagination.ts`: a reusable Zod schema factory for `page`, `pageSize` (default 20, max 100), `sort` (allowlisted per endpoint) and `order`; a Prisma `skip`/`take`/`orderBy` builder; and the response builder `{ data, pagination: { page, pageSize, totalItems, totalPages } }`.
- `src/lib/clock.ts`: a `Clock` interface (`now(): Date`), a system clock, and a fixed/fake clock for tests, injectable through the app's dependency container.
- `src/lib/rate-limit/`: a `RateLimiter` interface (`consume(key, { limit, windowSeconds })` → `{ success, remaining, resetAt }`), with `MemoryRateLimiter` and `UpstashRateLimiter` (`@upstash/ratelimit` sliding window, `@upstash/redis`). Add a middleware factory `rateLimit({ name, limit, windowSeconds, key: (req) => string })` that returns `429 RATE_LIMITED` with `Retry-After`, and a generous global per-IP limiter (e.g. 300 requests/min). Every named limit is defined in one config map, and the test/E2E environment can override it with a multiplier or explicit values. Repeated E2E runs must not be throttled, and dedicated tests still verify the 429 behaviour with low limits.
- App composition: `createApp(deps)`, where `deps` contains the config, clock, rate limiter and logger (later the Prisma client, email sender and Google verifier). Production builds deps in `server.ts`; tests build them in a helper. Add graceful shutdown on SIGTERM/SIGINT.
- Validation limit constants (D-20) in `@fixflow/shared` (`LIMITS`), unit-tested for internal consistency.
- Test harness `src/test/`: `buildTestApp(overrides)` and Supertest helpers, plus a Vitest config that separates `*.test.ts` (unit) from `*.int.test.ts` (integration, used from T03).
- Docs: create `docs/API.md` (conventions: envelope, errors, status codes, pagination, money/date formats, rate limits; empty endpoint reference) and `docs/ARCHITECTURE.md` (system overview, API layering, module file conventions, dependency injection, error flow).

**Out of scope**
Database, Prisma and readiness check (T03); sessions, auth guards and CSRF Origin middleware (T05); any domain module.

## E. Implementation instructions

1. Inspect `apps/api` as T01 left it and keep its structure and module format.
2. Implement config first and make `server.ts` fail fast on invalid config. Tests use explicit overrides, not real env files.
3. Implement the logger and request-ID middleware, then the security middleware, then the error model and handler, then validation and pagination, then the clock and rate limiting. Mount them in the correct order in `createApp`: request ID → logger → helmet/CORS → body parsing → global rate limit → routes → 404 → error handler.
4. Add a test-only router in the test harness (not in production code) that throws each error type, so the error contract can be tested.
5. Confirm D-12 with the user before writing `UpstashRateLimiter`. If the user is unavailable and D-12 is unconfirmed, implement the interface and the memory driver only, leave the Upstash driver for confirmation, and record it as pending.
6. The Upstash driver has no live credentials in tests. Unit-test it with a mocked client, and document how to verify it manually once credentials exist.
7. Update `.env.example` for every new variable, with comments.

## F. Quality requirements

- No secret or cookie value can reach the logs, so add a test that proves redaction.
- 500 responses never include stack traces or internal messages.
- The middleware order is deliberate and documented in `docs/ARCHITECTURE.md`.
- Keep the abstractions minimal: no DI framework, just a typed `deps` object.
- All new code is strict TypeScript with no `any`, and its errors are typed.

## G. Acceptance criteria

1. Starting the API with a missing required variable exits non-zero with a message that names the variable but no values. A test covers this.
2. The error contract matches D-33: tests assert the status, `error.code`, `message`, `fieldErrors` (for 422) and `requestId` for 400, 404, 413, 422, 429 and 500 cases, and that the 500 body contains no stack trace.
3. Every response carries `x-request-id`, and a valid incoming ID is propagated.
4. The logger redacts cookies, authorization headers and sensitive fields. A test captures log output and asserts redaction.
5. helmet headers are present; CORS allows `WEB_ORIGIN` with credentials and rejects other origins (no ACAO header).
6. The pagination schema rejects `pageSize > 100`, non-allowlisted `sort` values and invalid `order` with 422, and the builder outputs correct `skip`/`take`.
7. The memory rate limiter returns 429 with `Retry-After` after the limit within the window, and resets after the window when tested with the fake clock or timers.
8. `GET /api/v1/health` still returns `{ data: { status: "ok" } }` without touching any database.
9. `docs/API.md` and `docs/ARCHITECTURE.md` exist and match the implementation.

## H. Testing and verification

- Unit tests: config parsing, `AppError` helpers, the pagination schema and builder, the memory rate limiter, the `LIMITS` constants, and the Upstash adapter with a mocked client.
- Supertest tests: error contract, request ID, helmet/CORS headers, 404, body-size limit, global rate limit.
- Run `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build`, and record the results.

## I. Documentation and progress updates

- Progress file: T02 entry and summary row.
- Traceability: API-01…API-04, NFR-09 (partial), SEC-DATA-04, SEC-AUTH-06 (mechanism), BR-06 (limits).
- `prompts/README.md`: set the T02 status.
- Decisions: mark D-12 `ACCEPTED` if the user confirmed it, otherwise note it as pending. Record any new decision.
- `.env.example`, `docs/API.md`, `docs/ARCHITECTURE.md`.

## J. Completion report

Report:
- what was implemented and the important files
- each acceptance criterion with pass/fail
- the commands executed and their actual results
- dependencies added, with justifications
- the D-12 confirmation status
- limitations or blockers
- a suggested commit message
- the next task: **T03 — Database schema, migrations and base seed** (`prompts/03-database-schema.md`). T04 may run before T03 if preferred.
