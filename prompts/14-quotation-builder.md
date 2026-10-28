# T14 — Quotation Builder, Sending and Replacement (Admin)

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T14 |
| Title | Quotation builder, sending and replacement (admin) |
| Phase | 4 — Quotations |
| Objective | Implement workflow 7.2 steps 4–8. Admins create draft quotations with multiple line items, see a live preview of totals that the server recalculates authoritatively, preview the customer-facing document, and send it. Sent quotations are immutable, and replacements and voids preserve history. Expiry is handled deterministically. |

## B. Context

- Read first: `CLAUDE.md`; spec §6.2–6.3, §7.2, §8.5 (FR-040…FR-047), §10.3 ("Quotation editor" quality bar), §11 (BR-05…BR-07, BR-16, BR-18), §12.1 (`Quotation`, `QuotationLineItem`), §12.3, §14.3, §15.3.
- Decisions: D-18, **D-19 (calculation, PROPOSED)**, D-20, **D-22 (quotation lifecycle, PROPOSED)**, D-21 (request sync), D-23 (expiry sync), D-44 (shared calc), D-43, D-46, D-41, D-38, D-17 (`QT-` reference). Confirm D-19 and D-22 before starting.
- Requirements: FR-040…FR-043, FR-046, FR-047, FR-090 (quotation sent), FR-102 (validity default), BR-05, BR-06, BR-07, BR-16, SM-QUO (admin side), SM-REQ (QUOTED and reversion), WF-7.2, AC-RQ-05, AC-RQ-06, UX-QB-QUO, UX-INT-01/02/04, DM-04, IA-A04, TS-UNIT-01, SEC-TXN-03/04.

## C. Prerequisites

- T12 `COMPLETED` (request transitions, `availableActions`, detail page). Confirm D-19 and D-22 with the user.

## D. Scope

**In scope — shared**
- `@fixflow/shared/money`: `calculateDocumentTotals({ lines: [{ quantity, unitPrice, taxable }], discountAmount, taxRate })` → string decimals `{ lines: [{ lineSubtotal }], subtotal, taxableSubtotal, discountAmount, taxableBase, taxAmount, totalAmount }`. Implemented with `decimal.js` per D-19, with input validation against `LIMITS`. Worked examples (must be unit tests, taxRate 8.00):
  1. Lines are 1 × 79.00 (non-taxable), 1 × 45.50 (taxable) and 1.5 × 85.00 (non-taxable), with discount 0. Expected: subtotal **252.00**, taxableBase **45.50**, tax **3.64**, total **255.64**.
  2. The same lines with discount 25.20. Expected: taxableBase **40.95**, tax **3.28**, total **230.08**.
  3. One line of 0.50 × 0.05. Expected: lineSubtotal **0.03** (half-up).
  4. Discount greater than the subtotal returns a validation error. Discount equal to the subtotal gives total 0.00.

**In scope — API** (`modules/quotations`)
- Domain:
  - the quotation transition map (DRAFT → SENT | VOID; SENT → ACCEPTED | DECLINED | EXPIRED | VOID)
  - `effectiveQuotationStatus(q, now, tz)`, which treats a SENT quotation as expired after 23:59:59 on `validUntil` in the business timezone
  - `syncExpiredQuotations(tx, now)`: idempotent; persists EXPIRED, records activity and reverts the request to UNDER_REVIEW when no other SENT quotation remains (D-21)
  - `availableQuotationActions`
- `POST /api/v1/admin/requests/:id/quotations { replacesQuotationId? }`:
  - request must be UNDER_REVIEW or QUOTED, otherwise 409; at most one DRAFT (otherwise 409 `DRAFT_EXISTS`, including the existing ID)
  - pre-fills `currencyCode` and `taxRate` from settings, `validUntil` = today + `quotationValidityDays`, terms from `defaultQuotationTerms`, and one starter line from the service (name; FIXED → startingPrice, else 0.00)
  - when replacing, copies lines from the replaced SENT quotation
  - generates the reference and records activity
  - adds `CREATE_QUOTATION` to the request's `availableActions`
