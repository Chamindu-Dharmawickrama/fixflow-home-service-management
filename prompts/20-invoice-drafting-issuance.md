# T20 — Invoice Drafting, Issuance and Voiding

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T20 |
| Title | Invoice drafting, issuance and voiding |
| Phase | 6 — Invoicing and payments |
| Objective | Implement workflow 7.6 steps 1–4. Admins create a draft invoice from a completed job, pre-filled from the agreed quotation, adjust it within the business rules, and issue it with a unique number and a locked snapshot. Invoices are voided with a reason, never deleted. Status derivation is consistent and timezone-correct. |

## B. Context

- Read first: `CLAUDE.md`; spec §6.5, §7.6 (steps 1–4, 8), §8.8 (FR-070, FR-071, FR-074, FR-076, FR-077), §9.2 (`/app/invoices`, `/app/invoices/[id]`), §10.3 ("Invoice" quality bar), §11 (BR-05, BR-13, BR-15, BR-16), §12.1 (`Invoice`, `InvoiceLineItem`), §12.3, §14.4, §15.3.
- Decisions: **D-26 (invoice rules, PROPOSED; confirm)**, D-17 (`INV-` assigned at issue), D-18/D-19/D-44 (shared calculation), D-23 (overdue sync), D-43, D-46, D-41, D-38 (invoice issued notification).
- Requirements: FR-070, FR-071, FR-074 (derivation), FR-076 (invoice void), FR-077, FR-090 (invoice issued), FR-102 (footer and payment instructions snapshot), BR-05, BR-13, BR-15, BR-16, SM-INV, WF-7.6 (part), AC-IP-01, AC-IP-02, AC-IP-06 (invoice), UX-QB-INV (admin view), DM-04, DM-06, DM-07, IA-A11, IA-A12, TS-UNIT-02, TS-INT-05, SEC-TXN-02/04.

## C. Prerequisites

- T18 `COMPLETED` (COMPLETED jobs, ready-to-invoice view). T14 shared `LineItemsEditor` and `DocumentTotals` exist. Confirm D-26.

## D. Scope

**In scope — API** (`modules/invoices`)
- Domain:
  - `deriveInvoiceStatus({ issuedAt, voidedAt, totalAmount, amountPaid, dueDate, now, timeZone })` with precedence `VOID > DRAFT > PAID > OVERDUE > PARTIALLY_PAID > ISSUED`; overdue after 23:59:59 on `dueDate` in the business timezone while the balance is above 0
  - `balanceDue = totalAmount − amountPaid`
  - `syncOverdueInvoices(tx, now)`: idempotent; persists OVERDUE and records activity
  - `availableInvoiceActions`
- `POST /api/v1/admin/work-orders/:id/invoice`:
  - the work order must be COMPLETED, otherwise 409
  - if a non-VOID invoice exists, return `409 INVOICE_EXISTS` with its ID; the partial unique index guarantees this under concurrency
  - creates a DRAFT with no number: lines, discount and `taxRate` copied from the accepted quotation, `currencyCode` snapshot, default `dueDate` = today + `invoiceDueDays` (business timezone), totals computed with the shared function
  - records activity; the job's `availableActions` includes `CREATE_INVOICE`
- `GET /api/v1/admin/invoices`:
  - filters: `status` (effective, including OVERDUE), `customerId`, `q` (number, customer, job reference), `dueFrom`/`dueTo`, `issuedFrom`/`issuedTo`
  - sort by issueDate, dueDate, totalAmount or status; pagination
  - run the overdue sync first
  - each item includes `balanceDue` and `daysOverdue`
- `GET /api/v1/admin/invoices/:id`: admin DTO with lines, totals, `amountPaid`, `balanceDue`, snapshots, payments (an empty list until T21), job, request and quotation links, `availableActions` and the timeline.
- `PATCH /api/v1/admin/invoices/:id`: DRAFT only (otherwise `409 INVOICE_NOT_EDITABLE`). Editable: lines (1–50), discount, taxRate, issueDate (default today), dueDate (≥ issueDate), customerNote. Totals are recomputed; client totals are rejected; `expectedUpdatedAt` is required.
- `POST /api/v1/admin/invoices/:id/issue { expectedStatus: "DRAFT" }`:
  - In one transaction with a conditional update: assign the `INV-` number via `nextReference`, set `issuedAt`/`issuedBy`, `issueDate` (default today) and `dueDate`.
  - Snapshot `businessSnapshot` (name, address, contact), `customerSnapshot` (name, email, service address), `paymentInstructionsSnapshot` and `footerSnapshot` from settings.
  - Status ISSUED; activity (public "Invoice INV-… issued"); notify the customer (`INVOICE_ISSUED`, link `/portal/invoices/:id`).
  - After commit, email the customer (amount due, due date, link).
  - Concurrent issue calls produce one number.
