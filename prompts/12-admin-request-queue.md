# T12 — Admin Request Queue and Request Review

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T12 |
| Title | Admin request queue and request review |
| Phase | 3 — Customers and service requests |
| Objective | Give business admins an efficient request queue (search, filters, sorting, pagination, status counts) and a request detail page with full context, customer history, internal and customer-visible notes, a timeline, and validated admin status actions (start review, cancel, reopen). |

## B. Context

- Read first: `CLAUDE.md`; spec §4.3 (admin needs), §6.2, §7.2 steps 1–3, §8.3 (FR-023…FR-026), §9.2, §10.3 ("Request detail" quality bar), §11 (BR-16, BR-19), §12.1 (`RequestNote`), §14.2 admin endpoints, §14.5.
- Decisions: **D-21 (request transitions, PROPOSED; confirm)**, D-43 (`availableActions`), D-46 (`expectedStatus`), D-41, D-29, D-38 (customer notified on cancellation), D-34.
- Requirements: FR-023, FR-024, FR-025, FR-026, FR-094 (notes), BR-16, BR-19, SM-REQ (admin transitions), WF-7.2 (steps 1–3), AC-RQ-04, AC-RQ-05 (review part), UX-QB-REQ, IA-A02, IA-A03, TS-UNIT-03 (request), TS-INT-06, TS-INT-07, SEC-DATA-03.

## C. Prerequisites

- T11 `COMPLETED`. Confirm D-21 with the user.

## D. Scope

**In scope — API**
- `service-requests.domain.ts`:
  - the full D-21 transition map as data
  - `assertRequestTransition(from, to, trigger)` where trigger is `ADMIN` or `SYSTEM`
  - `availableAdminActions(request)` returning `START_REVIEW`, `CANCEL` and `REOPEN` as applicable; T14/T17 add `CREATE_QUOTATION` and `CREATE_WORK_ORDER`

  System transitions are exposed as functions for later tasks: `markQuoted`, `markAccepted`, `markDeclined`, `revertToUnderReview`, `markConvertedToJob`.
- `GET /api/v1/admin/requests`:
  - `q` (reference, customer name or email; case-insensitive)
  - `status` (multi-value), `serviceId`, `customerId`, `submittedFrom`/`submittedTo` (business-timezone dates)
  - `sort` ∈ {`submittedAt`, `updatedAt`, `status`, `reference`}, `order`, pagination
  - response meta includes `statusCounts` for the current non-status filters
  - list item: reference, status, service, customer name, city, preferred date and window, submittedAt, an `isNew` flag (SUBMITTED)
- `GET /api/v1/admin/requests/:id` (admin DTO):
  - everything in the customer DTO plus customer contact (email, phone), access notes, **all** notes with visibility and author, the admin timeline (internal summaries), and `availableActions`
  - customer history: previous requests (reference, service, status, date) and counts of jobs and invoices, with lists added in T13
  - quotations summary, filled in by T14
- `PATCH /api/v1/admin/requests/:id/status { action: "START_REVIEW" | "CANCEL" | "REOPEN", expectedStatus, reason?, customerMessage? }`:
  - Only admin-triggered transitions; system statuses cannot be set here (422/409).
  - CANCEL and REOPEN require `reason` (5–500 chars). CANCEL optionally takes `customerMessage` (customer-visible, ≤ 500).
  - Uses a conditional update on `expectedStatus` → `409 STALE_STATE`. An invalid transition → `409 INVALID_STATE_TRANSITION`, with the record unchanged.
  - Records activity. CANCEL notifies the customer (`REQUEST_CANCELLED`) and emails them the customer message, or a neutral default, but **never** the internal reason.
  - Leave a clearly named hook for T14 to void open quotations on cancel. Note it in the progress file follow-ups if quotations don't exist yet.
- `POST /api/v1/admin/requests/:id/notes { body, visibility }`: body 1–2000 chars. Records activity: `CUSTOMER_VISIBLE` notes get a public summary ("The business added a note") and the customer is notified; internal notes get an internal-only event.

