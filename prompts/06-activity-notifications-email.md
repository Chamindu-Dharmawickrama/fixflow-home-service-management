# T06 — Activity Timeline, Notifications and Email Infrastructure

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T06 |
| Title | Activity timeline, notifications and email infrastructure |
| Phase | 2 — Identity, configuration and public experience |
| Objective | Provide the shared infrastructure every workflow task uses to record history, notify users in-app and send transactional email safely. Customers see only customer-visible history, and email delivery is tracked truthfully and never affects business transactions. |

## B. Context

- Read first: `CLAUDE.md` §7, §9; spec §5.2 (email assumption), §8.10 (FR-090…FR-094), §11 (BR-19, BR-20, BR-22), §12.1 (`Notification`, `EmailDeliveryLog`, `ActivityLog`), §14.4 (notification endpoints), §15.3–15.4.
- Decisions: D-13 (email adapter), D-29 (unified activity), D-38 (events and recipients), D-41 (separate serializers), D-40 (notification polling).
- Requirements: FR-090 (infrastructure), FR-091, FR-092, FR-093 (read side), FR-094, BR-19, BR-20, BR-22, SEC-FILE-03/04/05, SEC-TXN-05, SEC-AUTH-04 (notifications), UX-INT-06, CFG-04.
- `recordActivity()` already exists (T03). This task adds the read side, notifications and email.

## C. Prerequisites

- T05 `COMPLETED`: sessions, guards, shells with a notifications slot, and the `lib/api` clients.
- SMTP credentials are optional. Without them, use `EMAIL_TRANSPORT=log` and record the SMTP check as pending.

## D. Scope

**In scope — API**
- `modules/activity`: `getTimeline({ requestId | entityType+entityId }, audience: "admin" | "customer", customerId?)`.
  - The admin audience returns all events with internal summaries and actor names.
  - The customer audience returns only events with a non-null `publicSummary` that belong to that customer, mapped to a customer DTO (`publicSummary`, `createdAt`, `toStatus`). It never includes `summary`, `metadata` or the actor's internal identity beyond "You" or the business name.
  - Add a helper that builds both summaries in a consistent voice.
- `modules/notifications`:
  - `notify(tx, { recipientUserId, type, title, message, linkPath, entity })` and `notifyAdmins(tx, …)` (all active admins), created inside the caller's transaction. `linkPath` must be a relative app path (validated).
  - `GET /api/v1/notifications/me?unreadOnly=&page=`: paginated, newest first, with `unreadCount` in the response meta.
  - `PATCH /api/v1/notifications/:id/read`: recipient only, otherwise `404`; idempotent.
  - `POST /api/v1/notifications/me/read-all`.
