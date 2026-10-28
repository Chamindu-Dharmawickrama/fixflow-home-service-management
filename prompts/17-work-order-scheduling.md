# T17 — Work-Order Conversion, Scheduling and Assignment

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T17 |
| Title | Work-order conversion, scheduling and assignment |
| Phase | 5 — Technicians, scheduling and job execution |
| Objective | Implement workflow 7.4. Admins convert an accepted quotation into exactly one work order without re-entering data, then schedule or reschedule it with an active technician. The server blocks overlapping appointments deterministically, including under concurrency, and keeps the customer informed. |

## B. Context

- Read first: `CLAUDE.md`; spec §6.4, §7.4 (all), §8.6 (FR-050…FR-054, FR-057), §9.2 (`/app/jobs`, `/app/jobs/[id]`), §11 (BR-09…BR-12, BR-17), §12.1 (`WorkOrder`), §12.3, §14.3, §15.3, §23 (scheduling complexity).
- Decisions: **D-24 (work-order transitions, PROPOSED)**, **D-25 (block overlaps, PROPOSED; Q-10)**, D-17 (`JOB-`), D-36 (address snapshot), D-21 (CONVERTED_TO_JOB), D-43, D-46, D-41, D-38, D-42. Confirm D-24 and D-25 before starting.
- Requirements: FR-050, FR-051, FR-052 (list), FR-053, FR-054, FR-057, FR-061 (enforcement), FR-090 (job scheduled/rescheduled), BR-09, BR-10, BR-11, BR-17, SM-WO (scheduling), SM-REQ (CONVERTED_TO_JOB), WF-7.4, AC-SJ-01…SJ-03, IA-A05, IA-A07, TS-UNIT-04, TS-INT-04, SEC-TXN-02, DM-06.

## C. Prerequisites

- T15 (accepted quotations) and T16 (technicians, assignable endpoint) `COMPLETED`. Confirm D-24 and D-25.

## D. Scope

**In scope — API** (`modules/work-orders`)
- Domain:
  - the full D-24 transition map (this task uses create → PENDING_SCHEDULING and the schedule/reschedule transitions; T18 adds the rest)
  - `overlaps(a, b)` with half-open intervals
  - `validateSchedule({ start, end, now })`: end > start, duration ≤ 12 h, start ≥ now − 15 min
  - `availableWorkOrderActions`
- `POST /api/v1/admin/quotations/:id/work-order`:
  - The quotation must be ACCEPTED and its request ACCEPTED, otherwise 409.
  - **Idempotent**: if a work order already exists for this quotation, return it with `200`; otherwise create it with `201`. Concurrency-safe via the unique `quotationId`: catch the unique violation and return the existing row.
  - Copies customer, service (and name snapshot) and the address snapshot from the request. `scopeDescription` is generated from the request description plus the accepted line-item descriptions (editable later only through the scheduling notes; keep it simple).
  - Status PENDING_SCHEDULING; the request becomes CONVERTED_TO_JOB (system); reference `JOB-…`; activity (public "Job JOB-… created").
  - The request's `availableActions` includes `CREATE_WORK_ORDER` when allowed.
- `PATCH /api/v1/admin/work-orders/:id/schedule { scheduledStart, scheduledEnd, technicianId, expectedStatus, reason? }`:
  - allowed from PENDING_SCHEDULING, NEEDS_RESCHEDULING and SCHEDULED (reschedule); `reason` is required when rescheduling an already SCHEDULED job
  - in one transaction:
    - lock the technician row (`SELECT … FOR UPDATE` via `$queryRaw`)
    - check that the technician is active (`422 TECHNICIAN_INACTIVE`)
    - query overlapping SCHEDULED or IN_PROGRESS work orders for that technician, excluding this one; on overlap return `409 SCHEDULING_CONFLICT` with details of the conflicting job (reference, start, end)
    - update the schedule, technician and status → SCHEDULED
    - record activity with old and new times and technician in metadata (FR-057), with the public summary "Visit scheduled for {date, window}" or "Visit rescheduled…"
    - notify the customer (`JOB_SCHEDULED` / `JOB_RESCHEDULED`)
  - after commit, email the customer with times formatted in the business timezone
- `GET /api/v1/admin/work-orders/conflicts?technicianId&start&end&excludeId`: read-only pre-check for the UI that returns any conflicting jobs.
- `GET /api/v1/admin/work-orders`:
  - filters: `status` (multi), `technicianId`, `customerId`, `scheduledFrom`/`scheduledTo` (business-timezone dates), `q` (reference or customer); presets via `view` = `needs-scheduling` | `upcoming` | `in-progress` | `completed` | `all`
  - sort by scheduledStart, createdAt or status; pagination
