# T21 — Manual Payment Recording and Corrections

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T21 |
| Title | Manual payment recording and corrections |
| Phase | 6 — Invoicing and payments |
| Objective | Implement workflow 7.6 steps 6–8. Authorized staff record payments received outside FixFlow. The server validates amounts against the remaining balance under concurrency, recalculates the balance and status consistently, and handles corrections by auditable voids, never by deletion. |

## B. Context

- Read first: `CLAUDE.md`; spec §5.2 (payments entered by staff after receipt), §5.3 (FixFlow does not collect or verify payments), §6.5, §7.6 (steps 6–8, "no card data"), §8.8 (FR-073…FR-076), §10.3 ("clear distinction between invoice issuance and payment received"), §10.4 ("never show fake payment confirmation"), §11 (BR-14, BR-15, BR-16), §12.1 (`PaymentRecord`), §14.4, §15.3.
- Decisions: D-27 (payment rules), D-26 (status precedence, `amountPaid`), D-46, D-38 (payment-recorded notification), D-43.
- Requirements: FR-073, FR-074, FR-075, FR-076 (payments), FR-090 (payment recorded), BR-14, BR-15, BR-16, SM-INV (payment-driven), WF-7.6 (payments), AC-IP-04, AC-IP-05, AC-IP-06 (payment), UX-QB-INV (payments), UX-INT-06, TS-UNIT-02 (balance), TS-INT-05, SEC-TXN-03/04, NG-03.

## C. Prerequisites

- T20 `COMPLETED`.

## D. Scope

**In scope — API**
- `POST /api/v1/admin/invoices/:id/payments { amount, paymentDate, method, reference?, notes? }`:
  - invoice status must be ISSUED, PARTIALLY_PAID or OVERDUE (after the overdue sync); otherwise 409 (`INVOICE_NOT_PAYABLE`, with a status-specific message for DRAFT, VOID or PAID)
  - `amount` is a decimal string, > 0 with 2 dp max
  - `paymentDate` is not in the future (business timezone)
  - `method` comes from the D-27 enum; `reference` ≤ 100 and `notes` ≤ 500, internal and **never** card or bank credentials (helper text says so)
  - In one transaction: **lock the invoice row** (`SELECT … FOR UPDATE`), compute the remaining balance from the stored `totalAmount` and **active** payments, and reject when `amount > remaining` (`422 PAYMENT_EXCEEDS_BALANCE`, message "This payment exceeds the remaining balance of $X.XX"). Then insert the payment, update `amountPaid` (which must equal the sum of active payments) and the status via `deriveInvoiceStatus`, record activity (public "Payment of $X received on {date}"; metadata: amount, method — no reference or notes content) and notify the customer (`PAYMENT_RECORDED`).
  - After commit, email the customer a receipt-style notice (amount, date, method, remaining balance), worded as "recorded", not "processed".
- `POST /api/v1/admin/invoices/:id/payments/:paymentId/void { reason }`:
  - only an active payment on a non-VOID invoice; reason 5–500 chars
  - in a transaction with the invoice row locked: set `voidedAt/By/Reason`, recompute `amountPaid` and the status (e.g. PAID → PARTIALLY_PAID, ISSUED or OVERDUE), and record activity
  - the customer is notified only if a customer-facing balance changed (customer-safe message)
- There are **no** PATCH or DELETE payment endpoints. Corrections are a void plus a new record.
- The admin invoice DTO includes payments (active and voided, with recorder and void info) and an updated `availableActions` (`RECORD_PAYMENT`, `VOID_PAYMENT`). T20's invoice void now blocks for real when active payments exist.

**In scope — Web** (`/app/invoices/[id]`)
- **Payments panel**: a summary (Total, Paid, **Balance due**) and a payments table (date, method, reference, amount, recorded by, status with a "Voided" badge and reason tooltip or expandable reason), with an empty state.
- **"Record payment"** dialog:
  - helper text: "Record only payments you've actually received outside FixFlow"
  - amount pre-filled with the remaining balance and editable
  - date defaulting to today in the business timezone
  - method select, reference, notes (with the warning "Don't enter card numbers or bank login details")
  - inline validation, and a server 422 shown beside the amount with the remaining balance
  - loading and duplicate-click protection; on success, a toast "Payment recorded" and a refresh
- **"Void payment"** dialog with a required reason and consequence text ("The invoice balance will increase by $X").
- The invoice list balance column and status reflect payments.

**Out of scope**
Payment gateways, refunds, credit balances (FR-075 explicitly rejects overpayment), customer-initiated payments, receipts as PDFs.

## E. Implementation instructions

1. Inspect T20 (invoice domain, derivation, DTOs, UI) and extend it. Keep payment logic in the invoices module (`invoices/payments.*` files) or a sub-module with the same conventions.
2. Write the domain and unit tests for remaining-balance calculation and status after each operation, then the endpoints with locking, then the integration tests, then the UI.
3. Concurrency test: an invoice of 300.00 with two parallel payments of 200.00 must result in exactly one success, the other getting 422, and `amountPaid` 200.00.
4. The invariant test after every scenario: `amountPaid == Σ active payments` and the status equals `deriveInvoiceStatus(...)`.

## F. Quality requirements

- The UI never implies that FixFlow processed a payment. Wording: "Payment recorded", "Recorded by Morgan Reyes".
- Payment history is permanent. Voided payments remain visible with their reason.
- Activity metadata and logs exclude payment references and notes content.

## G. Acceptance criteria

1. A valid payment reduces the balance and updates the status: a partial payment gives PARTIALLY_PAID (or OVERDUE when past due, per precedence) and an exact remaining payment gives PAID.
2. A zero, negative or non-numeric amount, more than 2 dp, a future date or an invalid method returns 422. An amount above the balance returns 422 with the remaining amount in the message. Payments on DRAFT, VOID or PAID invoices return 409.
3. Concurrent payments cannot overpay.
4. Voiding a payment requires a reason, keeps the record, recalculates `amountPaid` and the status, and records activity. No edit or delete path exists (verified by route listing).
5. Invoice void is blocked while active payments exist, and allowed after they are voided.
6. The customer is notified and emailed when a payment is recorded, with customer-safe content.
7. The payments panel and dialogs work at 4 widths, with all states, and are axe-clean.
8. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Unit: remaining balance, status after record and after void, decimal input parsing.
- Integration: G.1–G.6, plus the invariant checks and authorization.
- E2E: the admin records a partial payment (the status becomes Partially paid), attempts an overpayment (sees the error), records the remainder (Paid), then voids one payment with a reason (the status updates).
- Run all standard commands.

## I. Documentation and progress updates

- Progress, traceability (FR-073…FR-076, FR-090 payment, BR-14/15/16, SM-INV, AC-IP-04/05/06, UX-QB-INV payments, UX-INT-06, TS-UNIT-02, TS-INT-05, SEC-TXN-03/04), `prompts/README.md`, `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results, including the concurrency test
- limitations
- a suggested commit message
- the next task: **T22 — Invoice PDF and customer invoice portal** (`prompts/22-invoice-pdf-customer-portal.md`)
