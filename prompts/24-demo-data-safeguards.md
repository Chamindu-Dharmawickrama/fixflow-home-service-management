# T24 — Showcase Demo Data and Demo-Mode Safeguards

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T24 |
| Title | Showcase demo data and demo-mode safeguards |
| Phase | 8 — Demo readiness and release |
| Objective | Seed a realistic, internally consistent, always-current dataset for CoolBreeze Home Services so every screen looks genuinely used and the showcase script can run. Make the public demo safe: resettable data, abuse limits, and honest notices that tell visitors to use fictional details (open sign-up per D-09). |

## B. Context

- Read first: `CLAUDE.md`; spec §5.2, §15.2 (fictional data, demo notice, restrict demo admin credentials), §19 (all: business, services, accounts, seeded volumes, internal consistency, demo script), §21.1 (resettable approach), §23 (demo abuse risk).
- Decisions: D-09 (seeded demo accounts with published credentials; open sign-up with both methods; privacy mitigations), D-52 (reserved-domain email policy), D-47, D-17, D-26/D-27 (consistency rules); Q-02, Q-11 (demo admin editing public identity).
- Requirements: DD-01…DD-05, AC-UQ-04, SEC-DATA-01, SEC-DATA-05, SEC-DATA-06, SEC-AUTH-06 (demo writes), DEP-07, SC-07, UX-05.

## C. Prerequisites

- T23 `COMPLETED`. Confirm Q-11 with the user.

## D. Scope

**In scope**
- **Showcase seed** `prisma/seed-demo.ts` (script `db:seed:demo`):
  - builds records **through the domain services**, or helpers that call the same domain functions (transitions, calculations, references), so the invariants hold by construction
  - uses a fixed fictional cast and dates **relative to now** in the business timezone, so the demo always looks current (jobs this week, invoices due and overdue relative to today)
  - Volumes (spec §19.3):
    - 6–8 customers (including the demo accounts) with 1–3 addresses each
    - 4 technicians
    - 10–12 requests covering every request status
    - 5–6 quotations: one SENT awaiting a decision for Alex Morgan, one ACCEPTED, one DECLINED with a reason, one VOID replaced by a newer one, and one EXPIRED
    - 6–8 work orders: PENDING_SCHEDULING, SCHEDULED (this week, different technicians, including a back-to-back pair), IN_PROGRESS (today), NEEDS_RESCHEDULING, COMPLETED awaiting invoice, and COMPLETED and invoiced
    - 5 invoices: ISSUED, PARTIALLY_PAID, PAID (payments sum to the total), OVERDUE, and one VOID with a reason
    - payments that are consistent with their invoices
    - notifications for the demo admin and customer accounts (some read, some unread)
    - an activity history that tells a plausible story per record
  - Content quality:
    - realistic, specific problem descriptions ("Upstairs AC unit runs but blows warm air since the weekend; outdoor fan isn't spinning")
    - plausible line items and prices
    - diverse fictional names; `.test` emails; 555-01xx phones; fictional street addresses
    - **no real people or businesses**
  - Leaves a clean path for the live demo script (spec §19.4): Alex Morgan can submit a fresh AC repair request, and Jordan Lee has free slots this week.
- **Invariant checker** `npm run db:verify-demo`, which asserts and fails loudly on violation:
  - PAID invoices have `amountPaid = total = Σ active payments`
  - every `amountPaid` equals the sum of its active payments
  - statuses equal the derived statuses
  - accepted quotations are never also declined
  - every work order links to an ACCEPTED quotation
  - no technician overlaps
  - completed jobs have plausible start and complete times
  - references are unique and well-formed
  - every request status appears
  - the counts are within the §19.3 ranges
- **Reset command** `npm run db:reset-demo`:
  - truncates and reseeds (base seed plus showcase seed)
  - refuses to run unless `DEMO_MODE=true` **and** `CONFIRM_DEMO_RESET=<database name>` matches the target database
  - prints the target host and database name (no credentials) before acting
  - never runs automatically against development or test databases by mistake