**In scope — Web**
- `/app/requests`:
  - PageHeader "Service requests"
  - status filter chips with counts; search input (debounced, URL-synced); service select; submitted date range
  - sortable columns; DataTable with card fallback on mobile, with row links to detail and SUBMITTED rows marked "New"
  - pagination; empty states for both "no requests yet" and "no matches", with a clear-filters action
  - skeleton loading and error state with retry
- `/app/requests/[id]`:
  - **Header**: reference, StatusBadge, submitted time (business timezone), and a **prominent primary action** from `availableActions` (e.g. "Start review"); secondary actions (Cancel, Reopen) in a menu, each with a ConfirmDialog (cancel: required internal reason plus optional customer message, with a clear explanation of who sees what).
  - **Main column**: problem description, service, preferred window, address and access notes.
  - **Side column**: customer card (name, email, phone, previous requests list).
  - **Notes panel**: composer with a visibility toggle ("Internal — only your team sees this" / "Visible to customer"), notes visually distinguished, newest first.
  - **Timeline**: admin variant.
  - All mutations disable while pending, show toasts on server success, and refresh the page data.
- Admin nav entry "Requests". Update the interim dashboard to link to the request queue, still without fake metrics.

**Out of scope**
Quotation creation UI and actions (T14), work-order creation (T17), customer detail page (T13), CSV export (T23).

## E. Implementation instructions

1. Inspect the T11 module, the T06 timeline and notify helpers, and the T04 DataTable, FilterBar and ConfirmDialog. Extend the existing module; don't fork it.
2. Implement the domain map and a table-driven unit test covering **every** from/to pair and trigger, then the endpoints, then the integration tests, then the UI.
3. Query performance: list queries use the indexes from T03; avoid N+1 queries (use `include`/`select` and a single count query for `statusCounts`).
4. Make the request detail page match the "Request detail" quality bar in spec §10.3 and the T04 blueprint. Capture screenshots at 1440 and 360 px and review them.

## F. Quality requirements

- Customers can never receive internal notes or reasons through any endpoint, email or notification. Add tests at the API level and an E2E check.
- Transition errors return stable error codes with helpful messages, e.g. "This request was updated by someone else. Refresh to see the latest status."
- The UI shows only the actions the server lists, and hides or disables nothing it couldn't explain.

## G. Acceptance criteria

1. Queue filters, search, sort and pagination work and are URL-synced. Status counts are correct. An invalid sort or `pageSize > 100` returns 422. A customer gets 403.
2. The detail view shows full context, customer history, both note types (clearly labelled), the timeline and correct `availableActions`.
3. START_REVIEW, CANCEL and REOPEN follow D-21. Invalid transitions return 409 with the record unchanged, a stale `expectedStatus` returns 409, CANCEL/REOPEN without a reason returns 422, and system statuses cannot be set.
4. Cancellation notifies and emails the customer with only the customer-visible message. A customer-visible note appears in the portal and timeline; an internal note does not (API and E2E).
5. Activity events are written for every status change and note.
6. Lint, typecheck, unit, integration, build and E2E pass; axe is clean on the queue and detail pages; there is no overflow at 4 widths.

## H. Testing and verification

- Unit: the transition table and `availableAdminActions`.
- Integration: G.1–G.5.
- E2E: the admin finds a new request via search, starts the review and adds both note types; the customer sees only the customer-visible note and the "Under review" status.
- Run all standard commands.

## I. Documentation and progress updates

- Progress (including the T14 cancel-hook follow-up), traceability (FR-023…FR-026, FR-094 notes, BR-16, BR-19, SM-REQ admin, WF-7.2 partial, AC-RQ-04, AC-RQ-05 partial, UX-QB-REQ, IA-A02, IA-A03, TS-UNIT-03, TS-INT-06/07, SEC-DATA-03), `prompts/README.md`, decisions (D-21 → `ACCEPTED`), `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results
- screenshots reviewed
- limitations
- a suggested commit message
- the next task: **T13 — Admin customer management** (`prompts/13-admin-customer-management.md`)
