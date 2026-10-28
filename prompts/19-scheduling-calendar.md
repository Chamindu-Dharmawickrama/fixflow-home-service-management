# T19 — Scheduling Calendar

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T19 |
| Title | Scheduling calendar |
| Phase | 5 — Technicians, scheduling and job execution |
| Objective | Give admins a clear, accessible calendar of scheduled work (week and day views plus an agenda list for small screens), filterable by technician, positioned correctly in the business timezone. It provides safe rescheduling and obvious conflict feedback, reusing the T17 scheduling rules. |

## B. Context

- Read first: `CLAUDE.md` §10; spec §7.4, §8.6 (FR-052), §9.2 (`/app/calendar`: "Day/week/month view or a focused week view, job detail drawer, conflict feedback"), §10.3 ("Calendar" quality bar: clear date navigation, readable blocks, obvious conflict feedback, safe rescheduling controls, list view alternative), §11 (BR-17), §23 (scheduling complexity).
- Decisions: D-25, D-42 (timezone handling), D-39 (no drag-and-drop), D-40.
- Requirements: FR-052 (calendar), FR-053 (reschedule from calendar), BR-17, UX-QB-CAL, IA-A06, NFR-02, NFR-03.

## C. Prerequisites

- T17 `COMPLETED` (scheduling API, conflict endpoint, scheduling dialog). T18 is not required, but if it is done, calendar blocks show its statuses.

## D. Scope

**In scope — API**
- `GET /api/v1/admin/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&technicianId=`:
  - the range is interpreted in the business timezone; the maximum span is 42 days (otherwise 422)
  - returns compact items for work orders with `scheduledStart` in the range and status SCHEDULED, IN_PROGRESS or COMPLETED, optionally including CANCELLED and NEEDS_RESCHEDULING via a flag: id, reference, status, start, end, technician (id, name, color), customer name, service name, city
  - also returns a `needsScheduling` list (PENDING_SCHEDULING and NEEDS_RESCHEDULING, max 20) and the business timezone
  - admin only; no pagination needed because the range is bounded, but cap the results (e.g. 500) and indicate truncation

**In scope — Web** (`/app/calendar`)
- **Toolbar**: Today, previous/next, a date picker, a view switcher (Week | Day | Agenda), technician filter (multi or single), and a legend of technician colours. The URL carries `view`, `date` and `technician`.
- **Week view** (default at ≥ 1024 px):
  - 7 day columns × an hour grid (the default visible range 07:00–20:00 adapts to include early or late jobs)
  - a header row with day name and date, today highlighted, and a current-time indicator
  - **blocks** positioned by business-timezone time: technician colour plus a status shown by text or icon (never colour alone), with time, reference, customer and service, truncated gracefully
  - overlapping blocks within a column laid out side by side (layout algorithm)
- **Day view** (default at 768–1023 px): a single column, optionally split by technician.
- **Agenda view** (default below 768 px, and available everywhere as the list alternative): grouped by day, chronological cards with the same information, and empty days collapsed.
- **Job drawer**: opens when a block or card is activated and shows a job summary with a status badge, links to the full job, and **Reschedule**, which reuses the T17 scheduling dialog and its conflict pre-check and server 409 handling. After success, the calendar refreshes.
- **Needs scheduling panel**: a side panel (sheet on mobile) listing unscheduled or needs-rescheduling jobs, each with a "Schedule" action using the same dialog.
- **Accessibility**: blocks are buttons with full accessible names ("Tuesday 10:00 to 12:00, JOB-2026-00031, AC Routine Maintenance, Alex Morgan, assigned to Jordan Lee, Scheduled"). The grid has a sensible reading order and keyboard navigation (Tab between blocks; optional arrow keys). It is announced as a calendar region with the visible range as a heading, and reduced motion is respected.
- **States**: a loading skeleton for the grid, an empty week ("No visits scheduled this week" plus the needs-scheduling count with a link), and an error with retry.
- Admin nav entry "Calendar".

**Out of scope**
Drag-and-drop or resize rescheduling (D-39), month view (optional; implement it only if time allows, and only if it is as polished as the rest), working hours or availability (D-39), external calendar sync.

## E. Implementation instructions

1. Inspect the T17 scheduling dialog and conflict endpoint, the T16 technician colours and the T04 tokens. Reuse the dialog rather than duplicating it.
2. Implement pure, unit-tested helpers in `features/admin/calendar/lib`:
   - week range from a date in the business timezone (week starting Monday; record the choice)
   - block positioning (minutes from the visible start, height from the duration; jobs crossing midnight are clipped per day)
   - an overlap layout algorithm (columns per cluster)
   - visible-hours computation
3. Build the views with CSS grid and no heavy calendar library. If you believe a library is warranted, justify it in the completion report and record a decision.
4. Run tests with the browser timezone set differently from the business timezone (Playwright `timezoneId`, e.g. `Asia/Colombo` vs business `America/New_York`) and assert that a 10:00 business-time job renders in the 10:00 row. Include a week containing a DST change.
5. Check that technician colours keep text contrast at AA on blocks. Use a text colour token computed per colour.

## F. Quality requirements

- Visual quality: crisp grid lines, readable blocks at all supported widths, no overlapping text, consistent spacing with the rest of the admin app. Capture screenshots at 1440 (week), 1024 (week or day), 768 (day) and 360 (agenda) px and review them.
- Rescheduling is safe. The dialog states the change ("Move JOB-… from Tue 10:00 to Wed 14:00?"), requires a reason as in T17, and handles conflicts clearly.
- Performance: one request per range change. Avoid re-render storms and memoize the layout.

## G. Acceptance criteria

1. The calendar endpoint returns the correct jobs for business-timezone ranges, enforces the 42-day limit, and is admin-only.
2. Week, day and agenda views render jobs at the correct business-timezone positions even when the browser timezone differs, including in a DST week (unit plus E2E).
3. Overlapping jobs (for different technicians at the same time) render side by side without overlapping text.
4. The job drawer opens from blocks and cards. Rescheduling from the calendar works end to end, shows a server conflict (409) clearly, and refreshes the view after success.
5. The needs-scheduling panel lists unscheduled jobs and schedules them through the same dialog.
6. Accessible names, keyboard operation and focus management are in place; axe reports no serious or critical violations; there is no overflow at 4 widths, and the agenda view is fully usable at 360 px.
7. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Unit: week range, positioning, overlap layout, visible hours, DST.
- Integration: calendar endpoint range handling and authorization.
- E2E: navigate weeks, filter by technician, open the drawer, reschedule (success and conflict), schedule from the needs-scheduling panel, agenda at 360 px, axe; a run with `timezoneId` different from the business timezone.
- Run all standard commands.

## I. Documentation and progress updates

- Progress (screenshots reviewed), traceability (FR-052 calendar, FR-053, BR-17, UX-QB-CAL, IA-A06), `prompts/README.md`, decisions (week start, library choice if any), `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results
- screenshots reviewed
- limitations
- a suggested commit message
- the next task: **T20 — Invoice drafting, issuance and voiding** (`prompts/20-invoice-drafting-issuance.md`), which requires T18 to be complete