- `GET /api/v1/admin/work-orders/:id`: admin DTO with scope, schedule, technician, customer, address with access notes, links to the request and quotation, the accepted quotation lines, `availableActions` and the timeline.

**In scope — Web**
- Request detail and the accepted quotation page get a **"Create job"** primary action (when available), which creates the work order and navigates to the job detail with the scheduling dialog open.
- `/app/jobs`: tabs for Needs scheduling / Upcoming / In progress / Completed / All (URL-synced), filters (technician, date range, search), DataTable with cards on mobile (reference, status, customer, service, scheduled time in the business timezone, technician), pagination and empty states.
- `/app/jobs/[id]`:
  - header with reference, StatusBadge and primary action ("Schedule" or "Reschedule")
  - schedule card (date, time range, technician, or a "Not scheduled yet" empty state)
  - scope (lines from the accepted quotation), address and access notes, customer card, links to the request and quotation, and the timeline
- **Scheduling dialog**:
  - date input, start time and duration (or end time) in the **business timezone** (shown explicitly: "Times in America/New_York")
  - technician select (assignable only), showing that technician's other jobs on the chosen day
  - a debounced conflict pre-check with inline feedback ("Conflicts with JOB-2026-00031, 10:00–12:00")
  - reason field when rescheduling
  - submit shows a loading state; a server 409 is displayed clearly with the conflicting job, and inputs are preserved
- Admin nav entry "Jobs".

**Out of scope**
Start, complete, needs-rescheduling and cancel transitions, and customer job views (T18); calendar (T19); invoices (T20).

## E. Implementation instructions

1. Inspect T15 (accepted state), T16 (assignable technicians), T14 (quotation lines DTO), T12 (request actions) and the T03 constraints.
2. Implement the domain and its unit tests first (overlap boundary cases: touching intervals, containment, identical intervals, different technicians), then conversion, then scheduling with locking, then the list and detail endpoints, then the UI.
3. Concurrency tests:
   - two parallel conversions of the same quotation → one work order, and both responses return the same ID
   - two parallel schedule calls for different work orders with the same technician and overlapping times → exactly one succeeds and the other returns 409
4. Time handling: inputs are business-timezone local date and time in the UI. Convert them to UTC ISO in the client using shared helpers, or send local values plus the timezone and let the server convert; choose one approach, document it and test it with a browser timezone different from the business timezone.

## F. Quality requirements

- The overlap rule is enforced only on the server, with the UI check as a convenience. Test it with direct API calls.
- Customers never see technician contact details or internal notes. Customer notifications include only the date, time window and job reference.
- Times are stored in UTC and always displayed with the business timezone.

## G. Acceptance criteria

1. An accepted quotation converts into exactly one work order (sequential and concurrent tests). The request becomes CONVERTED_TO_JOB, and converting a non-accepted quotation returns 409.
2. Scheduling with an active technician and valid times moves the job to SCHEDULED, notifies the customer and records activity.
3. End ≤ start, duration > 12 h or a start in the past returns 422. An inactive technician returns 422 `TECHNICIAN_INACTIVE`. An overlap returns 409 `SCHEDULING_CONFLICT` with conflict details. Back-to-back appointments succeed. Concurrent overlapping schedules let exactly one succeed.
4. Rescheduling requires a reason, records old and new values, and notifies the customer (FR-057). A stale `expectedStatus` returns 409.
5. The jobs list tabs, filters and pagination work, and the job detail shows the full context and correct actions.
6. The scheduling dialog shows business-timezone times, pre-checks conflicts, handles server conflicts gracefully, works at 360 px, and is axe-clean.
7. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Unit: overlap, schedule validation, transitions, `availableWorkOrderActions`, time conversion.
- Integration: G.1–G.4, plus authorization (customer 403) and list filters.
- E2E: the admin converts the accepted quotation from T15's scenario, schedules it with Jordan Lee, tries a conflicting slot for another job (sees the error), then picks a back-to-back slot (succeeds); the customer receives the notification.
- Run all standard commands.

## I. Documentation and progress updates

- Progress, traceability (FR-050, FR-051, FR-052 list, FR-053, FR-054, FR-057, FR-061 enforcement, BR-09…12, SM-WO, WF-7.4, AC-SJ-01…03, IA-A05, IA-A07, TS-UNIT-04, TS-INT-04, SEC-TXN-02, DM-06), `prompts/README.md`, decisions (D-24, D-25 → `ACCEPTED`; time-input approach), `docs/API.md`, `docs/ARCHITECTURE.md` (scheduling and locking).

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results, including the concurrency tests
- limitations
- a suggested commit message
- the next task: **T18 — Job lifecycle, completion and customer job tracking** (`prompts/18-job-lifecycle-completion.md`)
