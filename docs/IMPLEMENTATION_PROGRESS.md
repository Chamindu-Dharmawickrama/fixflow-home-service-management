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
| T01 | Repository, tooling & CI foundation | NOT_STARTED | — | 2026-10-28 |
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

- **Status:** NOT_STARTED
- **Dependencies:** —
- **Work completed:** —
- **Tests and verification (commands and actual results):** —
- **Known issues / blockers:** —
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
| — | — | — | — | — |

## 4. Pending external verifications

Track checks that could not run because a credential or service was unavailable. Mark each one done when it has been performed.

| Check | Raised in | Needs | Status |
|---|---|---|---|
| — | — | — | — |
