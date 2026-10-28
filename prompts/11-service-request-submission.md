# T11 — Service Request Submission and Customer Request Tracking

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T11 |
| Title | Service request submission and customer request tracking |
| Phase | 3 — Customers and service requests |
| Objective | Implement workflow 7.1. An authenticated customer submits a validated request for an active service. The server creates it atomically with a readable reference, an address snapshot, activity and notifications. The customer sees a confirmation and can track only their own requests in the portal. |

## B. Context

- Read first: `CLAUDE.md`; spec §4.3, §6.2, §7.1 (all steps and the "reference is not an authorization secret" note), §7.7, §8.3 (FR-020…FR-022), §9.1 (`/request-service`), §9.3 (portal requests), §11 (BR-02, BR-03, BR-17, BR-19, BR-21), §12.1 (`ServiceRequest`, `RequestNote`), §14.2, §17.1.
- Decisions: D-17 (`FF-YYYY-NNNNN`), **D-35 (preferred window, PROPOSED; confirm)**, D-36 (snapshots), D-45 (`submissionKey` idempotency), D-38 (notifications: admins in-app, admin email, customer confirmation email), D-41, D-29, D-12 (rate limit).
- Requirements: FR-006 (direct-API rejection), FR-020, FR-021, FR-022, FR-090 (request received), BR-02, BR-03, BR-21, WF-7.1, WF-7.7 (partial), AC-RQ-01…RQ-04, IA-P06, IA-C02, TS-UNIT-07 (dates), TS-INT-02 (requests), API-06, NFR-01.

## C. Prerequisites

- T07 (active services API) and T10 (addresses, `AddressSelector`) `COMPLETED`. T06 notification and email infrastructure is available.
- Confirm D-35 with the user.

## D. Scope

**In scope — API** (`modules/service-requests`, customer part)
- `POST /api/v1/requests` (customer only), with a body containing:
  - `serviceId`
  - `description` (20–2000 chars, trimmed)
  - either `serviceAddressId` (owned) or `newAddress` (address fields) plus `saveAddressToProfile`
  - `preferredDate` (`YYYY-MM-DD`) and `preferredWindow`
  - `submissionKey` (UUID)

  Rules:
  - The service must be active; otherwise `422 SERVICE_UNAVAILABLE`, even through a direct API call (FR-006).
  - `preferredDate` must be between tomorrow and +90 days in the business timezone. Compute `preferredStart`/`preferredEnd` in UTC from the window (D-35) using `@date-fns/tz`, which must be DST-safe.
  - A duplicate `submissionKey` for the same customer returns the existing request with `200` (otherwise `201`).
  - In one transaction: optionally create the profile address, generate the reference, insert the request with service-name and address snapshots, set status `SUBMITTED`, record activity (internal summary plus public summary "Request submitted"), and notify all admins (`REQUEST_RECEIVED`, link `/app/requests/:id`).
  - After commit, send emails: confirmation to the customer (reference, service, preferred window, next steps) and an alert to `settings.contactEmail`.
  - Rate limit: 10 requests/hour per customer.
- `GET /api/v1/requests/me`: paginated, `status` filter, newest first, customer DTO.
- `GET /api/v1/requests/:id`: owner → customer DTO; admin → the same customer DTO (preview, D-41); others → 404. The customer DTO contains: reference, status with label, service name, address snapshot (including the owner's access notes), description, preferred window, submittedAt, **customer-visible** notes (`RequestNote` with visibility `CUSTOMER_VISIBLE`) and the customer timeline (T06). Linked quotation, job and invoice summaries are added by later tasks.
- Customer-facing "next step" text derived from status (e.g. SUBMITTED → "We're reviewing your request and will send a quotation."), kept in shared status metadata.

**In scope — Web**
- `/request-service` (customer-only; unauthenticated users are redirected to `/login?returnTo=/request-service?service=<slug>`, and the service preselection is preserved after login):
  - A single page with clear numbered sections (or a stepper that keeps all values): 1) Service (cards or radio, preselected from `?service=`; inactive or unknown → message and choice), 2) Describe the problem (helper text with examples, character counter), 3) Service address (`AddressSelector` with saved addresses or a new one with a "Save to my profile" toggle), 4) Preferred date and time window (date input with min/max, window radio with times shown in the business timezone and the note "This is a preference — we'll confirm the exact time"), 5) Review and submit.
  - Inline validation (Zod on the client for UX; the server is authoritative), with 422 `fieldErrors` mapped to fields. The submit button shows a loading state and is disabled while pending. The `submissionKey` is generated once per form session. Values are preserved on error.
  - On success, navigate to `/portal/requests/[id]?submitted=1`, which shows a confirmation panel (reference, status `Submitted`, what happens next).
