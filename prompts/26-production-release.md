# T26 — Production Demo Release

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T26 |
| Title | Production demo release |
| Phase | 8 — Demo readiness and release |
| Objective | Release the hardened MVP as the public portfolio demo on Vercel, Render and Neon with production configuration, real email delivery, rate limiting, HTTPS and safe demo data, and verify that the full primary journey can be repeated on the deployed site without developer intervention. |

## B. Context

- Read first: `CLAUDE.md`; `docs/DEPLOYMENT.md` (from T09); spec §15 (all), §17.4, §19.2 (demo access), §20 Phase 7 exit gate, §21 (all), §23 (demo abuse, email setup).
- Decisions: D-02, D-06, D-09, D-13, D-14, D-15, D-48; Q-04 (production credentials), Q-06 (domain), Q-09 (Render plan).
- Requirements: AC-UQ-06, AC-UQ-07, DEP-01, DEP-07, SEC-AUTH-02, SEC-DATA-06, FR-091 (production SMTP), CFG-01…CFG-06, SC-03, NFR-12.

## C. Prerequisites

- T09 `COMPLETED` (the preview infrastructure is proven) and T25 `COMPLETED`.
- The owner provides the production values: a Neon `main` branch, the Render service (plan per Q-09), the Vercel production project, the Google OAuth production origin, Upstash, SMTP with a **verified sender domain or address**, `ADMIN_EMAILS` and `SESSION_SECRET`.
- As in T09, the owner performs the dashboard steps and Claude Code prepares and verifies.

## D. Scope

**In scope**
- Production environment configuration on Render and Vercel (the full variable matrix from `DEPLOYMENT.md`), including `NODE_ENV=production`, `DEMO_MODE=true`, `EMAIL_TRANSPORT=smtp`, Upstash, `TRUST_PROXY` validated in T09, and the production `WEB_ORIGIN` and `PUBLIC_WEB_URL`.
- Database: run migrations against the Neon `main` branch (direct URL) through the deploy pipeline, then `db:reset-demo` (guarded) to load the showcase data. Document the Neon branch-restore and point-in-time recovery option, and the reset as the recovery path.
- Google OAuth: production authorized JavaScript origin(s), and the consent screen configured with the app name, a support email and a link to the privacy page.
- SMTP: set `BusinessSettings.contactEmail` (or an `ADMIN_EMAILS` entry) to an owner-controlled mailbox. Trigger a real admin email, e.g. submit a request as the demo customer to fire the "request received" admin alert, or use `npm run email:test`. Confirm the email arrives and `EmailDeliveryLog` shows `SENT`. Confirm that emails to the seeded `.test` accounts are `LOGGED`, not sent (D-52), and that an induced SMTP failure shows `FAILED` without breaking the action. Run a real password reset for an owner-controlled (non-demo) account and confirm the email arrives and the link works.
- Enable the scheduled demo reset workflow (if chosen in T24) with repository secrets, and run it once manually.
- Production smoke and E2E: run the Playwright smoke suite and the main journey against the production URL (`BASE_URL`, demo accounts via the login form), then reset the demo data afterwards.
- Verify on production:
  - HTTPS on both services
  - cookie attributes (`__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`)
  - CSP and headers
  - local sign-in with the demo accounts, Google sign-in for an allowlisted admin and for a regular customer, and the demo-account password lock
  - production demo-account passwords set through env (rotated from development values if desired) and documented for reviewers
  - rate limiting through Upstash
  - health and ready endpoints
  - cold-start behaviour on the chosen Render plan
  - Safari/WebKit and mobile emulation
- Operations runbook in `docs/DEPLOYMENT.md`: deploy, roll back (Render and Vercel previous deployments), rotate secrets (session secret: all sessions invalidated; Google client; SMTP), reset the demo, rotate or restrict demo access if abused (SEC-DATA-06), and where to read the logs.
- Optional: an uptime check against `/api/v1/health` (an external free monitor). Document it if used.

**Out of scope**
Custom domain setup (unless the owner provides one; Q-06), paid monitoring, new features.

## E. Implementation instructions

1. Re-read `DEPLOYMENT.md` and the T09 findings, then prepare a release checklist in the progress entry before touching production.
2. Walk the owner through the configuration, deploy, then run the verification list above, recording the evidence with secrets redacted.
3. If any production check fails, fix it (in code or configuration), redeploy and re-verify. Do not mark the task complete with failing checks.
4. Update the README with the live demo URL and the demo-access instructions.

## F. Quality requirements

- No secrets in the repository, logs, reports or screenshots.
- Production config fails fast on missing values, as built in T02; confirm this with a deliberate dry run on a preview, never on production.
- The demo is honest: banner, privacy notice, fictional data, and truthful email delivery status.

## G. Acceptance criteria

1. The production web and API run on HTTPS. The health checks pass. Migrations are applied, and the showcase data is loaded and verified (`db:verify-demo` against production through the guarded command or an equivalent read-only check).
2. The full primary journey passes on the production URL (automated, using the demo accounts through the login form), and the demo resets cleanly afterwards.
3. Local sign-in and Google sign-in both work on production (admin and customer). The cookie and header attributes are verified.
4. A real SMTP email is delivered and logged `SENT`, and a failure case is logged `FAILED` with the action intact.
5. Rate limiting is active through Upstash. The scheduled reset (if enabled) runs successfully.
6. The runbook is complete. The README shows the live demo URL and access instructions.
7. Any check that could not be performed is listed, and the task is not `COMPLETED` until the core checks (G.1–G.3) pass.

## H. Testing and verification

- Production smoke and journey E2E runs, curl header checks, the manual Google sign-in, the SMTP delivery check, the reset workflow run. Record each result in the progress file.

## I. Documentation and progress updates

- Progress (release checklist with results), traceability (AC-UQ-06/07, DEP-01/07, SEC-AUTH-02, SEC-DATA-06, FR-091, CFG-01…06, SC-03, NFR-12 → `Verified` where proven), `prompts/README.md`, `docs/DEPLOYMENT.md` (runbook), README (demo URL), decisions (Render plan, any production-specific choices).

## J. Completion report

Report:
- the production URLs
- what was configured and verified, with evidence (secrets redacted)
- each acceptance criterion with pass/fail
- issues found and fixed
- remaining risks
- a suggested commit message
- the next task: **T27 — Documentation and portfolio package** (`prompts/27-documentation-portfolio.md`)
