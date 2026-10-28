# T18 — Job Lifecycle, Completion and Customer Job Tracking

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T18 |
| Title | Job lifecycle, completion and customer job tracking |
| Phase | 5 — Technicians, scheduling and job execution |
| Objective | Implement workflow 7.4 step 7 and 7.5. Admins move jobs through the permitted lifecycle (start, needs rescheduling, cancel, complete) with required notes and reasons, and completed jobs surface as "ready to invoice". Customers see their own jobs' schedule, status and customer-visible completion details, and never internal notes. |

## B. Context

- Read first: `CLAUDE.md`; spec §6.4, §7.4 step 7, §7.5 (all), §7.7, §8.6 (FR-055, FR-056), §9.3 (portal jobs), §11 (BR-12, BR-16, BR-19), §12.1 (`WorkOrder`), §14.3 (transitions endpoint, `work-orders/me`), §17.2.
- Decisions: D-24, D-43, D-46, D-41, D-38 (job completed / needs rescheduling / cancelled notifications), D-29.
- Requirements: FR-055, FR-056, FR-090 (job completed and others), FR-094, BR-12, BR-16, BR-19, SM-WO, WF-7.5, WF-7.7 (partial), AC-SJ-04…SJ-06, IA-C04, TS-UNIT-03 (work order), TS-INT-02 (jobs), SEC-TXN-04.

## C. Prerequisites

- T17 `COMPLETED`.

## D. Scope

**In scope — API**
- `POST /api/v1/admin/work-orders/:id/transitions { action, expectedStatus, completionNote?, internalNote?, reason?, customerMessage? }`. Actions per D-24:
  - `START` (SCHEDULED → IN_PROGRESS; sets `startedAt`). It is allowed before the scheduled start, but the response includes a warning flag the UI can surface.
  - `MARK_NEEDS_RESCHEDULING` (SCHEDULED or IN_PROGRESS → NEEDS_RESCHEDULING; `reason` required; optional `customerMessage`; keeps the old schedule in activity metadata and clears or keeps the slot per your documented choice, since the old slot must stop blocking the technician (conflict queries already exclude NEEDS_RESCHEDULING))
  - `COMPLETE` (IN_PROGRESS → COMPLETED; `completionNote` required, 10–2000 chars, customer-visible; `internalNote` optional; sets `completedAt`)
  - `CANCEL` (PENDING_SCHEDULING, SCHEDULED or NEEDS_RESCHEDULING → CANCELLED; `reason` required; optional `customerMessage`)

  Each action uses a conditional update on `expectedStatus` (409 `STALE_STATE`); a disallowed action returns 409 `INVALID_STATE_TRANSITION` with the record unchanged. Each records activity with an internal and a public summary, notifies the customer (`JOB_STARTED` is optional and recommended off; `JOB_NEEDS_RESCHEDULING`, `JOB_COMPLETED`, `JOB_CANCELLED`), and sends an email after commit. Internal notes and reasons are never sent to the customer.
- Ready to invoice: `GET /api/v1/admin/work-orders?view=ready-to-invoice` lists COMPLETED work orders that have no non-VOID invoice. The `invoices` table exists; until T20, every COMPLETED job qualifies.
- Customer endpoints:
  - `GET /api/v1/work-orders/me`: upcoming first (SCHEDULED, IN_PROGRESS, NEEDS_RESCHEDULING, PENDING_SCHEDULING), then completed and cancelled; paginated.
  - `GET /api/v1/work-orders/:id`: owner → customer DTO (reference, status with customer-facing explanation, service, scheduled window in UTC plus the business timezone, technician **display name only**, address, customer-visible completion note, `completedAt`, customer timeline, links to the request and quotation, and an invoice link placeholder field filled by T22); admin → the same customer DTO (preview); others → 404.

**In scope — Web**
- Job detail (`/app/jobs/[id]`): action buttons driven by `availableActions`, each with an appropriate dialog:
  - **Start job**: confirm, with a notice if it is before the scheduled time
  - **Complete job**: a form with "Completion summary for the customer" (required, with guidance such as "What was done, parts replaced, any advice") and "Internal note (optional)", clearly labelled
  - **Needs rescheduling**: required reason and optional customer message
  - **Cancel job**: required reason and optional customer message, with consequence text

  A status progress indicator (Pending → Scheduled → In progress → Completed, with exits shown) and completion details sections for both notes, labelled.
- `/app/jobs`: add a "Ready to invoice" tab. The "Create invoice" action itself arrives in T20, so do not render it yet.
- Portal:
  - `/portal/jobs` list: upcoming and past sections, cards with date and time (business timezone), service, status badge and technician first name
  - `/portal/jobs/[id]` detail: what, when, where, who; a status explanation ("Your technician has started work"); the completion summary when completed; the timeline; links to the request and quotation
  - Portal nav entry "Jobs"; `/portal` home **"Upcoming visits"** section; the portal request detail links to its job

**Out of scope**
Invoice creation (T20), calendar (T19), technician-facing UI (FR-063), job photos (spec §24.6), admin correction flow (D-24).

## E. Implementation instructions

1. Inspect the T17 work-order domain, routes and UI, and extend them; do not create a parallel module.
2. Extend the transition map and its table-driven unit test to cover every from × action pair, then implement the endpoint, the customer endpoints and DTO, then the integration tests, then the UI.
3. Add DTO leak tests: set `internalCompletionNote` and internal-only activity, then assert they are absent from `/work-orders/:id` and `/work-orders/me` as the customer, and from customer emails (template input types).
4. Decide how NEEDS_RESCHEDULING treats the old slot (recommended: keep `scheduledStart`/`End` for reference, rely on the status for conflict exclusion, and show the slot as "Previously scheduled" in the UI). Record the choice.

## F. Quality requirements

- A job cannot jump from PENDING_SCHEDULING to COMPLETED (spec §6.4). The test asserts 409 and an unchanged record.
- Customer-facing copy explains each status plainly and never implies something happened that wasn't recorded (spec §5.3).
- Dialog forms preserve input on errors and disable while submitting.

## G. Acceptance criteria

1. START, MARK_NEEDS_RESCHEDULING, COMPLETE and CANCEL follow D-24. Every invalid pair returns 409 and leaves the record unchanged. A missing completion note or reason returns 422. A stale `expectedStatus` returns 409.
2. Completion sets `completedAt`, stores both notes and makes the job appear in "Ready to invoice".
3. Customers see their jobs' schedule, status and completion summary, but never internal notes or technician contact details. Customer B gets 404 for A's job.
4. The relevant customer notifications and emails are created with customer-safe content only.
5. Admin job actions and the portal job pages work at 4 widths, with all states, and are axe-clean.
6. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Unit: the full transition table.
- Integration: G.1–G.4.
- E2E: the admin starts and completes the scheduled job from T17 with both notes; the customer views `/portal/jobs/[id]` and sees the completion summary but not the internal note; the admin marks another job "needs rescheduling" and reschedules it (reusing the T17 dialog).
- Run all standard commands.

## I. Documentation and progress updates

- Progress, traceability (FR-055, FR-056, FR-090 job events, FR-094, BR-12/16/19, SM-WO, WF-7.5, AC-SJ-04…06, IA-C04, TS-UNIT-03, TS-INT-02 jobs, SEC-TXN-04), `prompts/README.md`, decisions (NEEDS_RESCHEDULING slot handling), `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results
- limitations
- a suggested commit message
- the next task: **T19 — Scheduling calendar** (`prompts/19-scheduling-calendar.md`)
