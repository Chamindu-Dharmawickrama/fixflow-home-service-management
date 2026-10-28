# T27 — Documentation and Portfolio Package

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T27 |
| Title | Documentation and portfolio package |
| Phase | 8 — Demo readiness and release |
| Objective | Finish the documentation another developer needs to run and understand FixFlow, and the honest portfolio materials a prospective client needs to evaluate it: README, architecture and API docs, real screenshots, demo script and case study. Then perform the final requirements-traceability audit. |

## B. Context

- Read first: `CLAUDE.md`; spec §3.3 (success criteria), §19.4 (demo script), §21.4 (README minimum content), §22 (portfolio presentation: case study structure, screenshot order, honest status), §24 (future enhancements must not be described as implemented).
- Decisions: D-39 (out-of-scope list for "Known limitations"); Q-12 (contribution and AI-assistance wording; the owner decides).
- Requirements: DEP-05, DD-06, PF-01…PF-04, SC-01, SC-08, SC-09, AC-UQ-05, NFR-06, NFR-10.

## C. Prerequisites

- T26 `COMPLETED` (live demo URL available). If T26 is blocked, the docs can be prepared against the preview or local app, but the screenshots must come from the real running application, and the task stays `IN_PROGRESS` until the live URL exists.

## D. Scope

**In scope**
- **README.md (final)**, covering every item in spec §21.4:
  - product summary and the problem it solves
  - screenshots and the live demo URL
  - the feature list and **explicit out-of-scope items**
  - an architecture diagram (Mermaid) and the key technology choices with one-line reasons
  - local setup (prerequisites, install, env vars table referencing `.env.example`, Docker test DB)
  - database migration and seed commands, the demo reset
  - test commands (unit, integration, E2E) and CI
  - demo accounts with their published credentials and safe demo-access notes
  - known limitations
  - a portfolio-project disclaimer and contribution scope
  - links to the docs
- `docs/ARCHITECTURE.md` (final): system context, deployment topology (proxy and cookies), backend modules and layering, domain rules (transition maps, money, scheduling locks, time-based sync), the data model ER diagram, security model (authn/authz, CSRF, rate limiting, DTO separation), email and PDF pipelines, frontend structure, testing strategy.
- `docs/API.md` (final): the endpoint reference grouped by module (method, path, access, request and response shape, error codes), the conventions, and the error-code catalogue generated or verified against `@fixflow/shared`.
- **Screenshots** `docs/screenshots/`, captured from the **real deployed app** (or the local app on demo data if T26 is blocked) by a reproducible Playwright script (`npm run screenshots`), in the spec §22.2 order:
  1. business dashboard
  2. public services or request-service screen
  3. quotation preview and approval workflow
  4. job calendar or work-order detail
  5. printable invoice
  6. responsive customer portal on mobile

  Consistent viewport and no visible secrets or passwords. Browser frames only if they don't distract.
- `docs/DEMO_SCRIPT.md`: a 2–3 minute walkthrough following spec §19.4, with exact clicks, account switches, expected screens and talking points, plus a reset reminder. The owner records the video.
- `docs/PORTFOLIO_CASE_STUDY.md`, structured per spec §22.1:
  - title
  - problem
  - solution
  - **"My contribution"**: leave clearly marked fields for the owner to complete accurately, per Q-12, including how AI-assisted development is described
  - highlighted capabilities
  - engineering decisions (role-based access, server-side money calculation, state transitions, transaction safety, responsive design)
  - evidence (demo URL, screenshots, repository)
  - honest status (self-initiated portfolio project; no invented client, testimonial or outcome)

  Future enhancements are listed as future.
- **Final traceability audit**: go through `docs/REQUIREMENTS_TRACEABILITY.md`. Every MUST must be `Verified` with evidence, or carry an explicit limitation note. Every SHOULD must be `Verified` or marked deferred, with a reason. Summarise the outcome at the top of the file.
- **Fresh-clone dry run**: clone into a temporary directory, follow only the README (with Docker test DB and log email), and confirm install, migrate, seed, dev, and the test suites work. Fix any gaps in the docs.

**Out of scope**
Recording the video (owner), publishing on Fiverr (owner), new features.

## E. Implementation instructions

1. Inspect every existing doc and the app as it currently stands. Documentation must describe what exists, verified against the code, not the plan.
2. Write the screenshot script, run it, and review the images for quality and privacy.
3. Write and update the docs, perform the traceability audit, then the fresh-clone dry run.
4. Ask the owner to fill in or approve the "My contribution" section (Q-12). Do not invent claims.

## F. Quality requirements

- Accuracy over marketing: no feature, metric or outcome is claimed unless it is implemented and verified. Future items are labelled as future.
- The docs are concise, navigable and consistent in terminology with the spec glossary (spec §25).
- Screenshots are real application captures with fictional data (PF-04).

## G. Acceptance criteria

1. The README contains every spec §21.4 item and is accurate. The fresh-clone dry run succeeds using only the README (record the steps and results).
2. `ARCHITECTURE.md` and `API.md` match the implementation; the endpoint and error-code lists are verified against the code.
3. The 6 screenshots exist in the §22.2 order, come from the real app, and show no secrets.
4. `DEMO_SCRIPT.md` and `PORTFOLIO_CASE_STUDY.md` exist, follow the spec structure, are honest, and leave the owner-only fields clearly marked.
5. The traceability audit is complete. Every MUST is `Verified` or has an explicit, justified limitation, with a summary at the top.
6. `IMPLEMENTATION_PROGRESS.md` shows the final state of all tasks, with the follow-ups listed.

## H. Testing and verification

- `npm run screenshots`; the fresh-clone dry run (install, `db:test:up`, migrate, seed, `npm run test`, `npm run test:integration`, `npm run build`); a link check on the README and docs (relative links resolve). Record the results.

## I. Documentation and progress updates

- All docs listed above, the progress file (final), traceability (final audit), `prompts/README.md` (all statuses).

## J. Completion report

Report:
- the documents produced
- the screenshot list
- the traceability audit summary (MUST and SHOULD counts by status)
- the fresh-clone dry run result
- items needing owner input (contribution wording, video recording)
- remaining limitations and recommended future enhancements (from spec §24, clearly marked as not implemented)
- a suggested commit message
- that the MVP plan is complete
