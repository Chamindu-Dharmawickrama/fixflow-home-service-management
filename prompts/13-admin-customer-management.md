# T13 — Admin Customer Management

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T13 |
| Title | Admin customer management |
| Phase | 3 — Customers and service requests |
| Objective | Let admins find customers quickly and see each customer's contact details, addresses and complete history (requests, quotations, jobs, invoices), with private internal customer notes clearly separated from customer-visible data. |

## B. Context

- Read first: `CLAUDE.md`; spec §4.3 ("find customer history quickly"), §8.4 (FR-030…FR-033), §9.2 (`/app/customers`, `/app/customers/[id]`), §12.1–12.2.
- Decisions: D-41, D-34, D-39 (admins do not edit customer profiles in the MVP), D-26 (outstanding balance = Σ (total − amountPaid) over ISSUED/PARTIALLY_PAID/OVERDUE invoices).
- Requirements: FR-031, FR-033, SEC-DATA-03, IA-A08, IA-A09, TS-INT-07.
- Quotations, work orders and invoices don't have data yet (T14–T22). Their tabs query the real tables and show empty states until those tasks create records. That is real behaviour, not fake UI.

## C. Prerequisites

- T12 `COMPLETED`.

## D. Scope

**In scope — API** (`modules/customers`, admin part)
- `GET /api/v1/admin/customers`: `q` (name, email, phone), `sort` ∈ {`name`, `createdAt`, `lastActivityAt`}, pagination. Each item has: id, name, email, phone, default address city, `requestCount`, `openJobCount`, `outstandingBalance` (string money and `currencyCode`), `lastActivityAt`. Aggregates are computed in a bounded way (grouped queries, no N+1).
- `GET /api/v1/admin/customers/:id`: profile, all addresses with access notes, summary counts, outstanding balance, and the most recent 5 items for each history type.
- `GET /api/v1/admin/customers/:id/history?type=requests|quotations|jobs|invoices&page=`: paginated history per tab.
- `POST /api/v1/admin/customers/:id/notes { body }` and listing within the detail DTO, using `CustomerNote` (internal only). Records an internal activity event.
- Admin request detail (T12) gains a link target: include `customerId` and use the customer detail route.

**In scope — Web**
- `/app/customers`: PageHeader, search (URL-synced), sortable DataTable or cards (name and email, phone, city, requests, open jobs, outstanding balance), pagination, empty and no-match states.
- `/app/customers/[id]`:
  - header with name, contact actions (`mailto:`/`tel:` links) and customer-since date
  - summary stat row (requests, open jobs, outstanding balance)
  - addresses card
  - tabs **Requests | Quotations | Jobs | Invoices**, each paginated with status badges, links and empty states
  - an internal notes panel visually marked "Internal — never shown to the customer"
- Link from the request detail's customer card to the customer page. Admin nav entry "Customers".

**Out of scope**
Editing or deactivating customers (D-39), merging duplicates, CSV export (T23).

## E. Implementation instructions

1. Inspect the T10 and T11 customer and request modules and extend `modules/customers` with admin routes in a separate file and admin DTOs.
2. Write the aggregate queries carefully. Test them with fixtures that include several customers, verify that the counts and the balance are correct, and confirm that other customers' records never appear in one customer's history.
3. Build the UI and reuse the T04 Tabs, DataTable, StatCard, EmptyState and Timeline components.

## F. Quality requirements

- Internal customer notes never appear in any customer-facing endpoint. Add a test that calls `/customers/me` and `/requests/:id` as the customer.
- Money is shown through `MoneyText` with the currency code.
- Search is case-insensitive and safe (parameterized via Prisma), and phone search normalizes punctuation.

## G. Acceptance criteria

1. Admins can search customers by name, email or phone. Sorting and pagination work, and customers get 403.
2. Customer detail shows correct addresses, counts, outstanding balance and paginated history per tab. Only that customer's records appear (fixture test with two customers).
3. Internal customer notes can be added, are listed with author and time, and never reach customer endpoints.
4. The request detail links to the customer detail.
5. The UI handles loading, empty and error states, works at 4 widths and is axe-clean.
6. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Integration: search, sort, aggregates, history isolation, notes visibility, authorization.
- E2E: the admin searches "Alex", opens the customer, sees the request in the Requests tab, adds an internal note, and opens the request from history.
- Run all standard commands.

## I. Documentation and progress updates

- Progress, traceability (FR-031, FR-033, SEC-DATA-03, IA-A08, IA-A09, TS-INT-07), `prompts/README.md`, `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results
- limitations
- a suggested commit message
- the next task: **T14 — Quotation builder, sending and replacement** (`prompts/14-quotation-builder.md`)
