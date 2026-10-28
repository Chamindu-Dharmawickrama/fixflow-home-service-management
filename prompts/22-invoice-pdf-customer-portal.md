# T22 — Invoice PDF and Customer Invoice Portal

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T22 |
| Title | Invoice PDF and customer invoice portal |
| Phase | 6 — Invoicing and payments |
| Objective | Generate professional, print-ready invoice PDFs server-side from persisted snapshots, served only to the owning customer or an admin. Give customers portal views of their invoices with their recorded payment status and balance. |

## B. Context

- Read first: `CLAUDE.md`; spec §7.6 steps 4–5, §7.7, §8.8 (FR-072), §9.3 (portal invoices), §10.3 ("Invoice" quality bar), §15.4 (PDFs from persisted data; authorize before returning), §18.4 (PDF aligned and printable on A4/Letter).
- Decisions: D-28 (lightweight PDF library, bundled fonts and logo, no remote fetches), D-41 (customer DTO), D-26 (customer visibility: DRAFT invisible to customers).
- Requirements: FR-072, SEC-FILE-01, SEC-FILE-02, SEC-AUTH-04 (PDFs), AC-IP-03, UX-QB-INV (PDF and portal), WF-7.6 (steps 4–5), WF-7.7, IA-C05, IA-A12 (download), TS-INT-02 (invoices, PDFs), TS-VQA (PDF print).

## C. Prerequisites

- T21 `COMPLETED`.

## D. Scope

**In scope — API**
- PDF builder `invoices/pdf/`:
  - Choose the library per D-28 (recommended `pdfmake`; record the choice and the reason).
  - Bundle an OFL-licensed font matching the UI (e.g. Inter TTF) and the FixFlow or business logo as a local asset. **Never fetch remote URLs.**
  - The builder accepts only a typed snapshot assembled from the persisted invoice (`buildInvoicePdf(snapshot): Promise<Buffer>`).
  - Layout:
    - business header (name, address, contact) and the logo
    - title "Invoice", number, status label (for VOID invoices, a visible "VOID" watermark; for DRAFT admin previews, a "DRAFT" watermark)
    - bill-to (customer snapshot), service address, job and request references
    - issue and due dates
    - line items table with right-aligned tabular amounts
    - subtotal, discount, tax (rate), **total**, amount paid, **balance due**
    - a payments summary (date, method, amount; active payments only), payment instructions, footer, page numbers
  - Margins and widths fit both A4 and Letter (content within 8.27 in × 11 in).
- `GET /api/v1/invoices/:id/pdf`:
  - authorize first: owner customer (non-DRAFT only) or admin; others → 404; unauthenticated → 401
  - then sync overdue, build and stream
  - headers: `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="INV-2026-00012.pdf"` (inline with `?inline=1`), `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`
  - a builder failure returns `500` with a safe error and leaves no record changes
- `GET /api/v1/invoices/me`: the customer's non-DRAFT invoices (newest first; status filter; pagination) with total, `balanceDue`, status and dates.
- `GET /api/v1/invoices/:id`: customer DTO (owner, non-DRAFT; admin preview allowed):
  - snapshot business and customer details, number, dates, lines, totals, `amountPaid`, `balanceDue`, effective status, payment instructions, footer
  - active payments (date, method, amount); voided payments omitted, or shown only as an adjusted total (record the choice)
  - **no** internal notes, recorder identities or payment notes
- The work-order customer DTO (T18) gets its invoice link (number, status, ID) when an invoice is issued.

**In scope — Web**
- `/portal/invoices`: list cards or table (number, issue date, due date, total, balance due, status), filter (Outstanding / Paid / All), and an empty state.
- `/portal/invoices/[id]`:
  - a document view mirroring the PDF content
  - status and balance highlighted: "Balance due $120.00 by 15 Nov", "Paid in full on 3 Nov", "Overdue"
  - the payments received list
  - payment instructions, with the note "Payments are made directly to CoolBreeze Home Services; FixFlow doesn't process payments"
  - **Download PDF** (loading state, error toast on failure) and Print
- `/portal` home: an **"Outstanding invoices"** section. The portal job detail links to its invoice. Portal nav entry "Invoices".
- Admin `/app/invoices/[id]`: a "Download PDF" action (DRAFT downloads are watermarked).

**Out of scope**
Quotation PDFs (D-28), emailing PDFs as attachments (optional future enhancement), online payment links (NG-03).

## E. Implementation instructions

1. Inspect the T20 and T21 invoice module, DTOs and UI, and the T04 document-view pattern.
2. Build the PDF builder with unit tests:
   - the output starts with `%PDF`
   - the text content includes the invoice number, total and balance (extracted with a dev-only parser such as `pdf-parse`, or by searching uncompressed content if you configure the builder accordingly)
   - a VOID invoice includes the watermark text
3. Implement the endpoints with authorization tests first, then the portal UI.
4. Manual print QA: generate PDFs for an issued, a partially paid and a paid invoice; open them and check print preview at A4 and Letter (no clipped totals or footer, aligned columns). Record the result with screenshots in `artifacts/screenshots/t22/`.

## F. Quality requirements

- Authorization happens before any PDF work; a test asserts the builder is not invoked for unauthorized requests (spy).
- The PDF content comes solely from persisted snapshots: changing settings after issue does not change the PDF (test).
- Untrusted text (customer names, notes, line descriptions) is rendered as plain text, never interpreted as markup.
- Memory-conscious: generation stays in-process and lightweight (no headless browser).

## G. Acceptance criteria

1. The owner downloads their invoice PDF (correct headers and filename). Customer B gets 404 for A's invoice and PDF. Unauthenticated requests get 401. Customers get 404 for a DRAFT. Admins can download any invoice, and drafts come back watermarked.
2. The PDF contains the snapshot details, lines, totals, amount paid, balance, payments summary, instructions and footer, and VOID invoices are watermarked.
3. The PDF is unaffected by settings changes after issue.
4. The portal invoice list and detail show correct balances and statuses with no internal data (DTO key allowlist test), and download works (Playwright download event, non-empty file, expected filename).
5. The portal overview shows outstanding invoices; the job detail links to the invoice.
6. The manual A4 and Letter print checks pass and are documented.
7. Lint, typecheck, unit, integration, build and E2E pass; axe is clean on the portal invoice pages.

## H. Testing and verification

- Unit: PDF builder content and watermark.
- Integration: G.1–G.3 and the customer DTO leak test.
- E2E: the demo customer opens the invoice issued and partially paid in T21, sees the balance, and downloads the PDF; customer-b gets the not-found page for the same URL.
- Manual: the print checks (G.6).
- Run all standard commands.

## I. Documentation and progress updates

- Progress (manual PDF check results), traceability (FR-072, SEC-FILE-01/02, SEC-AUTH-04 PDFs, AC-IP-03, UX-QB-INV, WF-7.6, IA-C05, TS-INT-02, TS-VQA PDF), `prompts/README.md`, decisions (PDF library; voided-payment display), `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- the PDF library choice and why
- each acceptance criterion with pass/fail
- the commands executed and their results
- the manual print check results
- dependencies added
- limitations
- a suggested commit message
- the next task: **T23 — Admin dashboard, portal overview and list exports** (`prompts/23-dashboard-overview-exports.md`)