- `POST /api/v1/admin/invoices/:id/void { reason, expectedStatus }`:
  - allowed for DRAFT, ISSUED and OVERDUE invoices with no active payments; otherwise `409 INVOICE_HAS_PAYMENTS` (T21 adds payments; test with fixture payment rows now)
  - reason 5–500 chars; records `voidedAt/By/Reason` and activity
  - if the invoice had been issued, notify the customer that it was voided (customer-safe message)
  - the job becomes eligible for a new invoice

**In scope — Web**
- Job detail (COMPLETED): a **"Create invoice"** primary action that creates the draft and navigates to it; if an invoice exists, a link to it. The jobs "Ready to invoice" tab gets a per-row "Create invoice" action.
- `/app/invoices`: status filter chips (Draft, Issued, Partially paid, Overdue, Paid, Void), search, due-date range, and a DataTable (number or "Draft", customer, job, issue date, due date, total, balance, status with days overdue), with cards on mobile, pagination and empty states. Admin nav entry "Invoices".
- `/app/invoices/[id]`:
  - **DRAFT**: editor using `LineItemsEditor` and `DocumentTotals`, with issue and due dates, customer note, Save draft, Preview, **Issue invoice** (ConfirmDialog: "This assigns invoice number INV-… and locks its contents. Corrections after issuing require voiding."), and Void.
  - **Issued and later**: a print-ready document layout (business and customer snapshot details, invoice number, issue and due dates, lines, subtotal/discount/tax/total, amount paid, **balance due**, payment instructions, footer), a status banner (e.g. "Overdue by 4 days"), a clear separation between "Invoice issued" and "Payments received" (the payments panel is empty with the note "Payments are recorded in the next step", and recording arrives in T21), Void, and the timeline.
  - Print stylesheet.

**Out of scope**
Payment recording (T21), PDF and customer invoice views (T22), multiple invoices per job (D-39), credit notes and refunds.

## E. Implementation instructions

1. Inspect T14 (shared calculation, `LineItemsEditor`, `DocumentTotals`, quotation DTOs), T18 (completed jobs, ready-to-invoice), T07 (settings) and the T03 constraints.
2. Implement the domain derivation and its exhaustive unit tests first (every precedence case, the due-date boundary in the business timezone, zero total), then create, update, issue and void with integration tests, then the UI.
3. The snapshot test: change the business settings and the service price after issuing, then assert that the issued invoice's snapshots and totals are unchanged (DM-04).
4. Concurrency tests: two parallel creates → one invoice; two parallel issues → one number, the other call gets 409.

## F. Quality requirements

- Issued financial content is immutable. Any attempt to PATCH returns 409 and leaves the record unchanged.
- Invoice numbers are sequential per year and unique. Gaps are acceptable only if a transaction rolls back after taking a number; document that this cannot happen silently because number assignment and issue are in the same transaction.
- The document layout is print-ready (A4 and Letter) with no clipping; spot-check browser print preview at both sizes.
- Never show a payment as received in this task.

## G. Acceptance criteria

1. A draft can be created only from a COMPLETED job and is pre-filled from the accepted quotation. A second non-VOID invoice returns 409 (sequential and concurrent). After a void, a new draft is allowed.
2. Draft edits recompute totals on the server; client totals are rejected; an edit after issue returns 409 with the record unchanged.
3. Issuing assigns a unique `INV-YYYY-NNNNN` number, sets the dates, snapshots the business, customer, payment-instruction and footer data, notifies and emails the customer, and is duplicate-safe.
4. Void requires a reason, is blocked when active payments exist, records actor and time, and keeps the invoice in history (no delete route exists).
5. Status derivation follows the D-26 precedence, and the overdue sync persists OVERDUE at the correct business-timezone boundary (clock tests).
6. The invoice list filters (status, customer, due date) and pagination work, and the admin invoice pages meet the quality bar at 4 widths and are axe-clean.
7. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Unit: `deriveInvoiceStatus` (all cases), `balanceDue`, `availableInvoiceActions`.
- Integration: G.1–G.5, the snapshot immutability test, authorization (customer 403).
- E2E: the admin opens the completed job from T18, creates the invoice, adds an extra parts line, saves, issues it and sees the number and the document view; the invoice appears in the list with status Issued.
- Run all standard commands.

## I. Documentation and progress updates

- Progress, traceability (FR-070, FR-071, FR-074 derivation, FR-076 invoice, FR-077, FR-090 invoice issued, FR-102, BR-05/13/15/16, SM-INV, AC-IP-01/02/06, UX-QB-INV admin, DM-04/06/07, IA-A11/A12, TS-UNIT-02, TS-INT-05, SEC-TXN-02/04), `prompts/README.md`, decisions (D-26 → `ACCEPTED`), `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results, including the concurrency and snapshot tests
- limitations
- a suggested commit message
- the next task: **T21 — Manual payment recording and corrections** (`prompts/21-payment-recording.md`)