- `GET /api/v1/admin/quotations/:id`: admin DTO with lines, totals, request and customer summary, replacement chain (replaces / replaced by), `availableActions` and the timeline. Run the expiry sync first.
- `PATCH /api/v1/admin/quotations/:id { lines, discountAmount, taxRate, validUntil, terms, customerNote, expectedUpdatedAt }`:
  - DRAFT only, otherwise `409 QUOTATION_NOT_EDITABLE`
  - replaces the lines (1–50); the server recomputes all totals and **ignores client totals** (strict schema: totals keys are rejected)
  - `expectedUpdatedAt` mismatch → `409 STALE_STATE`
- `POST /api/v1/admin/quotations/:id/send { expectedStatus: "DRAFT" }`:
  - validates ≥ 1 line, `totalAmount > 0`, `validUntil ≥ today` (business timezone), request UNDER_REVIEW or QUOTED
  - in one transaction: void the previous SENT quotation if this is a replacement (reason "Replaced by QT-…"), set SENT/`sentAt`/`sentBy`, set the request to QUOTED (system), record activity (public "Quotation QT-… sent") and notify the customer (`QUOTATION_SENT`, link `/portal/quotations/:id`)
  - after commit, email the customer
  - a concurrent or double send leaves exactly one SENT quotation and one notification
- `POST /api/v1/admin/quotations/:id/void { reason, expectedStatus }`: DRAFT or SENT only; reason 5–500 chars; records `voidedAt/By/Reason`. If it was the request's only SENT quotation, the request reverts to UNDER_REVIEW. If it was SENT, the customer is notified that the quotation was withdrawn, without the internal reason unless a customer message is provided.
- `GET /api/v1/quotations/:id` (customer DTO, D-41): owner or admin preview; DRAFT → 404 for customers (admins may preview drafts through this DTO with `?preview=1`). Contains business header info from settings, references, service, address, lines, totals, currency, validity, terms and customer note — **no internal fields**. Accept and decline endpoints come in T15.
- Request integration:
  - the admin request DTO includes a quotations summary (all versions with status, total and sentAt)
  - request CANCEL (T12 hook) voids any DRAFT or SENT quotation in the same transaction
  - the request `availableActions` includes `CREATE_QUOTATION` when allowed

**In scope — Web**
- Request detail: a "Create quotation" primary action (when available) that creates the draft and navigates to the editor; a quotations section listing every version with StatusBadge, total, sent and validity dates, plus links.
- `/app/quotations/[id]`:
  - **DRAFT editor**:
    - header with reference, status, request link, customer
    - line-items table: description, quantity, unit price, taxable checkbox, line total; add, remove and move up/down; keyboard friendly; the mobile layout stacks each line as a card
    - discount input and tax rate input (pre-filled, with a note that it comes from settings)
    - **totals panel** with a live preview from `calculateDocumentTotals`, labelled "Preview — final totals are calculated when you save"
    - validUntil date input, terms textarea, customer note
    - **Save draft** (explicit; shows saved state and time), **Preview** (renders the customer DTO view in a dialog or page), **Send to customer** (ConfirmDialog: "After sending, this quotation can't be edited. The customer will be able to accept or decline it until {date}."), **Void** (reason dialog)
    - 422 `fieldErrors` mapped to the row and field (`lines.2.quantity`)
    - a warning about unsaved changes on navigation
  - **Non-DRAFT read-only view**: the document layout, status banner (e.g. "Sent 3 Nov · valid until 17 Nov", "Expired", "Voided: reason"), actions **Replace** (SENT → creates the replacement draft) and **Void**, the replacement chain and the timeline.
  - Print stylesheet for the document view.
- Extract a reusable `LineItemsEditor` and `DocumentTotals` for T20.

