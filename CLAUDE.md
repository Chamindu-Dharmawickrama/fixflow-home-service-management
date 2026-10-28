# FixFlow — Project Instructions for Claude Code

These instructions apply to every implementation session. Keep this file accurate and concise; detailed requirements live in `docs/`.

## 1. What FixFlow is (and is not)

- A **self-initiated portfolio product**: a web application for **one** small home-service company (demo business: *CoolBreeze Home Services*) that offers **multiple services**.
- Three experiences in one Next.js app: **public website**, **business admin dashboard** (`/app/*`), **customer portal** (`/portal/*`).
- Primary journey: request → review → quotation → accept/decline → work order → schedule → in progress → completed → invoice → manual payment recorded.
- Two authenticated roles only: `BUSINESS_ADMIN` and `CUSTOMER`. Technicians are **resource records without logins**.
- **Never** introduce: multi-tenancy, business/tenant IDs, business sign-up, marketplace features, subscriptions, payment gateways or card data, technician login, SMS/WhatsApp, AI features, native apps, or anything else in spec §3.4 / §24. These are explicitly out of scope.
- Never claim fabricated clients, testimonials, outcomes or production readiness. All demo data is fictional.

## 2. Sources of truth (precedence)

1. `docs/FixFlow_Project_Documentation.docx` — canonical specification.
2. `docs/FixFlow_Project_Documentation.md` — searchable mirror (body verified identical to the DOCX on 2026-10-28; only cover-page wording differs). Use it for lookups by section number (e.g. "spec §11").
3. `docs/Note.md` — project owner's provider/hosting decisions (Neon, Upstash, Google Sign-In, Nodemailer SMTP, Vercel, Render). These override the spec's *recommended* stack choices.
4. `docs/DECISIONS_AND_OPEN_QUESTIONS.md` — resolved ambiguities and architecture decisions (`D-xx`), conflicts (`C-xx`), open questions (`Q-xx`).

Planning artifacts: `docs/IMPLEMENTATION_PLAN.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/IMPLEMENTATION_PROGRESS.md`, `prompts/README.md`, `prompts/NN-*.md`.

**Never edit** the three source documents. If you find a new conflict or an unspecified behaviour that materially affects implementation, record it in the decisions file and ask the user — do not silently decide.

## 3. Session workflow (every task)

1. Read the assigned prompt in `prompts/NN-*.md` completely.
2. Check `docs/IMPLEMENTATION_PROGRESS.md`: every prerequisite must be `COMPLETED`. If not, stop and report.
3. Check the decisions the prompt references. If a decision the task depends on is still `PROPOSED`, ask the user to confirm it before implementing (unless the user already confirmed it in this session).
4. Inspect the existing code relevant to the task before changing it. Verify assumptions against the repository — do not assume a file, helper or convention exists.
5. Set the task to `IN_PROGRESS` in the progress file, implement **only** the prompt's scope, then run the required verification.
6. Update documentation and progress (see §10). Mark `COMPLETED` only when all acceptance criteria are met and the required checks actually passed.
7. Finish with the completion report the prompt requests. Do not start the next task automatically.

## 4. Approved stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 24 LTS (`.nvmrc`, `engines`); npm workspaces monorepo |
| Web | Next.js (App Router) + TypeScript (strict), Tailwind CSS, shadcn/ui, Lucide icons, React Hook Form + Zod |
| API | Express 5 + TypeScript, Zod validation, pino logging, helmet |
| Database | PostgreSQL on **Neon** via Prisma (pooled URL at runtime, direct URL for migrations) |
| Redis | **Upstash** — distributed rate limiting only (in-memory fallback for local/test) |
| Auth | **Local email/password** (Argon2id) **and Google Sign-In** (ID token verified server-side), both producing opaque server-side sessions in an HTTP-only cookie; seeded demo accounts with documented credentials (D-07…D-11, D-51) |
| Email | **Nodemailer SMTP** behind an `EmailSender` interface; `log` transport for local/test |
| Money / dates | `decimal.js` (never JS floats for money); `date-fns` + `@date-fns/tz` |
| PDF | Lightweight Node PDF library (no headless Chromium) — see D-28 |
| Tests | Vitest (unit + integration), Supertest, Testing Library, Playwright (E2E), axe |
| Hosting | **Vercel** (web), **Render** (API), Neon (DB) |

Use current stable versions at implementation time, commit the lockfile, and keep dependencies few and maintained. Adding a dependency that is not listed here requires a one-line justification in the completion report.

