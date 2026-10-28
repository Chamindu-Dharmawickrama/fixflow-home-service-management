# FixFlow — Implementation Prompts

Each file in this directory is a self-contained task prompt for one Claude Code implementation session. The prompts build the FixFlow MVP in vertical slices. Each task leaves the application runnable and verified.

## How to run a task

1. Start a new Claude Code session at the repository root. `CLAUDE.md` loads automatically.
2. Tell Claude Code: *"Execute `prompts/NN-name.md`."*
3. Claude Code checks prerequisites in `docs/IMPLEMENTATION_PROGRESS.md`. It asks you to confirm any `PROPOSED` decision the task depends on, then implements, verifies, updates the docs and reports.
4. Review the completion report (and commit if you're satisfied), then run the next prompt.

**Rules**
- Run prompts **in the listed order**, one per session.
- **Do not start a task until all its prerequisites are `COMPLETED`.** A task with failing or unrun verification is not complete.
- Safe deviations:
  - T04 may run before or between T02 and T03.
  - T16 may run at any point after T05.
  - T19 may run before T18.
  - If T09 is `BLOCKED` waiting for credentials, continue with T10 and return to T09 before T26.
- If a decision changes, update `docs/DECISIONS_AND_OPEN_QUESTIONS.md` first, then the affected prompts.

## Before you start

- **Install Node.js 24 LTS** (D-05). The machine currently has Node 20, which is end-of-life.
- Q-01, Q-02 and Q-03 were answered on 2026-10-28 (both sign-in methods; branding approved). The remaining `PROPOSED` decisions are listed in the "Confirm first" column below; Claude Code asks about each one when its task starts.

## Task index

| Order | Task | File | Objective | Prerequisites | Confirm first | Status |
|---|---|---|---|---|---|---|
| 1 | T01 | [01-repository-foundation.md](01-repository-foundation.md) | Monorepo, tooling, proxy, CI skeleton | — (Node 24) | D-05 | COMPLETED |
| 2 | T02 | [02-api-platform.md](02-api-platform.md) | Config, logging, errors, validation, pagination, rate limiting | T01 | D-12 | NOT_STARTED |
| 3 | T03 | [03-database-schema.md](03-database-schema.md) | Prisma/Neon, full schema and constraints, references, test DB, base seed | T02 | D-17, D-29 | NOT_STARTED |
| 4 | T04 | [04-design-system.md](04-design-system.md) | Design system doc, tokens, components, shells, styleguide | T01 | D-32 (Q-08), D-55 | NOT_STARTED |
| 5 | T05 | [05-authentication.md](05-authentication.md) | Email/password + Google sign-in, password reset, sessions, guards, CSRF, auth UI | T03, T04 | D-08, D-55 | NOT_STARTED |
| 6 | T06 | [06-activity-notifications-email.md](06-activity-notifications-email.md) | Timelines, in-app notifications, SMTP/log email | T05 | — | NOT_STARTED |
| 7 | T07 | [07-settings-service-catalogue.md](07-settings-service-catalogue.md) | Business settings, service catalogue admin and public API | T06 | — | NOT_STARTED |
| 8 | T08 | [08-public-website.md](08-public-website.md) | Homepage, services, service detail, privacy, SEO | T07 | Q-05 (imagery) | NOT_STARTED |
| 9 | T09 | [09-preview-deployment.md](09-preview-deployment.md) | Hosted preview on Vercel, Render and Neon; prove proxy and cookies | T08 | D-48 (Q-04, Q-06) | NOT_STARTED |
| 10 | T10 | [10-customer-profile-addresses.md](10-customer-profile-addresses.md) | Customer profile and service addresses | T05, T06 | — | NOT_STARTED |
| 11 | T11 | [11-service-request-submission.md](11-service-request-submission.md) | Request submission, references, portal request tracking | T07, T10 | D-35 | NOT_STARTED |
| 12 | T12 | [12-admin-request-queue.md](12-admin-request-queue.md) | Admin queue, request detail, transitions, notes | T11 | D-21 | NOT_STARTED |
| 13 | T13 | [13-admin-customer-management.md](13-admin-customer-management.md) | Admin customer list and detail, history, internal notes | T12 | — | NOT_STARTED |
| 14 | T14 | [14-quotation-builder.md](14-quotation-builder.md) | Quotation editor, server totals, send, void and replace, expiry | T12 | D-19, D-22 | NOT_STARTED |
| 15 | T15 | [15-customer-quotation-decision.md](15-customer-quotation-decision.md) | Customer accept and decline, atomic and duplicate-safe | T14 | — | NOT_STARTED |
| 16 | T16 | [16-technician-management.md](16-technician-management.md) | Technician resources, activation, upcoming assignments | T05 | — | NOT_STARTED |
| 17 | T17 | [17-work-order-scheduling.md](17-work-order-scheduling.md) | Conversion, scheduling, overlap blocking, jobs list and detail | T15, T16 | D-24, D-25 (Q-10) | NOT_STARTED |
| 18 | T18 | [18-job-lifecycle-completion.md](18-job-lifecycle-completion.md) | Start, complete, reschedule, cancel; customer job views | T17 | — | NOT_STARTED |
| 19 | T19 | [19-scheduling-calendar.md](19-scheduling-calendar.md) | Week, day and agenda calendar in business timezone | T17 | — | NOT_STARTED |
| 20 | T20 | [20-invoice-drafting-issuance.md](20-invoice-drafting-issuance.md) | Invoice drafts, issuance with snapshot, void, status derivation | T18 | D-26 | NOT_STARTED |
| 21 | T21 | [21-payment-recording.md](21-payment-recording.md) | Manual payments, overpayment prevention, payment voids | T20 | — | NOT_STARTED |
| 22 | T22 | [22-invoice-pdf-customer-portal.md](22-invoice-pdf-customer-portal.md) | Invoice PDF, customer invoice portal | T21 | — | NOT_STARTED |
| 23 | T23 | [23-dashboard-overview-exports.md](23-dashboard-overview-exports.md) | Admin dashboard KPIs, needs attention, portal overview, CSV | T22 | — | NOT_STARTED |
| 24 | T24 | [24-demo-data-safeguards.md](24-demo-data-safeguards.md) | Showcase seed, invariant checker, demo reset and safeguards | T23 | Q-11 | NOT_STARTED |
| 25 | T25 | [25-quality-hardening.md](25-quality-hardening.md) | Full-journey E2E, authorization matrix, a11y, responsive, security sweep | T24 | — | NOT_STARTED |
| 26 | T26 | [26-production-release.md](26-production-release.md) | Production demo release and runbook | T09, T25 | Q-09 | NOT_STARTED |
| 27 | T27 | [27-documentation-portfolio.md](27-documentation-portfolio.md) | README, architecture and API docs, screenshots, case study, final audit | T26 | Q-12 | NOT_STARTED |

Status values: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `COMPLETED`. Keep this column in sync with `docs/IMPLEMENTATION_PROGRESS.md`.

## Prompt structure

Every prompt has the same sections:
- **A** — Identification
- **B** — Context (spec sections, decisions, requirement IDs)
- **C** — Prerequisites
- **D** — Scope (in and out)
- **E** — Implementation instructions
- **F** — Quality requirements
- **G** — Acceptance criteria
- **H** — Testing and verification
- **I** — Documentation and progress updates
- **J** — Completion report

Shared rules (stack, conventions, security, UI standards, testing, progress rules) live in `/CLAUDE.md` and are not repeated in each prompt.

## Related documents

- `docs/IMPLEMENTATION_PLAN.md` — roadmap, phases, dependency graph, testing strategy
- `docs/REQUIREMENTS_TRACEABILITY.md` — requirement → task → verification
- `docs/DECISIONS_AND_OPEN_QUESTIONS.md` — decisions (D-xx), conflicts (C-xx), questions (Q-xx)
- `docs/IMPLEMENTATION_PROGRESS.md` — persistent progress tracker