- `modules/email` (T05 already created the `EmailSender` interface, both transports, `escapeHtml`, the D-52 reserved-domain check, the password-reset template and a simple `sendAndLog()`; **extend these, don't recreate them**):
  - `EmailSender` interface `send({ to, subject, html, text })` (exists).
  - `SmtpEmailSender` (Nodemailer, pooled, connection and socket timeouts, TLS according to `SMTP_SECURE`).
  - `LogEmailSender`: logs subject, masked recipient and template only, writes the rendered HTML and text to `.data/outbox/<timestamp>-<template>.html|.txt` outside production, and reports `LOGGED`.
  - Env: `EMAIL_TRANSPORT` (`log`|`smtp`), `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `PUBLIC_WEB_URL` (used for absolute links in emails). In production, `smtp` requires all SMTP vars and `log` is allowed but warned about.
  - Templates: typed functions `(input) → { subject, html, text }`, with a branded layout (business name from settings, FixFlow footer, plain and accessible HTML, inline styles).
    - Every interpolated value passes through `escapeHtml`. A tagged-template helper that escapes by default is recommended.
    - Template input types contain **only customer-safe fields**, so internal notes cannot be passed in.
    - Create the template set for D-38 events now (request received to customer and to admin, quotation sent, quotation withdrawn, quotation decision to admin, request cancelled, job scheduled/rescheduled/needs rescheduling/completed/cancelled, invoice issued, invoice voided, payment recorded). Each has a real subject and copy. Workflow tasks call them.
    - The dispatcher applies the D-52 reserved-domain policy to every recipient (reuse T05's check).
    - Move T05's password-reset email onto the dispatcher, keeping its behaviour and tests.
  - `EmailDispatcher.dispatchAfterCommit(jobs)`:
    - creates an `EmailDeliveryLog` row (`PENDING`), sends, then updates it to `SENT`/`LOGGED`/`FAILED` with a safe `errorCode`; `SKIPPED` when there is no recipient email
    - never throws to the caller
    - exposes a test hook to await pending dispatches
  - A service-layer pattern helper: `runInTransaction(fn)` returns `{ result, afterCommit: EmailJob[] }`, and the dispatcher runs after the commit. Document the pattern in `docs/ARCHITECTURE.md`.

**In scope — Web**
- `NotificationBell` for AdminShell and PortalShell:
  - unread badge with an accessible label ("3 unread notifications")
  - popover list (title, message, relative time, unread indicator); clicking marks the notification read and navigates to `linkPath`
  - "Mark all as read"
  - empty state ("You're all caught up"), loading and error states
  - polls the count every 60 s only while the tab is visible
- `ActivityTimeline` component: an adapter from timeline DTOs to the T04 `Timeline`, with admin and customer variants. Internal entries are visually marked "Internal" in the admin variant.

**Out of scope**
Emitting the workflow events themselves (each workflow task calls these services), email retries/queues (a future enhancement, spec §24.3), SMS.

## E. Implementation instructions

1. Inspect the T03 `ActivityEvent`, `Notification` and `EmailDeliveryLog` models and `recordActivity()`, and the T05 shells and API clients.
2. Implement the timeline service and serializers, test-first, with the customer/internal separation as the key assertion.
3. Implement notifications (services, routes, tests), then email (sender interface, both transports, templates, dispatcher).
4. Write an integration test that simulates a business operation (a test-only service function) in one transaction: it creates an activity event and notifications and queues an email. Assert that a failing `EmailSender` still leaves the operation committed and the log `FAILED`, and that a successful log transport records `LOGGED`, not `SENT`.
5. Build the bell and the timeline component. To verify the UI in development without fake features, use notifications created by integration-test fixtures or a dev-only seed step clearly labelled as demo data, and document it.
6. If SMTP credentials exist, send one real test email through a documented script, `npm run email:test -w @fixflow/api -- --to <address>` (dev only), and record the result.

## F. Quality requirements

- Never put email bodies, request descriptions or addresses in application logs. Masked recipients only (`a***@example.test`).
- Templates escape all untrusted text, and a unit test covers `<script>` and attribute-injection payloads.
- `linkPath` validation prevents absolute and external URLs in notifications.
- A notification belongs to exactly one recipient. Customers can never list or modify another user's notifications.
- UI copy never claims an email was delivered. In-app UI only states that a notification exists.

## G. Acceptance criteria

1. Customer timeline DTOs contain only customer-visible events for that customer. A test proves internal summaries, metadata and other customers' events are excluded, using a key allowlist assertion.
2. Notification endpoints: listing returns only the caller's notifications, with `unreadCount`; marking another user's notification returns 404 and leaves it unchanged; mark-read is idempotent; read-all affects only the caller.
3. Email: a failing transport does not roll back the operation and produces a `FAILED` log with a safe error code; the log transport produces `LOGGED`; a missing recipient produces `SKIPPED`; the production config refuses `smtp` without SMTP vars.
4. All templates render subject, HTML and text, and escape injected HTML (unit tests and snapshots).
5. The bell shows the unread count, lists notifications, marks them read on click, navigates, supports "mark all", and has empty, loading and error states. It is keyboard accessible and axe-clean.
6. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Unit: `escapeHtml` and templates, `linkPath` validator, timeline mappers, recipient masking.
- Integration: notification ownership, pagination, unread count; timeline audiences; email dispatcher with fake failing, succeeding and log transports; transaction plus after-commit behaviour.
- E2E: a demo customer with fixture notifications opens the bell, marks one read and navigates; axe on the open popover.
- Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:integration`, `npm run build` and `npm run test:e2e`.

## I. Documentation and progress updates

- Progress file: the T06 entry. Add a pending SMTP check if it was not done.
- Traceability: FR-090 (infrastructure), FR-091, FR-092, FR-093 (read), FR-094, BR-19/20/22, SEC-FILE-03/04/05, SEC-TXN-05, SEC-AUTH-04 (notifications), UX-INT-06, CFG-04.
- `docs/API.md` (notification endpoints), `docs/ARCHITECTURE.md` (transaction plus after-commit email pattern, timeline audiences), `.env.example`, README (email modes and the outbox location).

## J. Completion report

Report:
- what was implemented and the important files
- each acceptance criterion with pass/fail
- the commands executed and their actual results
- the SMTP verification status
- dependencies added
- limitations
- a suggested commit message
- the next task: **T07 — Business settings and service catalogue management** (`prompts/07-settings-service-catalogue.md`)
