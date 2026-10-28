# T16 — Technician Resource Management

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T16 |
| Title | Technician resource management |
| Phase | 5 — Technicians, scheduling and job execution |
| Objective | Let admins create, update, deactivate, reactivate and list technician resources (no logins), and see each technician's upcoming assignments. Only active technicians are offered for new assignments. |

## B. Context

- Read first: `CLAUDE.md`; spec §4.2 (technician is a resource record with no login), §6.1, §8.7 (FR-060…FR-063), §9.2 (`/app/technicians`), §11 (BR-11), §12.1 (`Technician`).
- Decisions: D-25 (assignment rules apply in T17), D-39 (no working-hours availability model), D-29.
- Requirements: FR-060, FR-061 (listing part), FR-062, IA-A10. FR-063 (technician login) is **excluded**.
- Work orders are created in T17, so upcoming assignments show an empty state until then. The query runs against the real `work_orders` table.

## C. Prerequisites

- T05 `COMPLETED`. In the recommended sequence this runs after T15.

## D. Scope

**In scope — API** (`modules/technicians`)
- `GET /api/v1/admin/technicians`: `active` filter (`true`/`false`/all), `q` search, pagination. Each item has: name, phone, email, specialties, calendarColor, isActive, `upcomingJobCount` (SCHEDULED or IN_PROGRESS with start ≥ now in the next 14 days) and `nextJob` (reference, start).
- `GET /api/v1/admin/technicians/assignable`: active technicians only (used by the T17 scheduling dialog).
- `GET /api/v1/admin/technicians/:id`: details plus upcoming assignments for 14 days (reference, customer, service, start/end, status) and a simple availability summary: scheduled hours per day for the next 7 days.
- `POST /api/v1/admin/technicians` and `PATCH /api/v1/admin/technicians/:id`:
  - name 2–100 chars
  - phone and email optional and validated
  - specialties: 0–8 tags of ≤ 40 chars each
  - notes ≤ 1000 chars (internal)
  - calendarColor from the token palette allowlist in shared
- `POST /api/v1/admin/technicians/:id/deactivate` and `/activate`: idempotent. The deactivate response includes the number of upcoming assignments that remain assigned, so the UI can warn. Existing assignments are not changed automatically. Both actions record activity.

**In scope — Web**
- `/app/technicians`:
  - PageHeader with a "Add technician" action
  - active/inactive filter tabs and search
  - responsive cards or table (name, specialties, contact, status badge, upcoming jobs, next job)
  - create and edit Sheet with validation
  - Deactivate ConfirmDialog: "Jordan Lee has 3 upcoming jobs. They stay assigned; you can reassign them from each job. Jordan won't be available for new assignments."
  - Activate action
  - per-technician detail drawer or page section with upcoming assignments and the 7-day hours summary
  - empty states
- Admin nav entry "Technicians".

**Out of scope**
Scheduling and assignment (T17), calendar (T19), working hours or recurring availability (D-39), technician login (FR-063).

## E. Implementation instructions

1. Inspect the T03 `Technician` model and seed, the T04 components, and the admin nav config.
2. Implement the API with tests, then the UI, following the established module patterns.

## F. Quality requirements

- Internal technician notes appear only in admin DTOs. Customer-facing DTOs (from T18) expose only the technician's display name.
- Status uses StatusBadge (Active / Inactive). Colour choices come from tokens and meet contrast requirements for text on calendar blocks (T19).

## G. Acceptance criteria

1. Admins can create, update, deactivate and reactivate technicians with validation. Customers get 403 and unauthenticated users get 401.
2. The assignable endpoint returns only active technicians.
3. Deactivation returns and displays the count of upcoming assignments, and the assignments remain unchanged.
4. Upcoming assignments and the hours summary are computed from real work orders (empty until T17; verified with fixture work orders inserted in integration tests).
5. The UI works at 4 widths with loading, empty, error and success states and is axe-clean.
6. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Integration: CRUD, validation, activate/deactivate idempotency, the assignable filter, upcoming-assignment computation with fixture work orders, authorization.
- E2E: the admin adds a technician, edits their specialties, deactivates (seeing the warning) and reactivates.
- Run all standard commands.

## I. Documentation and progress updates

- Progress, traceability (FR-060, FR-061 listing, FR-062, IA-A10; FR-063 stays Excluded), `prompts/README.md`, `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results
- limitations
- a suggested commit message
- the next task: **T17 — Work-order conversion, scheduling and assignment** (`prompts/17-work-order-scheduling.md`)