- **Optional scheduled reset**: a GitHub Actions workflow (`workflow_dispatch` plus a nightly `schedule`) running `db:reset-demo` against the demo database, using repository secrets. Disabled by default until the owner enables it in T26; document it.
- **Demo-mode safeguards** (when `DEMO_MODE=true`):
  - demo accounts cannot change or reset their password (`DEMO_ACCOUNT_LOCKED`, verify the T05 behaviour)
  - a stricter write rate limit for demo-account sessions (e.g. 60 writes per 10 min per account per IP) and for new registrations
  - the `PUBLIC_SIGNUP_ENABLED` switch documented, and tested both ways
  - per Q-11: either lock the business identity fields (name, logo, contact) for the demo admin account, with a clear inline explanation, or allow them with rate limiting plus reset; implement what the owner chose
  - demo banner and `/privacy` notice finalized (mention the reset frequency)
  - the login page's demo-accounts panel explains what each account can do, and the demo-mode notice on `/login` and `/register` warns visitors to use fictional details
  - email to the seeded `.test` accounts is logged, not sent (D-52, already enforced by the dispatcher; verify with the showcase data)
- README "Demo access" section listing the demo accounts and their published credentials, what each can do, the reset behaviour and the privacy note.

**Out of scope**
Production deployment of the reset workflow (T26 enables it), new features.

## E. Implementation instructions

1. Inspect the base seed (T03) and all domain services. Write the showcase seed as a scenario builder with small helpers per story (e.g. `createAcceptedAndScheduledJob(...)`) that call service functions inside transactions, using a seeded clock positioned at "now" with an offset per event.
2. Write the invariant checker and run it after seeding. Fix the seed and **never** the checker when violations appear.
3. Implement the reset guard with tests (refuses on mismatch, refuses without `DEMO_MODE`).
4. Implement the safeguards, then run the app against the seeded DB and walk every screen (admin and portal) at 1440 and 360 px. Capture screenshots to `artifacts/screenshots/t24/` and fix any data that looks implausible or empty.

## F. Quality requirements

- The data is internally consistent (spec §19.3 final paragraph) and believable to a reviewer.
- Seeding is deterministic in structure (same counts and statuses on every run), with dates relative to now.
- No real personal data. No password literals in source; demo passwords come from env.

## G. Acceptance criteria

1. `npm run db:reset-demo` (with the guard satisfied) produces the §19.3 volumes, and `npm run db:verify-demo` passes with every check listed.
2. Every status of every entity appears at least once, and the dashboard KPIs and needs-attention queue show meaningful non-zero values.
3. The reset refuses without `DEMO_MODE`, or with a mismatched `CONFIRM_DEMO_RESET`, and prints no credentials.
4. Running reset twice yields the same structure, with dates relative to the run time.
5. The demo-mode safeguards work: demo accounts locked against password changes, write and registration rate limits (429), `PUBLIC_SIGNUP_ENABLED` both ways, the Q-11 choice, `.test` emails `LOGGED` not sent, and banner, notices and privacy text accurate (integration and E2E).
6. The showcase script path is available: Alex can submit a new request; Jordan has free slots this week.
7. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Integration: seed then verify in the test DB; reset guard tests; demo rate-limit test; email restriction test.
- E2E smoke on seeded data: dashboard numbers visible; the portal shows Alex's awaiting quotation; the calendar shows this week's jobs.
- Run all standard commands, plus `db:reset-demo` and `db:verify-demo` against the dev DB.

## I. Documentation and progress updates

- Progress (screenshots and walkthrough notes), traceability (DD-01…DD-05, AC-UQ-04, SEC-DATA-01/05/06, SEC-AUTH-06, DEP-07, SC-07, UX-05), `prompts/README.md`, decisions (Q-11 resolution), README (demo access, reset), `docs/DEPLOYMENT.md` (reset procedure).

## J. Completion report

Report:
- what was implemented and the key files
- the seed summary (counts per status)
- the invariant checker output
- each acceptance criterion with pass/fail
- the commands executed and their results
- limitations
- a suggested commit message
- the next task: **T25 — End-to-end journey, accessibility and quality hardening** (`prompts/25-quality-hardening.md`)