- `/portal/requests`: list with reference, service, status badge, submitted date and next-step text; status filter; pagination; empty state with the CTA "Request a service".
- `/portal/requests/[id]`: PageHeader (reference, status), details, address, preferred window in the business timezone, "What happens next", customer-visible notes, and customer timeline.
- `/portal` home: a "Your requests" section (latest 3, link to all) and the CTA. Portal nav entry "Requests".
- Point the public site's "Request a service" CTAs at `/request-service` (undo any T08 interim handling).

**Out of scope**
Admin request queue and detail (T12), quotations (T14), customer cancellation (D-39), file attachments (spec §24.6).

## E. Implementation instructions

1. Inspect the T07 services module, the T10 address services and components, the T06 notify/email/timeline helpers and the T03 `nextReference`.
2. Implement the domain helpers first (window to UTC conversion, date-range validation), then the service with its transaction, then the routes and DTOs, then the tests, then the UI.
3. The customer DTO is built by an explicit allowlist mapper. Add a test that inserts an `INTERNAL` note and an internal-only activity event, then asserts that neither appears.
4. Use the injected `Clock` for date validation so tests are deterministic. Include a DST-transition date in the business timezone.

## F. Quality requirements

- Validation failure creates nothing: no partial request and no address (the transaction rolls back). Test this explicitly.
- Logs never contain the description or the address.
- The reference is never used for access. A lookup by ID still checks ownership.
- The form is genuinely usable on a 360 px phone: comfortable tap targets, no horizontal scroll, and readable helper text.

## G. Acceptance criteria

1. A demo customer submits a valid request. It receives a reference matching `^FF-\d{4}-\d{5}$`, status SUBMITTED and the correct snapshots, and is listed in `/requests/me` and in the portal.
2. Invalid input returns 422 with field errors, the UI shows them beside the fields with values preserved, and no records are created.
3. An inactive service (unpublished or archived) is rejected through the UI **and** a direct API call. Another customer's `serviceAddressId` returns 404 or 422 with nothing created.
4. Repeating a POST with the same `submissionKey` creates no duplicate.
5. Customer B gets 404 for customer A's request. The customer DTO never includes internal notes or internal activity. An admin GET of `/requests/:id` returns the customer DTO.
6. Admins receive a `REQUEST_RECEIVED` notification. Customer and admin emails are logged (`LOGGED` with the log transport).
7. An unauthenticated visitor clicking "Request this service" is sent to login and, after demo sign-in, returns to the form with the service preselected.
8. The preferred window converts correctly to UTC in the business timezone, including across a DST change (unit tests).
9. Lint, typecheck, unit, integration, build and E2E pass, and axe is clean on the form, list and detail.

## H. Testing and verification

- Unit: window conversion, the date-range validator, next-step text mapping.
- Integration: G.1–G.6, plus the rate limit (429) and an admin attempting `POST /requests` (403).
- E2E: the full customer submission from the service detail page through confirmation to the list; the validation error path; mobile width (360 px) submission.
- Run all standard commands and record the results.

## I. Documentation and progress updates

- Progress, traceability (FR-006 enforcement, FR-020…FR-022, FR-090 request event, BR-02/03/21, WF-7.1, AC-RQ-01…04, IA-P06, IA-C02, TS-INT-02 requests, API-06), `prompts/README.md`, decisions (D-35 → `ACCEPTED`), `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results
- limitations
- a suggested commit message
- the next task: **T12 — Admin request queue and request review** (`prompts/12-admin-request-queue.md`)