## 5. Repository layout

```text
apps/web/          Next.js app — src/app (routes), src/features/{marketing,auth,admin,portal},
                   src/components/{ui,forms,layout}, src/lib/{api,auth,formatting}
apps/api/          Express API — src/{config,lib,middleware}, src/modules/<module>/, prisma/, src/test/
packages/shared/   @fixflow/shared — enums, status labels, error codes, DTO types, validation limits,
                   pure money calculation (no I/O, no framework code)
e2e/               Playwright end-to-end tests
docs/  prompts/    Specification, planning, progress, decisions, task prompts
```

API module files: `<m>.routes.ts`, `<m>.schemas.ts` (Zod), `<m>.service.ts` (business logic + transactions), `<m>.domain.ts` (pure rules: transitions, calculations), `<m>.dto.ts` (serializers), `*.test.ts` (unit), `*.int.test.ts` (integration). Create a module only when a task needs it.

## 6. Commands

Defined by T01/T03; keep this list accurate if scripts change.

```text
npm install                 # from repo root
npm run dev                 # web (3000) + api (4000) concurrently
npm run lint | typecheck | build
npm run test                # unit tests, all workspaces
npm run test:integration    # API integration tests (requires TEST_DATABASE_URL)
npm run test:e2e            # Playwright
npm run db:test:up          # local Docker Postgres for tests
npm run db:migrate          # prisma migrate dev (development DB only)
npm run db:seed             # idempotent base/demo seed
```

## 7. Architecture rules

- **The server is authoritative** for authentication, roles, ownership, validation, totals, references, status transitions and timestamps. Client-supplied values for these are ignored or rejected.
- The web app **never** connects to the database and contains no business rules beyond display hints. Business mutations go through the Express API (no Server Actions for business logic).
- Browser calls use the **same-origin proxy** `/api/v1/*` (Next.js rewrite to the API) so the session cookie stays first-party (D-06). Server Components call the API via `API_INTERNAL_URL`, forwarding the incoming cookie.
- Reads: Server Components. Mutations: client components using `lib/api`, then `router.refresh()`. List filters, sorting and pagination live in URL search params.
- Status changes happen **only** through domain transition functions in `<m>.domain.ts`; never write a status field directly elsewhere. Transition endpoints accept `expectedStatus` and return `409` if the record changed (D-46).
- Multi-record changes run in a single `prisma.$transaction`. Use conditional updates / row locks / unique constraints to make conversions, acceptances, issuance and payments duplicate-safe.
- Customer-facing and admin serializers are **separate functions**. Customer DTOs never contain internal notes, internal activity details, other customers' data or staff-only metadata. Admin DTOs include `availableActions` so the UI does not duplicate transition rules (D-43).
- Emails are sent **after** the transaction commits; failures are logged in `EmailDeliveryLog` and never reverse the business action.
- Inject a `Clock` for time-dependent logic (expiry, overdue, scheduling) so tests are deterministic.
- Reuse before you create: search for an existing helper/component first. Add an abstraction only when it removes real duplication.

## 8. API conventions

- Prefix `/api/v1`; JSON bodies; UUID primary keys; human-readable references (`FF-`, `QT-`, `JOB-`, `INV-`) are display identifiers, never authorization.
- Success: `{ "data": … }`; lists: `{ "data": [...], "pagination": { page, pageSize, totalItems, totalPages } }`. `pageSize` default 20, max 100; sort fields are allowlisted.
- Errors: `{ "error": { "code", "message", "fieldErrors"?, "requestId" } }`. Status codes: `400` malformed request, `401` unauthenticated, `403` wrong role / CSRF failure, `404` missing **or not owned** (prevents ID probing), `409` state conflict, `422` validation, `429` rate limited. Error codes live in `@fixflow/shared`.
- Money is serialized as a decimal string (`"1234.50"`) with an explicit `currencyCode`; timestamps as ISO 8601 UTC; date-only fields as `YYYY-MM-DD`.
- Zod schemas are strict (unknown keys rejected) for request bodies.

## 9. Security, privacy and data rules

