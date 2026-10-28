# T23 — Admin Dashboard, Portal Overview and List Exports

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T23 |
| Title | Admin dashboard, portal overview and list exports |
| Phase | 7 — Operational insight |
| Objective | Replace the interim admin home with an action-oriented operational dashboard (meaningful KPIs derived from the database in the business timezone, a needs-attention queue with direct links, upcoming schedule, recent activity). Finalize the customer portal overview, and add privacy-conscious CSV exports for key admin lists. |

## B. Context

- Read first: `CLAUDE.md`; spec §3.2 (goal 4), §4.3 ("know what needs attention today"), §8.9 (FR-080…FR-085), §9.2 (`/app/dashboard`), §9.3 (`/portal`), §10.1 (action-oriented dashboard), §10.3 ("Dashboard" quality bar: 4–5 meaningful KPIs, needs-attention queue, upcoming schedule, recent activity, loading skeleton, empty state).
- Decisions: D-23 (sync time-based statuses first), D-42 (business-timezone boundaries), D-03 (no charts unless they add information), D-41.
- Requirements: FR-080, FR-081, FR-082, FR-083, FR-084 (SHOULD), FR-085 (SHOULD), UX-03, UX-QB-DASH, IA-A01 (final), IA-C01 (final), WF-7.7, NFR-01.

## C. Prerequisites

- T22 `COMPLETED`; all workflow entities now exist.

## D. Scope

**In scope — API**
- `GET /api/v1/admin/dashboard/summary?range=today|7d|30d` (default `7d`). All boundaries are computed in the business timezone, and the expiry and overdue syncs run first. The response includes:
  - **KPIs**, each with `value`, `definition` (plain-language text for FR-085) and `link` (a filtered list URL):
    1. *New requests*: submitted within the range.
    2. *Requests needing action* (current): SUBMITTED + UNDER_REVIEW without a SENT quotation + ACCEPTED not yet converted + DECLINED not yet closed.
    3. *Jobs today / next 7 days*: SCHEDULED or IN_PROGRESS with `scheduledStart` today, plus the upcoming count.
    4. *Completed, awaiting invoice*: COMPLETED with no non-VOID invoice.
    5. *Unpaid balance*: Σ `balanceDue` over ISSUED, PARTIALLY_PAID and OVERDUE (money string and currency), plus the overdue count and amount.
  - **needsAttention**: typed items, priority-ordered and capped at 15, each with a type, a title, context such as "submitted 2 h ago" or "overdue by 6 days", a direct `link`, and the primary action label. Item types:
    - new requests awaiting review
    - accepted quotations awaiting job creation
    - jobs needing scheduling or rescheduling
    - jobs scheduled today not yet started
    - completed jobs awaiting invoice
    - overdue invoices
    - SENT quotations expiring within 2 days
  - **upcomingSchedule**: the next 8 scheduled jobs (time, reference, customer, service, technician).
  - **recentActivity**: the latest 10 activity events (admin audience).
- `GET /api/v1/customers/me/overview`: the customer's action-required items (SENT quotations awaiting a decision, invoices with a balance), upcoming visits, recent requests (latest 3) and counts. Customer DTOs only.
- CSV exports (FR-084, SHOULD):
  - `GET /api/v1/admin/exports/requests.csv`, `/jobs.csv` and `/invoices.csv`, accepting the same filters as the corresponding list endpoints
  - columns are limited to operational fields (references, statuses, dates in the business timezone, service, customer **name** only, city, amounts with currency); **exclude** emails, phones, street addresses, access notes, descriptions and internal notes
  - streamed; RFC 4180 quoting; formula-injection protection (prefix cells starting with `=`, `+`, `-`, `@`, tab or CR with `'`)
  - rate-limited (e.g. 10/min); admin-only; filename with a date stamp

**In scope — Web**
- `/app/dashboard` (replaces the T05 interim page):
  - PageHeader "Good morning, Morgan" (time-of-day in the business timezone), today's date, and the range selector (Today / 7 days / 30 days, URL-synced)
  - **5 StatCards**, each linking to its filtered list, with an info tooltip or popover showing the metric definition
  - **Needs attention** queue (grouped or prioritised list with direct action buttons or links and relative times)
  - **Upcoming schedule** (compact list linking to jobs and the calendar)
  - **Recent activity** (compact timeline)
  - a skeleton loading state, error with retry, and an empty state for a fresh business ("No requests yet — share your services page", with a link)
  - responsive: cards in a 5-up, 3-up, 2-up then 1-up grid; queue and schedule stack on mobile
- `/portal` (final): "Action required" (quotations to review, invoices due) at the top, "Upcoming visits", "Recent requests", and a prominent "Request a service" CTA; an empty state for new customers.
- "Export CSV" buttons on `/app/requests`, `/app/jobs` and `/app/invoices` that respect current filters, with loading and error handling.

**Out of scope**
Charts and revenue reports (spec §24.7; D-03), custom date pickers beyond the three ranges (optional), scheduled reports.

## E. Implementation instructions

1. Inspect every module's list queries and reuse their filter builders for the KPI links and exports. KPI links must land on lists whose filters reproduce the metric.
2. Implement pure helpers for range boundaries (business timezone, DST-safe) and attention classification, with unit tests.
3. Build a deterministic integration fixture: a fixed clock and a known set of requests, quotations, jobs, invoices and payments across statuses and timezone edges. Include a request submitted at 23:30 local time that is 04:30 UTC the next day. Assert the exact KPI values and attention items.
4. Use efficient grouped or aggregate queries (no per-row queries) and keep the endpoint fast (under 300 ms locally with seed data).
5. Build the UI, capture screenshots at 4 widths and review them against the quality bar.

## F. Quality requirements

- No hard-coded or decorative numbers. Every value comes from the database, and the definitions match the queries exactly.
- Exports contain the minimum personal data; review the column list against SEC-DATA-02.
- The dashboard emphasises what needs action now (spec §10.1). Avoid vanity metrics.

## G. Acceptance criteria

1. KPI values match the deterministic fixture exactly for each range, with boundaries in the business timezone (the timezone-edge request counts on the correct local day).
2. Every KPI and needs-attention item links to a real filtered list or record whose contents reproduce the metric or item.
3. Definitions are displayed for each KPI. The range selector changes period-dependent metrics only, and the period-independent ones are labelled "current".
4. The portal overview shows only the customer's own action items, visits and requests (customer B isolation test).
5. CSV exports respect filters, include only the allowed columns, escape correctly, neutralise formula injection, are admin-only and rate-limited.
6. The dashboard and portal overview meet the quality bar with loading, empty and error states, work at 4 widths and are axe-clean.
7. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Unit: range boundaries (DST), attention classification, CSV escaping and injection guard.
- Integration: G.1–G.5.
- E2E: the demo customer submits a request, and the admin's "New requests" KPI and the attention queue include it; clicking the KPI opens the filtered request list containing it; CSV export downloads with the expected header row.
- Run all standard commands.

## I. Documentation and progress updates

- Progress (screenshots), traceability (FR-080…FR-085, UX-03, UX-QB-DASH, IA-A01/C01 final, WF-7.7, NFR-01), `prompts/README.md`, `docs/API.md` (dashboard, overview, exports, with the metric definitions).

## J. Completion report

Report:
- what was implemented and the key files
- the KPI definitions
- each acceptance criterion with pass/fail
- the commands executed and their results
- screenshots reviewed
- limitations
- a suggested commit message
- the next task: **T24 — Showcase demo data and demo-mode safeguards** (`prompts/24-demo-data-safeguards.md`)