**Out of scope**
Customer accept and decline UI and endpoints (T15), quotation PDF (D-28), percentage discounts (D-39).

## E. Implementation instructions

1. Inspect T12 (request domain, detail page, cancel hook), T07 (settings defaults), T06 (notify, email, timeline) and T03 (constraints, `nextReference`).
2. Implement and unit-test `calculateDocumentTotals` first, starting with the worked examples, then the quotation domain, then the services and routes, then the integration tests, then the UI.
3. The authoritative totals are those the server computes from the stored lines. Assert this with a PATCH that includes fake totals (rejected by the strict schema), and a PATCH that sends lines only, after which the stored totals must equal the shared function's output.
4. Inject the `Clock`. Test expiry by advancing the clock past `validUntil` in the business timezone, including one test where UTC is already the next day but local time is still within the validity date.
5. Review the editor against the spec §10.3 quality bar and the T04 blueprint. Capture screenshots at 1440 and 360 px and refine.

## F. Quality requirements

- No JS-number arithmetic on money anywhere: the editor preview uses the shared decimal function, and inputs are handled as strings.
- Sending is never confused with saving. Labels, visual weight and confirmation differ clearly.
- Totals, statuses and the immutability rules live only in domain and service code, never in route handlers or UI.
- All state-changing endpoints are duplicate-safe (conditional updates, partial unique indexes, `expectedStatus`).

## G. Acceptance criteria

1. The shared calculation passes the worked examples and edge cases, and the server-stored totals always equal the recomputation.
2. A draft can be created only in UNDER_REVIEW or QUOTED requests; a second DRAFT returns 409; the drafts are pre-filled from settings and the service.
3. A DRAFT can be edited; any edit of a SENT, VOID or other non-DRAFT quotation returns 409 and the record is unchanged. Client totals are rejected or ignored.
4. Sending moves the quotation to SENT and the request to QUOTED, notifies and emails the customer, and is duplicate-safe. A replacement send atomically voids the previous quotation with the reason recorded. At most one SENT per request is enforced.
5. Void requires a reason, records actor and time, and reverts the request when appropriate. Expiry via the clock produces EXPIRED, an activity event and request reversion, idempotently.
6. Cancelling a request voids its open quotations in the same transaction.
7. The customer DTO for a quotation has no internal fields (key allowlist test), and customers get 404 for DRAFT quotations.
8. The editor UI meets the quality bar: live preview, field errors on rows, explicit save/preview/send, confirmations, unsaved-changes warning, a mobile card layout, and axe-clean.
9. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Unit: the money function (worked examples, rounding, limits), transitions, `effectiveQuotationStatus`, `availableQuotationActions`.
- Integration: G.2–G.7, concurrency (two parallel sends), the authorization matrix for the new endpoints (customer → 403, unauthenticated → 401).
- Component: `LineItemsEditor` adding and removing rows and the preview updating, error mapping.
- E2E: the admin creates a quotation with 3 lines and a discount, saves, previews, sends, sees the read-only view, then replaces it and sends the replacement. The previous one shows VOID with "Replaced by".
- Run all standard commands.

## I. Documentation and progress updates

- Progress (close the T12 cancel-hook follow-up), traceability (FR-040…FR-043, FR-046, FR-047, FR-102 partial, BR-05/06/07/16, SM-QUO, SM-REQ QUOTED, WF-7.2, AC-RQ-05/06, UX-QB-QUO, DM-04, IA-A04, TS-UNIT-01, SEC-TXN-03/04), `prompts/README.md`, decisions (D-19, D-22 → `ACCEPTED`), `docs/API.md`, `docs/ARCHITECTURE.md` (money calculation, expiry sync).

## J. Completion report

Report:
- what was implemented and the key files
- the worked-example results
- each acceptance criterion with pass/fail
- the commands executed and their results
- screenshots reviewed
- limitations
- a suggested commit message
- the next task: **T15 — Customer quotation review and decision** (`prompts/15-customer-quotation-decision.md`)