- Enforce role **and** ownership on the server for every protected endpoint; hiding UI is not a control. Customer scoping always comes from the session, never from IDs in the request.
- Passwords: Argon2id hashes only; generic login errors; password-reset responses never reveal whether an account exists; reset tokens are single-use, hashed at rest and never logged (D-51). Local registration never creates an admin (D-08).
- Session cookie: HTTP-only, `Secure` (prod), `SameSite=Lax`, opaque random token; only its hash is stored. Unsafe methods require a matching `Origin` (CSRF defence). Rate-limit auth, demo login and abuse-prone writes.
- Never log or store passwords, tokens, cookies, card/bank data, or full request descriptions/addresses in application logs. pino redaction must stay configured. Activity metadata is non-sensitive only.
- Secrets only in environment variables; never commit `.env*` files (only `.env.example`). Never expose secrets via `NEXT_PUBLIC_*`.
- Escape all untrusted text in emails/PDFs; generate PDFs from persisted data only; authorize before generating.
- Money: `Decimal` columns, `decimal.js` arithmetic, half-up rounding to 2 dp (D-18/D-19). Timestamps stored in UTC, displayed in the business timezone from settings — never the browser's locale/timezone for business logic or currency.
- Voided/cancelled records stay in history with actor, time and reason. No hard deletes of quotations, issued invoices or payments.
- No file uploads in the MVP (D-30).

## 10. UI/UX standards

- Follow `docs/DESIGN_SYSTEM.md` (created in T04) and reuse `components/ui` and layout shells. Use design tokens — no ad-hoc colours, font sizes or spacing.
- Every screen ships with real loading (skeleton), empty (with guidance), validation-error, server-error (with retry), success, disabled and permission-denied states as applicable.
- Never show fake success, fake email delivery or fake payment confirmation. Confirm destructive or irreversible actions and explain the consequence. Disable duplicate submissions while pending. Preserve form input after recoverable errors and show errors beside fields.
- Status is always text + colour via `StatusBadge`, never colour alone.
- Responsive at 360, 768, 1024 and 1440 px with no horizontal page overflow; admin tables collapse to cards (or use deliberate horizontal scroll) on narrow screens.
- Accessibility (WCAG 2.2 AA practices): semantic landmarks and headings, labelled controls, keyboard operability, visible focus, managed focus in dialogs, sufficient contrast, meaningful accessible names.
- Realistic fictional content only — no lorem ipsum. **No dead UI:** do not render buttons or nav links for features that are not implemented yet; the task that implements a feature adds its entry points.

## 11. Testing and verification

- Unit-test pure domain logic (money, transitions, overlap, status derivation, references, permissions, date/timezone handling).
- Integration-test every endpoint with Supertest against an isolated test database, including `401`, `403`, cross-customer `404`, `409` invalid-transition cases, and "record unchanged after rejection" assertions.
- Add Playwright coverage for each user-facing slice (E2E signs in through the real `/login` form with the seeded demo accounts) and an axe check on new key screens. Google sign-in is tested at the API level with an injectable fake ID-token verifier.
- Before reporting, run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:integration` (when API/DB touched), `npm run build`, and `npm run test:e2e` (when UI touched).
- The DB reset utility must refuse to run against anything except `TEST_DATABASE_URL` (integration) or `E2E_DATABASE_URL` (Playwright). E2E fixtures are inserted directly into the E2E DB through helpers; never add test-only endpoints to production code. Rate limits are configurable, so test/E2E environments relax them while dedicated tests still verify `429`.
- Never delete, skip or weaken a test to make it pass. Never claim a command passed unless you ran it and saw it pass. If something fails or could not be run (e.g. missing credentials), say so plainly and record it.

## 12. Progress, decisions and documentation

After each task update:
- `docs/IMPLEMENTATION_PROGRESS.md` — status, work completed, **actual** commands run and results, known issues, follow-ups, date.
- `docs/REQUIREMENTS_TRACEABILITY.md` — status for the requirements the task addressed.
- `prompts/README.md` — status column.
- `docs/DECISIONS_AND_OPEN_QUESTIONS.md` — any new decision (`D-xx`, with rationale) or question; mark confirmed decisions `ACCEPTED`.
- `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `.env.example` — whenever setup, structure, endpoints or configuration change.

Status values: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `COMPLETED`. Code written with failing or unrun verification is `IN_PROGRESS` or `BLOCKED`, not `COMPLETED`.

## 13. Scope discipline

- Implement the current task's scope only. Out-of-scope discoveries go under "Follow-ups" in the progress file unless they block the task and are trivial.
- No speculative features, premature optimization, or enterprise infrastructure (queues, microservices, caches, feature-flag systems) beyond what a task specifies.
- Do not duplicate existing functionality or replace established patterns without recording a decision.
- Do not commit unless the user asks; suggest a commit message in the completion report instead.
