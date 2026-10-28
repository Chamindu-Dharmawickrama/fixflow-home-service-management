# T25 — End-to-End Journey, Accessibility and Quality Hardening

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T25 |
| Title | End-to-end journey, accessibility and quality hardening |
| Phase | 8 — Demo readiness and release |
| Objective | Prove the MVP works as a whole and fix what that proof uncovers. Automate the complete primary journey on three browser engines, sweep authorization, data leakage, accessibility, responsiveness, error handling and security headers across every screen and endpoint, and complete the spec's visual QA checklist. |

## B. Context

- Read first: `CLAUDE.md` (all); spec §3.3 (success criteria), §10 (all), §15 (all), §16, §17 (all acceptance criteria), §18 (all), §20 Phase 7, §23.
- Decisions: D-37 (testing), D-06/D-11 (CSP must allow Google Identity Services), D-41 (DTO separation).
- Requirements: TS-E2E-01, TS-E2E-02, TS-VQA-01…08, TS-INT-01/02, FR-004, FR-012, FR-094, SEC-AUTH-03/04/07, SEC-DATA-04, API-02, API-07, NFR-02/03/05/07/12, AC-UQ-01…03, AC-UQ-07, SC-02…SC-06, UX-01…08, UX-INT-01…06.

## C. Prerequisites

- T24 `COMPLETED` (seeded demo data; every feature implemented).

## D. Scope

**In scope**
1. **Main journey E2E** (`e2e/journeys/main-journey.spec.ts`), spec §18.3 steps 1–10, signing in through the login form with the demo accounts on a freshly reset test DB:
   1. sign in as the customer
   2. submit an AC repair request
   3. sign in as the admin and open the request
   4. start the review, then create and send a quotation
   5. return as the customer and accept it
   6. as the admin, create and schedule the job
   7. mark it in progress, then completed
   8. create and issue the invoice
   9. record a manual payment (partial, then the remainder)
   10. return as the customer and verify the job, invoice and payment views and the PDF download

   Run it on **chromium, firefox and webkit** projects.
2. **Negative journeys**:
   - customer-b opening customer A's request, quotation, job and invoice URLs sees not-found, and the API returns 404
   - expired quotation view (no actions)
   - form validation on the request form, quotation editor and payment dialog
   - network failure (Playwright route abort or 500) on a list page, a detail page and a mutation shows the error state with retry, and **no false success**
   - double-click protection on send quotation, accept, issue invoice and record payment
   - a customer navigating to `/app/*` sees PermissionDenied
3. **Authorization matrix test** (API integration): enumerate every registered route (introspect the Express router or keep a typed route registry) and assert:
   - unauthenticated → 401 for protected routes
   - customer → 403 for `/admin/*`
   - admin → 403 for customer-only routes
   - public routes are reachable

   The test fails when a new route is added without a matrix entry.
4. **DTO leak tests**: for every customer-facing endpoint, assert the response keys are a subset of an explicit allowlist, and that internal fields (`summary`, `internalCompletionNote`, `visibility: INTERNAL` notes, `accessNotes` of others, recorder IDs, payment notes, `metadata`) never appear.
5. **Accessibility sweep**: axe on every key screen (public 4, auth 2, portal 8, admin 14) with no serious or critical violations; a documented keyboard-only walkthrough of the main journey; checks of dialog focus traps and returns, live-region announcements for toasts, and heading order.
6. **Responsive sweep**: for every key screen at 360, 768, 1024 and 1440 px, assert no horizontal overflow, and capture screenshots to `artifacts/screenshots/t25/` for review.
7. **Error and resilience**: global `error.tsx`/`not-found.tsx` consistent with the design system; API-unavailable (cold start) messaging on public and app pages; session-expiry handling (a 401 mid-session redirects to login with returnTo).
8. **Security hardening**:
   - web security headers in `next.config` (CSP with `script-src`/`frame-src`/`connect-src`/`style-src` allowances for `accounts.google.com/gsi`; `frame-ancestors 'none'`; `Referrer-Policy`; `X-Content-Type-Options`; `Permissions-Policy`), verified not to break GIS
   - `npm audit --omit=dev` reviewed, with high and critical issues fixed or documented
   - a secret scan (`git ls-files` for env files; grep for key patterns)
   - log redaction re-verified on auth, request and payment flows
   - rate limits verified on all abuse-prone endpoints
9. **Visual QA checklist** (spec §18.4, all 8 items): go through each item, fix the defects, and record the results in `docs/QA_CHECKLIST.md` (item, result, evidence, fix).
10. **Performance sanity**: list endpoints use pagination with indexed queries (EXPLAIN the request queue, jobs list and invoices list against seed data); no N+1 queries in the list serializers; public pages are not shipping unnecessary client JS.
11. **CI**: add the E2E job (Chromium; the full three-engine run may be nightly or manual) with a Postgres service, the seed, both apps started, and Playwright artifacts uploaded on failure.

**Out of scope**
New features. Large redesigns: if the QA uncovers a major issue outside the scope of a fix, record a follow-up with a proposed task instead of expanding this one.

## E. Implementation instructions

1. Inventory the routes, screens and endpoints first, and write that list into `docs/QA_CHECKLIST.md` as the sweep plan.
2. Write the journey and negative tests. When a test fails because of a product defect, fix the product, never the assertion (unless the assertion is wrong per the spec, in which case explain why).
3. Implement the matrix and leak tests, then the sweeps, then the headers, then CI.
4. Re-run everything at the end and record the final numbers.

## F. Quality requirements

- Tests are deterministic: a fixed clock in the API where needed, a fresh DB per suite, no reliance on test order, and network waits tied to responses instead of timeouts.
- Fixes stay minimal and follow existing patterns, and each one is listed in the completion report.
- Honesty: any remaining defect, flaky test or unverified item is listed explicitly.

## G. Acceptance criteria

1. The main journey passes on chromium, firefox and webkit locally, and in CI on chromium.
2. All negative journeys pass, including no false success on network failure.
3. The authorization matrix covers 100 % of the registered routes and passes, and the DTO leak tests pass for all customer-facing endpoints.
4. axe shows no serious or critical violations on all listed screens, and the keyboard walkthrough is documented with no blockers.
5. There is no horizontal overflow at the 4 widths on any listed screen, and the screenshots are reviewed.
6. CSP and the security headers are present and Google sign-in still works. There are no unresolved high or critical audit findings without a documented rationale, and no secrets in the repository.
7. `docs/QA_CHECKLIST.md` records every §18.4 item with its result and fixes.
8. Lint, typecheck, unit, integration, build and E2E (all projects) pass, with the final counts recorded.

## H. Testing and verification

- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:integration`, `npm run build`, `npm run test:e2e` (all projects), the matrix and leak suites, `npm audit --omit=dev`. Record the actual results and the flaky-test status (re-run the suite 3 times).

## I. Documentation and progress updates

- Progress (final test counts, defects fixed, follow-ups), traceability (mark the verified rows `Verified` with test file references; this is the main verification pass), `docs/QA_CHECKLIST.md`, `prompts/README.md`, decisions (CSP details), README (test commands and CI).

## J. Completion report

Report:
- what was verified and what was fixed (a list)
- key files
- each acceptance criterion with pass/fail
- the commands executed and their actual results (counts per suite and engine)
- remaining defects, follow-ups and flaky tests
- a suggested commit message
- the next task: **T26 — Production demo release** (`prompts/26-production-release.md`), which requires T09 to be complete
