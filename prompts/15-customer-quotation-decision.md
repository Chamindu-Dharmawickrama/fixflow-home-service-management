# T15 — Customer Quotation Review and Decision

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T15 |
| Title | Customer quotation review and decision |
| Phase | 4 — Quotations |
| Objective | Implement workflow 7.3. A customer reviews a clear, professional quotation in the portal and explicitly accepts or declines it. The server verifies ownership, status and expiry atomically, records actor and time, updates the request, and notifies the business. Double acceptance, late acceptance and cross-customer acceptance are impossible. |

## B. Context

- Read first: `CLAUDE.md`; spec §4.3 (customer needs), §6.2–6.3, §7.3 (all, including "acceptance is a recorded business decision, not an electronic signature"), §8.5 (FR-044, FR-045), §9.3 (`/portal/quotations/[id]`), §11 (BR-08), §14.3, §15.3, §17.1.
- Decisions: D-22, D-23, D-21 (ACCEPTED/DECLINED), D-41, D-46 (conditional updates for customer decisions), D-38 (admins notified), D-12 (rate limit).
- Requirements: FR-044, FR-045, FR-090 (decision), BR-08, SM-QUO (customer side), SM-REQ, WF-7.3, WF-7.7 (partial), AC-RQ-07…RQ-09, IA-C03, TS-INT-02 (quotes), TS-INT-03, SEC-TXN-02, DM-06, UX-INT-02/04.

## C. Prerequisites

- T14 `COMPLETED` (customer quotation DTO endpoint, expiry sync, notifications).

## D. Scope

**In scope — API**
- `GET /api/v1/quotations/me`: the customer's non-DRAFT quotations (SENT first, then the rest), paginated, with effective status.
- `POST /api/v1/quotations/:id/accept` (customer):
  - In one transaction: run the expiry sync, then a conditional update `WHERE id = :id AND customer_id = :customerId AND status = 'SENT' AND valid…`. If 0 rows are affected, determine the reason: not found or not owned → `404`; EXPIRED, VOID, ACCEPTED or DECLINED → `409 QUOTATION_NOT_AVAILABLE` with a message specific to the actual status.
  - On success: ACCEPTED, `respondedAt`, `respondedByUserId`; the request becomes ACCEPTED (system); activity (public "You accepted quotation QT-…"); `notifyAdmins(QUOTATION_ACCEPTED, link /app/quotations/:id)`.
  - After commit, email `settings.contactEmail`.
  - The request gains the `CREATE_WORK_ORDER` action (implemented in T17; until then only expose the data, and do not render a dead button).
- `POST /api/v1/quotations/:id/decline { reason? }`: same guards; reason ≤ 500 chars. On success: DECLINED, request DECLINED, activity, admin notification and email.
- Admins calling accept or decline get 403. Rate limit: 20 decisions/hour per customer.

**In scope — Web**
- `/portal/quotations/[id]`, a professional document view:
  - business header (name, contact), "Quotation QT-…", request reference, issue (sent) date, **valid until** with remaining days ("Valid until 17 Nov 2026 — 5 days left")
  - service and address; line items table (stacked on mobile); subtotal, discount, tax (rate shown) and **total** emphasised, all in the document's currency
  - terms and customer note
  - an action bar (sticky on mobile) with **Accept quotation** and **Decline**:
    - Accept ConfirmDialog: total, what happens next ("We'll contact you to schedule the work"), and the note "This records your acceptance; it is not a contract signature."
    - Decline dialog: optional reason ("Help us improve — why are you declining?")
    - loading states and duplicate-click protection
    - after server success: a success banner and status update via refresh
  - state banners for ACCEPTED (date), DECLINED, EXPIRED ("This quotation has expired — contact us for an updated quote") and VOID ("This quotation was withdrawn"); actions are hidden when not available
  - a print button with a print stylesheet
- Portal request detail: a quotation card (status, total, valid until, "Review quotation" link); for VOID or replaced quotations, a link to the current one.
- `/portal` home: an **"Awaiting your decision"** section listing SENT quotations with totals and validity, shown prominently.
- Admin views (T14 pages, request detail): the decision is visible, with status, `respondedAt` and decline reason, without extra work beyond verifying that the data shows.

**Out of scope**
Work-order creation (T17), negotiation or comments threads, e-signatures.

## E. Implementation instructions

1. Inspect the T14 quotations module, the customer DTO and the expiry sync, and the T11 portal pages.
2. Implement the decision service with conditional updates, plus a concurrency test that fires accept and decline in parallel with `Promise.all` and asserts that exactly one succeeds, the final state is consistent, and only one admin notification exists.
3. Build the document view from the T04 document-view pattern and the T14 shared `DocumentTotals`. Review screenshots at 360 and 1440 px.
4. Add E2E tests for both the accept and the decline paths with the demo customer, and an expired-quotation case created by seeding a past `validUntil` through the API or test fixtures.

## F. Quality requirements

- Ownership comes only from the session. Customer B probing A's quotation ID gets 404 on GET, accept and decline, and the record is unchanged.
- Error messages are specific and helpful, e.g. "This quotation expired on 17 Nov. Contact us and we'll send an updated quotation."
- The document view prints cleanly on A4 and Letter with no clipped totals; spot-check in browser print preview.

## G. Acceptance criteria

1. A customer can accept a SENT, unexpired quotation they own. The quotation becomes ACCEPTED with `respondedAt`/`respondedBy`, the request becomes ACCEPTED, the activity event is recorded, and admins are notified and emailed.
2. A customer can decline (optional reason). The quotation and the request become DECLINED, and admins are notified.
3. Accepting twice, accepting an EXPIRED (clock-driven) or VOID quotation, or declining an ACCEPTED one returns 409 with a status-specific message, and the record is unchanged.
4. Customer B gets 404 for A's quotation on all three endpoints, a DRAFT returns 404 for its owner, and an admin calling accept returns 403.
5. Concurrent accept and decline results in exactly one success.
6. The portal document view, action dialogs, banners, the overview "Awaiting your decision" section and the request-detail quotation card all work at 4 widths and are axe-clean.
7. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Integration: G.1–G.5, plus rate limiting.
- E2E: the customer accepts (and the admin sees ACCEPTED on the request detail); a second scenario declines with a reason; the expired-quote view shows the expired banner with no actions.
- Run all standard commands.

## I. Documentation and progress updates

- Progress, traceability (FR-044, FR-045, FR-090 decision, BR-08, SM-QUO, SM-REQ, WF-7.3, AC-RQ-07…09, IA-C03, TS-INT-02/03, SEC-TXN-02, DM-06), `prompts/README.md`, `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results, including the concurrency test
- limitations
- a suggested commit message
- the next task: **T16 — Technician resource management** (`prompts/16-technician-management.md`)
