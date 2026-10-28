# FixFlow — Decisions, Conflicts and Open Questions

**Created:** 2026-10-28 (planning phase) · **Owner:** project owner + Claude Code

This log records architecture decisions, assumptions, conflicts between source documents, and questions that must not be resolved silently. Implementation prompts reference these IDs.

**Status values**

| Status | Meaning |
|---|---|
| `ACCEPTED` | Grounded in the canonical spec, `Note.md`, or a low-risk engineering default. Implement as written. |
| `PROPOSED` | Recommended resolution of an ambiguity or conflict. **The owner should confirm it before the task listed in "Needed by".** If it is rejected, update this entry first, then adjust the affected prompts. |
| `SUPERSEDED` | Replaced by a later decision (keep the entry and link to the new one). |

Spec references use the section numbers of `FixFlow_Project_Documentation.md` (identical to the DOCX).

---

## 1. Source-document review

### 1.1 DOCX vs Markdown comparison (performed 2026-10-28)

- The DOCX was extracted with a Python `zipfile`/XML script (paragraphs and tables from `word/document.xml`, plus the header, footer and core properties). A normalized word-level diff against the Markdown was then run.
- **Result:** after normalizing punctuation, the two documents are **99.5 % identical**. All 25 sections, tables, requirement IDs (FR-001…FR-102), business rules, data model, API outline and acceptance criteria match word for word.
- **Differences (front matter only, no requirement impact):**
  - DOCX cover: "A product requirements document, functional specification and technical blueprint for a polished full-stack portfolio project." It has `Purpose: Portfolio-grade product build` and `Scope: MVP + future enhancement guidance`, and places the "Project principle" ("FixFlow is complete when the customer-to-invoice journey works reliably…") on the cover.
  - Markdown cover: has `Intended audience: Product owner, developer, UI/UX designer, AI coding assistant, portfolio reviewers` and a "Project premise" paragraph (self-initiated portfolio product; not a paid client implementation). The Markdown carries the project principle only in the closing "Final product principle" section, which the DOCX also has.
  - Both statements are consistent with spec §22 and the glossary. **No conflict.**
- DOCX header: "FIXFLOW / PROJECT SPECIFICATION"; footer: "FixFlow Project Documentation · Version 1.0 | Page N". There are no embedded images apart from the document thumbnail.

### 1.2 Note.md

`Note.md` is the owner's explicit configuration for providers and hosting. It refines the spec's **recommended** stack (spec §13.1 says "Recommendation", "Railway or another managed host" and "Resend or SMTP"). It is therefore treated as an explicit, documented decision (D-02). Where it changes behaviour the spec describes (authentication), the impact is recorded as a conflict (C-01, C-02) with a proposed resolution.

---

## 2. Conflicts between sources

| ID | Conflict | Sources | Resolution | Decision |
|---|---|---|---|---|
| C-01 | The spec describes local password registration ("Name, email, password, confirmation", spec §9.1) and password reset (FR-010). Note.md mandates **Google Sign-In**. | spec §8.2, §9.1, §15.1, §12.1 (`passwordHash or auth provider ID`); Note.md | **Resolved 2026-10-28 (owner decision): implement both.** `/register` and `/login` offer a local email/password form and a Google button, for both roles. Password reset is implemented (FR-010 applies in full). | D-07, D-49 |
| C-02 | The demo accounts in spec §19.2 (`admin@demo.fixflow.local`, `alex.morgan@example.test`) cannot be Google accounts, and Playwright cannot automate Google login. | spec §19.2, §18.3; Note.md | **Resolved 2026-10-28:** no longer a conflict. Demo accounts are ordinary seeded **local-password** accounts with documented, fictional credentials (spec §19.2's own model). E2E and reviewers log in through the real `/login` form. Google remains available and is tested separately with an injectable fake verifier. | D-09 |
| C-03 | The spec recommends Railway for the API; Note.md specifies Render. | spec §13.1; Note.md | Render (the spec allows "another managed host"). | D-02, D-48 |
| C-04 | The spec's env list has `EMAIL_PROVIDER_API_KEY`; Note.md specifies Nodemailer with SMTP. | spec §21.2; Note.md | Use SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`) plus `EMAIL_TRANSPORT`. | D-13 |
| C-05 | Note.md requires Upstash Redis; the spec does not mention Redis. | Note.md | Use Upstash for the spec's required rate limiting (§15.1), not as a data or session store. | D-12 |
| C-06 | Spec §12.1 lists both `WorkOrderEvent` and `ActivityLog`; the timeline needs public and internal detail across all entities. | spec §12.1, FR-093, FR-094 | One unified `ActivityEvent` table that has the `WorkOrderEvent` fields (from/to status, public summary, internal details). The spec allows field and name changes if invariants are preserved (§12 intro). | D-29 |
| C-07 | Spec §18.4 says page title, favicon, metadata and app logo use **FixFlow** branding. FR-001/FR-100 require a branded public homepage with a configurable **business** name and logo. | spec §18.4, FR-001, FR-100 | The product shell uses FixFlow branding; the public site's content uses the configured business identity, with "Powered by FixFlow" and a demo notice. | D-31 |
| C-08 | Spec Phase 0 calls for Figma designs of principal screens before building. | spec §20 Phase 0 | Code-first design system with documented screen blueprints and a dev-only `/styleguide`. Figma is optional. | D-32 |
| C-09 | §6.2 says that after DECLINED the "business may close the request", but no CLOSED status exists. | spec §6.2 | "Close" = `CANCELLED` with a reason. "Reopen" = `DECLINED → UNDER_REVIEW` (explicit admin action with a reason). | D-21 |
| C-10 | `PARTIALLY_PAID` and `OVERDUE` can both be true at once (§6.5). | spec §6.5, BR-15 | Status precedence `VOID > DRAFT > PAID > OVERDUE > PARTIALLY_PAID > ISSUED`. The UI also shows the amount paid. | D-26 |
| C-11 | §7.5 says staff "optionally record work performed/parts used as descriptive line items", but no work-order line-item entity exists in §12. | spec §7.5, §12.1 | The completion note records work performed. Extra parts/labour are added as lines on the **draft invoice**. | D-26 |
| C-12 | Spec §21.3 suggests `docs/product-spec.md`, `architecture.md`, `api-notes.md`. | spec §21.3 | Keep the canonical spec filenames. Add `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DESIGN_SYSTEM.md` and `docs/DEPLOYMENT.md` as tasks create them. | — |

---

## 3. Decisions

### Platform and architecture

**D-01 — Single-business, multi-service scope** · `ACCEPTED` · spec §1, §3.4, §5.2, §24.8
One configured business (demo: CoolBreeze Home Services) that offers several services. There are no tenant/business IDs on records, no business onboarding and no marketplace behaviour. `BusinessSettings` is a singleton row.

**D-02 — Providers from Note.md** · `ACCEPTED` · Note.md
Neon (PostgreSQL), Upstash (Redis), Google Sign-In, Nodemailer over SMTP, Vercel (web), Render (API). The owner supplies credentials during development (see Q-04). Tasks must be able to progress locally without them (Docker Postgres, log email transport, in-memory rate limiting, demo personas).

**D-03 — Application stack** · `ACCEPTED` · spec §13.1
Next.js App Router + TypeScript, Tailwind CSS, shadcn/ui, Lucide, React Hook Form + Zod; Express 5 + TypeScript; Prisma; Vitest, Supertest, Testing Library, Playwright; pino; helmet. Charts are **not** planned for the MVP: the dashboard uses KPI cards and lists (spec §10.3 asks for "four or five meaningful KPI cards"). Recharts may be added only if a chart conveys information a list cannot.

**D-04 — Monorepo with npm workspaces** · `ACCEPTED` · spec §21.3
`apps/web`, `apps/api`, `packages/shared`, `e2e`. npm workspaces are used because npm is already installed and the project has only four packages; pnpm/Turborepo add tooling without clear benefit (spec: "choose the simplest structure you can maintain"). `concurrently` runs both dev servers.

**D-05 — Node.js 24 LTS** · `ACCEPTED` · **Action required before T01**
The local machine has **Node 20.19.4, which reached end-of-life in April 2026**. Use Node 24 LTS (supported by Vercel and Render, and required or recommended by current Next.js and Prisma releases). Pin it with `.nvmrc` and `engines`. T01 must stop if the active Node major is not 24.

**D-06 — Same-origin API access through a Next.js rewrite proxy** · `ACCEPTED` · verify in T09
`*.vercel.app` and `*.onrender.com` are different registrable sites (both are on the Public Suffix List). A cookie set by the API domain would be a third-party cookie, which Safari and Firefox block or partition. So the browser calls `https://<web>/api/v1/*`, and Next.js rewrites that to `${API_INTERNAL_URL}/api/v1/*`. The session cookie is first-party to the web origin. Server Components call `API_INTERNAL_URL` directly and forward the `cookie` header. No `NEXT_PUBLIC_API_BASE_URL` is needed. API CORS is restricted to `WEB_ORIGIN` as defence in depth. T09 must verify that `Set-Cookie`, `Origin` and the client-IP headers survive the rewrite. If they do not, switch to a Next.js route-handler proxy and record a new decision. Alternative: give both apps one custom domain (Q-06).

**D-14 — Health endpoints** · `ACCEPTED` · spec §16 Observability
`GET /api/v1/health` is a liveness check that does not touch the database; Render's health check uses it. `GET /api/v1/health/ready` checks database connectivity for diagnostics. This keeps Render health checks from holding Neon's compute awake, which would use up free-tier hours.

**D-15 — Database environments and test isolation** · `ACCEPTED` · spec §21.1
Neon branches: `main` = production demo, `dev` = local development, plus optional `preview`. Prisma uses the **pooled** connection string at runtime (`DATABASE_URL`) and the **direct** string for migrations (`DIRECT_DATABASE_URL`), following current Prisma and Neon guidance. Integration tests use `TEST_DATABASE_URL`: local Docker Postgres from `docker-compose.yml` (Docker 29 is installed), a Postgres service container in CI, or a dedicated Neon `test` branch. The reset helper refuses to run unless `NODE_ENV=test` and the URL is the configured test URL. Local work never points at the production branch.

**D-16 — UUID primary keys** · `ACCEPTED` · spec §17.1 ("cannot view … by guessing its ID")
All entity IDs are UUIDs. Human-readable references are separate unique columns.

**D-48 — Deployment specifics** · `PROPOSED` · Needed by T09
Render web service for `apps/api`, described in a committed `render.yaml` with secret values marked `sync: false`. The build runs `npm ci`, `prisma generate`, `prisma migrate deploy` and the TypeScript build; migrations run in the build step because pre-deploy commands are not available on every Render plan. Vercel project root is `apps/web`. The free Render tier sleeps after inactivity (cold starts of about a minute). The web app must therefore show a friendly "waking up the demo server" or retry state rather than failing. A paid Render instance is recommended for the public demo (Q-09).

### Identity, sessions and access

**D-07 — Dual authentication: local email/password and Google Sign-In** · `ACCEPTED` (owner, 2026-10-28, Q-01) · resolves C-01
- Both methods are first-class for customers and admins. One `User` row per normalized email (trim + lowercase, unique, FR-032), with nullable `passwordHash` and nullable unique `googleSubject`. A CHECK constraint requires at least one of them.
- **Local:** `POST /api/v1/auth/register` (name, email, password, password confirmation, terms acknowledgement) and `POST /api/v1/auth/login`. Password rules and hashing are in D-51.
- **Google:** the web app renders the Google Identity Services button and POSTs the ID token to `POST /api/v1/auth/google`. The API verifies it with `google-auth-library`: signature, `aud = GOOGLE_CLIENT_ID`, issuer, expiry and `email_verified = true`. It finds the user by Google subject, or links to an existing user with the same normalized email (see D-51 for the pre-hijacking rule), or creates a new `CUSTOMER`.
- **Password reset** (FR-010) is implemented: an emailed, single-use, time-limited link (D-51). In local development the log transport writes the link to `.data/outbox/`. In production without SMTP, reset is unavailable with an honest message, and the token is never logged.
- All methods produce the same server-side session (D-10).
- A customer's email is read-only in the profile for the MVP; email change is out of scope (D-39).

**D-08 — Admin role from an `ADMIN_EMAILS` allowlist** · `PROPOSED` · Needed by T05 · FR-011, FR-014
- Admin accounts exist only for emails listed in the server-side `ADMIN_EMAILS` env variable. They are created in one of two ways: by Google sign-in with an allowlisted, Google-verified email, or by the seed/CLI script with a password supplied through env (the seeded demo admin).
- **Local registration never creates an admin.** There is no email verification in the MVP, so allowing it would let anyone register the owner's address first. Registering with an allowlisted email is rejected with a generic message ("This email can't be registered here. Try signing in or resetting your password.").
- An admin can set or change a local password only through the emailed reset flow, which proves ownership of the address.
- `requireAdmin` checks both `role = BUSINESS_ADMIN` and current allowlist membership. The seeded demo admin's email is in `ADMIN_EMAILS` for demo environments, so there are no exemptions. Removing an email and redeploying revokes access immediately.
- An existing customer is never promoted automatically. An email cannot be both admin and customer.
- No admin credentials exist in source code.

**D-09 — Demo accounts and public demo access** · `ACCEPTED` (owner, 2026-10-28, Q-02) · resolves C-02
- Demo accounts are **ordinary seeded accounts with local passwords and documented, fictional credentials** (spec §19.2). There is no special demo sign-in endpoint and no login bypass.
  - Business admin: Morgan Reyes, `admin@demo.fixflow.test`
  - Customer: Alex Morgan, `alex.morgan@example.test`
  - Second customer for cross-customer tests: Priya Shah, `priya.shah@example.test`
- Passwords come from env (`DEMO_ADMIN_PASSWORD`, `DEMO_CUSTOMER_PASSWORD`). Development and demo values are published in the README and on the login page. Production values can be rotated without code changes (SEC-DATA-06).
- With `DEMO_MODE=true`, the login page shows a "Demo accounts" panel listing the credentials. Its "Use this account" buttons only **fill the real login form**. E2E tests log in the same way.
- In demo mode, demo accounts cannot change their password or request a reset (`403 DEMO_ACCOUNT_LOCKED`), so one visitor cannot lock others out.
- **Public sign-up stays open with both methods**, as the owner chose. Every visitor gets their own account. **Remaining privacy risk:** anyone using the published demo-admin credentials can see the names and emails of visitors who register with real details. Mitigations:
  - a notice on `/register` and `/login` in demo mode: "Public demo — use fictional details; other visitors can see what you enter"
  - the privacy page
  - regular demo resets (T24)
  - a `PUBLIC_SIGNUP_ENABLED` switch (default `true`) that lets the owner close sign-up later without code changes
- The spec §19.2 example `admin@demo.fixflow.local` becomes `admin@demo.fixflow.test`; the reserved `.test` TLD never receives mail (see D-52).

**D-10 — Server-side sessions** · `ACCEPTED` · FR-015, spec §15.1
A 32-byte random token goes in an HTTP-only cookie. Its HMAC-SHA-256 hash, keyed with `SESSION_SECRET`, is stored in a `Session` table along with the user, expiry and last-used time. Sessions expire after 7 days, with rolling renewal at most once per hour of activity. Logout deletes the row. Expired or inactive-user sessions return `401`. The cookie is `SameSite=Lax`, `Path=/`, and `Secure` in production, named `__Host-fixflow_session` in production and `fixflow_session` in local HTTP development. Sessions are stored in Postgres rather than Redis so that auth works without Redis and can be tested with the test database.

**D-11 — CSRF defence** · `ACCEPTED` · FR-015
Requests use the same-origin proxy and `SameSite=Lax` cookies. For unsafe methods, the request's `Origin` header must equal `WEB_ORIGIN` (`Sec-Fetch-Site: same-origin` is accepted as a fallback); otherwise the API returns `403 CSRF_ORIGIN_MISMATCH`. Mutation bodies must be JSON. Integration-test helpers send a valid `Origin`.

**D-12 — Upstash Redis for distributed rate limiting** · `PROPOSED` · Needed by T02 · resolves C-05
A `RateLimiter` interface has two implementations: Upstash (`@upstash/ratelimit` + `@upstash/redis` REST; `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) and in-memory for local development and tests. Limits apply to registration, login (per IP and per email), Google sign-in, password forgot/reset, request submission, quotation decisions and a generous global per-IP limit. Redis is **not** used for sessions, caching or primary data. If the owner intended another use (for example sessions or a cache), update this entry.

**D-49 — Account creation and terms acknowledgement** · `ACCEPTED` (owner, 2026-10-28, Q-01)
- `/register` offers the local form (name, email, password, confirmation, a required terms/privacy checkbox; spec §9.1) and "Continue with Google".
- `/login` offers the local form, "Continue with Google" and a "Forgot password?" link.
- `termsAcceptedAt` is recorded when the account is created, by either method. For Google, the terms notice is shown next to the button.
- There is no separate onboarding wizard: phone and addresses are collected in the profile or during the first service request (T10/T11).
- Customer self-service account deletion is out of scope (D-39).

**D-51 — Local password handling** · `ACCEPTED` · Needed by T05 · FR-010, SEC-AUTH-01, SEC-AUTH-06
- **Hashing:** Argon2id via a maintained library (recommended `@node-rs/argon2`, which ships prebuilt binaries for Windows, Linux and Render; `argon2` is the fallback). Use library-recommended parameters. Plaintext passwords are never stored or logged.
- **Policy:** 10–128 characters with no composition rules (NIST SP 800-63B style). Reject passwords equal to the email address or on a small bundled common-password list. Show a strength hint in the UI.
- **Login errors are generic:** "Email or password is incorrect". The same response is returned for unknown emails and for Google-only accounts without a password, which get a hint to use Google or reset their password.
- **Throttling:** login is limited per IP and per normalized email (e.g. 5 failures per 15 min per email and IP), plus registration and reset limits (D-12).
- **Reset:**
  - `POST /auth/password/forgot { email }` always returns the same 200 message (no enumeration).
  - For an existing, active, non-demo account it creates a `PasswordResetToken`: 32 random bytes, HMAC-hashed at rest, expiring after 60 minutes, single use, with any older tokens invalidated.
  - It emails a link to `/reset-password?token=…`.
  - `POST /auth/password/reset { token, password }` sets the hash, marks the token used, sets `emailVerifiedAt` (ownership proven), and revokes all of the user's sessions.
  - A Google-only account may use the reset flow to add a password.
- **Change password:** `POST /auth/password/change { currentPassword, newPassword }` for signed-in users who have a password. It revokes the user's other sessions.
- **Linking and pre-hijacking:** when a Google sign-in matches an existing local account by email:
  - if `emailVerifiedAt` is set, link the Google subject
  - if it is not set, link the subject, **clear the local password and revoke all existing sessions** (Google has just proven ownership, so a password set by someone else must not survive), then set `emailVerifiedAt`
- **No email verification step in the MVP** (D-39). Accounts work immediately; the linking rule above covers the main risk of not verifying.

**D-52 — Email recipient policy for undeliverable addresses** · `ACCEPTED` · Needed by T05/T06 · FR-092, spec §5.2
- The dispatcher checks each recipient's domain. Reserved, undeliverable TLDs and domains (`.test`, `.example`, `.invalid`, `.localhost`, `.local`, `example.com/net/org`) are always routed to the log transport and recorded as `LOGGED`, whatever `EMAIL_TRANSPORT` is set to. Every other address receives real email when SMTP is configured.
- This covers the seeded demo and showcase accounts without a demo-wide allowlist. Visitors who register their own real address in the public demo receive their own transactional emails.

### Data model and domain rules

**D-17 — Reference formats** · `PROPOSED` · Needed by T03 · FR-021, FR-071, BR-21
Formats: request `FF-YYYY-NNNNN` (from spec §7.1), quotation `QT-YYYY-NNNNN`, work order `JOB-YYYY-NNNNN`, invoice `INV-YYYY-NNNNN`.
- `YYYY` is the year in the business timezone.
- Each type has a per-year counter in a `ReferenceCounter` table, incremented atomically (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) inside the business transaction.
- The invoice number is assigned **at issue**, not at draft. Drafts display "Draft".

**D-18 — Money representation** · `ACCEPTED` · FR-042, BR-5, BR-18, spec §12.3
- Amounts are `Decimal(12,2)`, quantities `Decimal(10,2)`, and tax rate `Decimal(5,2)` as a percentage.
- Arithmetic uses `decimal.js`, rounding half-up to 2 dp at line level and for each total.
- Every quotation and invoice stores a `currencyCode` (ISO 4217) snapshot. Only 2-decimal currencies are supported in the MVP.
- The API serializes money as strings and never uses JS `number` for money.

**D-19 — Total calculation with discount and tax** · `PROPOSED` · Needed by T14 · FR-042
1. `lineSubtotal = round(quantity × unitPrice)`; `subtotal = Σ lineSubtotal`; `taxableSubtotal = Σ lineSubtotal of taxable lines`.
2. `discountAmount` is one fixed amount per document, with `0 ≤ discountAmount ≤ subtotal`.
3. The discount is spread proportionally across lines: `taxableBase = round(taxableSubtotal − discountAmount × taxableSubtotal / subtotal)`, or 0 when the subtotal is 0.
4. `taxAmount = round(taxableBase × taxRate / 100)`; `totalAmount = subtotal − discountAmount + taxAmount`.
5. `taxRate` is snapshotted from `BusinessSettings.defaultTaxRate` when the draft is created and is editable while the document is a draft.

The function lives in `@fixflow/shared`, so the editor preview and the server use the same code; the server always recomputes (D-44). The worked examples in T14's unit tests are the reference. Percentage discounts are out of scope.

**D-20 — Validation limits** · `ACCEPTED` · BR-6
These live in `@fixflow/shared` as constants:
- quantity 0.01–9,999.99
- unit price 0.00–999,999.99
- 1–50 line items per document
- discount 0 up to the subtotal; tax rate 0–100
- payment amount 0.01 up to the remaining balance
- request description 20–2,000 characters
- notes up to 2,000 characters; reasons 5–500 characters
- maximum appointment duration 12 h

**D-21 — Service-request transitions** · `PROPOSED` · Needed by T12 · spec §6.2, FR-025, FR-026

| From | To | Trigger |
|---|---|---|
| SUBMITTED | UNDER_REVIEW | Admin "Start review" |
| SUBMITTED, UNDER_REVIEW, QUOTED, ACCEPTED, DECLINED | CANCELLED | Admin, reason required. Any open DRAFT/SENT quotation is voided in the same transaction. |
| UNDER_REVIEW | QUOTED | System, when a quotation is sent |
| QUOTED | ACCEPTED / DECLINED | System, on the customer's decision |
| QUOTED | UNDER_REVIEW | System, when the only SENT quotation is voided or expires without a replacement |
| DECLINED | UNDER_REVIEW | Admin "Reopen", reason required (allows a revised quotation) |
| ACCEPTED | CONVERTED_TO_JOB | System, on work-order creation |

`CONVERTED_TO_JOB` and `CANCELLED` are terminal. A quotation draft can be created only while the request is `UNDER_REVIEW` or `QUOTED` (a replacement). Customers cannot cancel requests in the MVP (D-39).

**D-22 — Quotation lifecycle rules** · `PROPOSED` · Needed by T14 · spec §6.3, FR-046, BR-7, BR-8
- At most **one DRAFT** and **one SENT** quotation per request, enforced by partial unique indexes and service checks.
- A SENT quotation is immutable. "Replace" creates a new DRAFT with `replacesQuotationId`. Sending the replacement voids the previous SENT quotation in the same transaction, with the reason "Replaced by QT-…". If the customer accepts the old one first, sending the replacement returns `409`.
- Void requires a reason (5–500 characters) and is allowed from DRAFT or SENT.
- `validUntil` is a date. The quotation can be accepted until 23:59:59 on that date in the business timezone. When sending, `validUntil ≥ today`, `totalAmount > 0` and at least one line are required.
- Customers never see DRAFT quotations (`404`).

**D-23 — Time-based status synchronization** · `ACCEPTED` · spec §6.3 EXPIRED, §6.5 OVERDUE
No cron is required, which suits the Render free tier. The pure helpers `effectiveQuotationStatus()` and `deriveInvoiceStatus()` always compute the correct status from the record and `clock.now()`. Idempotent `syncExpiredQuotations()` and `syncOverdueInvoices()` persist the time-based changes, plus their activity events and request reversion. They run before relevant reads, lists, dashboards and actions. A stale row can therefore never be acted on incorrectly.

**D-24 — Work-order transitions** · `PROPOSED` · Needed by T17 · spec §6.4, FR-055

| From | To | Trigger / requirement |
|---|---|---|
| (created) | PENDING_SCHEDULING | Conversion from an accepted quotation |
| PENDING_SCHEDULING, NEEDS_RESCHEDULING | SCHEDULED | Schedule action: start, end and an **active technician** are required |
| SCHEDULED | SCHEDULED | Reschedule: old and new times recorded, customer notified (FR-057) |
| SCHEDULED | IN_PROGRESS | "Start job" (sets `startedAt`) |
| SCHEDULED, IN_PROGRESS | NEEDS_RESCHEDULING | Reason required |
| IN_PROGRESS | COMPLETED | Customer-visible completion note required (sets `completedAt`) |
| PENDING_SCHEDULING, SCHEDULED, NEEDS_RESCHEDULING | CANCELLED | Reason required |

`COMPLETED` and `CANCELLED` are terminal. `IN_PROGRESS → CANCELLED` is not allowed: complete the job with a note instead. There is no admin correction flow in the MVP.

**D-25 — Scheduling policy: block overlaps** · `PROPOSED` · Needed by T17 · FR-054, BR-10
- The server rejects with `409 SCHEDULING_CONFLICT` when the same technician has another `SCHEDULED` or `IN_PROGRESS` work order whose interval overlaps. Intervals are half-open `[start, end)`, so back-to-back appointments are allowed. The error response names the conflicting job and its time.
- The check runs in a transaction that first locks the technician row (`SELECT … FOR UPDATE`), so two concurrent schedules cannot both succeed.
- Other constraints: `end > start`; duration ≤ 12 h; start not more than 15 minutes in the past; inactive technicians rejected.
- The UI pre-checks conflicts through a read-only endpoint, but the server is authoritative.
- The alternative, "warn but allow", is not recommended: it weakens a business invariant the spec stresses.

**D-26 — Invoice rules** · `PROPOSED` · Needed by T20 · spec §6.5, §7.6, FR-070…FR-076, BR-13, BR-15
- At most one non-VOID invoice per work order, enforced by a partial unique index. After a void, a new draft may be created.
- Drafts are created only from `COMPLETED` work orders and are pre-filled from the accepted quotation's lines, discount and tax rate.
- While the invoice is a DRAFT, staff may edit lines (including extra parts or labour, see C-11), discount, tax rate, due date and the customer note. Totals are recalculated on the server.
- Issuing assigns the number. It snapshots the business details, customer details, payment instructions and footer, and locks the financial content.
- Void (reason required) is allowed for DRAFT, ISSUED and OVERDUE invoices **without active payments**; otherwise `409 INVOICE_HAS_PAYMENTS` (void the payments first).
- Status precedence: `VOID > DRAFT > PAID > OVERDUE > PARTIALLY_PAID > ISSUED`. An invoice is overdue after 23:59:59 on its due date in the business timezone while a balance is outstanding.
- The default due date is the issue date plus `invoiceDueDays` (setting, default 14).
- `amountPaid` is stored denormalized and updated only inside payment transactions; tests assert it equals the sum of active payments.

**D-27 — Payment rules** · `ACCEPTED` · FR-073…FR-076, BR-14
- Payments are manual records only. Methods: `CASH`, `BANK_TRANSFER`, `CARD_TERMINAL` (taken outside FixFlow), `CHEQUE`, `OTHER`.
- `amount > 0` and `amount ≤ remaining balance` (otherwise `422 PAYMENT_EXCEEDS_BALANCE`, with the remaining amount in the message). `paymentDate` may not be in the future.
- Payments can be recorded on ISSUED, PARTIALLY_PAID and OVERDUE invoices only. The invoice row is locked (`FOR UPDATE`) during recording.
- A correction is a void with a reason followed by a new record. There is no edit or delete endpoint.

**D-28 — PDF generation** · `ACCEPTED` (library choice in T22) · FR-072, spec §15.4
PDFs are generated server-side from persisted invoice snapshots by a lightweight Node library (recommended: `pdfmake`, with `@react-pdf/renderer` as the alternative). Headless Chromium is not used because Render's free tier has a 512 MB memory limit. Fonts are bundled (OFL-licensed). The layout fits A4 and Letter. The logo comes only from bundled assets; remote URLs are never fetched during PDF generation (SSRF risk). Quotation PDFs are out of scope: the quotation view has a print stylesheet instead.

**D-29 — Unified activity model** · `PROPOSED` · Needed by T03 · resolves C-06 · FR-093, FR-094
`ActivityEvent` has these fields:
- `actorUserId` (null = system), `entityType`, `entityId`, `action`
- `fromStatus`, `toStatus`
- `summary` (internal), `publicSummary` (customer-visible when not null)
- `metadata` (JSON with allowlisted, non-sensitive keys)
- correlation fields `requestId` and `customerId`, plus `createdAt`

The table is append-only for application code. Customer timelines include only events with a `publicSummary` and the matching `customerId`.

**D-30 — No file uploads in the MVP** · `ACCEPTED` · spec §15.1
The business logo and service images are bundled static assets selected by key, or validated `https://` URLs for display on web pages only. Customer photo attachments are a future enhancement (§24.6).

**D-36 — Address snapshots** · `ACCEPTED` · spec §12.1
Service requests copy the address fields (and access notes) when created; work orders copy them from the request. `serviceAddressId` remains an optional reference with `ON DELETE SET NULL`. Access notes are visible only to admins and the owning customer.

**D-35 — Preferred time window** · `PROPOSED` · Needed by T11 · FR-020
- The customer picks a date and a window: `MORNING` 08:00–12:00, `AFTERNOON` 12:00–16:00 or `EVENING` 16:00–19:00, in the business timezone.
- The server stores `preferredDate`, `preferredWindow` and UTC `preferredStart`/`preferredEnd`.
- The date must fall between tomorrow and today + 90 days in the business timezone. The preference is not a booking; the admin schedules the job.

**D-45 — Request submission idempotency** · `ACCEPTED` · spec §14.5
The request form sends a client-generated `submissionKey` (UUID), unique per customer. A repeated POST with the same key returns the original request (`200`) instead of creating a duplicate.

**D-46 — Optimistic state checks** · `ACCEPTED` · spec §12.3
Admin transition endpoints require `expectedStatus`. If the current status differs, the server returns `409 STALE_STATE` and makes no change. Customer decision endpoints rely on conditional updates (`WHERE status = 'SENT'`).

**D-50 — Service catalogue model** · `ACCEPTED` · FR-002, FR-006, FR-101
- `isPublished` plus a nullable `archivedAt`. A service is active when it is published and not archived.
- `category` is free text with a maximum of 50 characters.
- `pricingMode` is `FIXED` (requires `startingPrice`, displayed as "From $X") or `QUOTE_REQUIRED` ("Request a quote"). Every request still goes through a quotation.
- Inclusions are a string list. The slug is unique kebab-case, auto-generated and editable with a warning.
- Archived services can be restored. Requests for inactive services are rejected server-side.

### API, frontend and UX

**D-33 — HTTP and error conventions** · `ACCEPTED` · spec §14.5
As written in `CLAUDE.md` §8: success envelope `{ data }`; error shape with `code`, `message`, optional `fieldErrors` keyed by path (e.g. `lines.2.quantity`) and `requestId`; `422` for schema validation and `400` for malformed JSON.

**D-34 — Pagination and sorting** · `ACCEPTED` · spec §14.5
`page` (1-based), `pageSize` (default 20, max 100), `sort` (allowlisted field) and `order` (`asc`/`desc`). Invalid values return `422`.

**D-40 — Frontend data strategy** · `ACCEPTED`
- Server Components fetch page data through a server API client that forwards cookies.
- Client components send mutations through `lib/api` to the same-origin proxy, then call `router.refresh()`.
- Filters live in URL search params. No client cache library (e.g. TanStack Query) unless a task justifies one.
- Polling is used only for the notification count (60 s while the tab is visible).

**D-41 — Separate customer and admin endpoints and serializers** · `ACCEPTED` · FR-022, FR-094, BR-19
- Customer-facing routes (`/requests/:id`, `/quotations/:id`, `/work-orders/:id`, `/invoices/:id`) always return the customer DTO, even for an admin. The admin "preview as customer" view uses them.
- Admin views use `/admin/...` routes and admin DTOs.
- Tests assert that customer DTO keys never include internal fields.

**D-42 — Date/time library** · `ACCEPTED` · BR-17
`date-fns` + `@date-fns/tz` on both web and API. All business-day boundaries (today, overdue, expiry, KPI periods, reference year) are computed in `BusinessSettings.timeZone`.

**D-43 — `availableActions` in admin DTOs** · `ACCEPTED`
Admin detail DTOs list the actions the current state allows (e.g. `["START_REVIEW","CANCEL"]`). The UI renders only those actions and the server re-validates each one.

**D-44 — Shared money calculation** · `ACCEPTED` · spec §10.3 ("live preview … recalculated authoritatively on the server")
`calculateDocumentTotals()` in `@fixflow/shared` is pure and uses `decimal.js`. The quotation and invoice editors use it for the preview and the API uses it as the authoritative calculation. Client-sent totals are ignored.

**D-31 — Branding model** · `ACCEPTED` (owner, 2026-10-28, Q-03) · resolves C-07
- **Product chrome** — the admin app, portal, auth pages, favicon and app logo — uses FixFlow branding: an original wordmark, with page titles like "Requests · FixFlow".
- **Public website content** uses the configured business identity (CoolBreeze Home Services: name, logo, contact), page titles like "AC Repair · CoolBreeze Home Services", and a footer reading "Powered by FixFlow".
- In demo mode, a slim banner explains: "FixFlow portfolio demo — fictional business and data."

**D-32 — Code-first design system** · `PROPOSED` · Needed by T04 · resolves C-08
T04 produces `docs/DESIGN_SYSTEM.md`: tokens, type scale, components, status mapping, plus text blueprints for each principal screen. It implements these as Tailwind tokens and shadcn/ui primitives, with a dev-only `/styleguide` route that is not served in production. Visual QA uses Playwright screenshots at the four required widths. Figma mock-ups are optional; the Figma tools in this environment could be used if the owner wants them (Q-08).

**D-38 — Notification events and recipients** · `ACCEPTED` · FR-090, FR-091
- In-app notifications go to **all admins** for: request received, quotation accepted/declined.
- In-app notifications go to the **owning customer** for: quotation sent, quotation withdrawn (a SENT quotation voided), request cancelled, customer-visible note added, job scheduled/rescheduled/needs rescheduling/completed/cancelled, invoice issued, invoice voided (if it had been issued), payment recorded.
- Customer emails are sent for the same customer events, except "note added", which is in-app only. Admin emails go to `BusinessSettings.contactEmail`.
- Seeded demo and showcase accounts use reserved `.test` addresses, so their emails are logged rather than sent (D-52).
- Links are relative app paths. Email delivery status is tracked separately with these statuses: `PENDING`, `SENT`, `LOGGED` (log transport), `FAILED`, `SKIPPED`.

**D-13 — Email adapter** · `ACCEPTED` · FR-091, FR-092, BR-22, spec §5.2, §15.4
- An `EmailSender` interface has two implementations: Nodemailer SMTP and a log transport. The log transport writes a redacted preview to the log and to the git-ignored `.data/outbox/`, and is recorded as `LOGGED`, never as `SENT`.
- Every interpolated value in a template is HTML-escaped.
- Emails are dispatched after commit. Failures are caught and recorded with a safe error code, and never throw to the business operation.
- `EMAIL_TRANSPORT=smtp` requires the SMTP variables (validated at startup).
- T05 creates the sender interface, both transports and the password-reset template, because password reset is the first email use. T06 adds the after-commit dispatcher and the full template set, and moves the reset email onto the dispatcher.

**D-47 — Demo business defaults** · `ACCEPTED` (editable in settings) · spec §5.2, §19
CoolBreeze Home Services; USD; `America/New_York`; default tax 8.00 %; quotation validity 14 days; invoice due 14 days. Phone numbers use the fictional 555-01xx range, emails use `.test` domains, and street addresses are fictional.

### Testing and scope

**D-37 — Testing strategy** · `ACCEPTED` · spec §18
- Vitest for unit tests in all packages and for API integration tests (Supertest, real Postgres, migrations applied, tables truncated between tests).
- Testing Library for component tests where there is logic.
- Playwright in `e2e/`, signing in through the real `/login` form with the seeded demo accounts (D-09); Google-specific behaviour is covered by API integration tests with a fake ID-token verifier: Chromium for every slice, plus Firefox and WebKit for the main journey in T25.
- `@axe-core/playwright` for accessibility checks.
- CI (GitHub Actions) runs lint, typecheck, unit tests, integration tests (Postgres service container) and build. E2E runs in CI once T25 stabilises it.

**D-39 — Explicit out-of-scope clarifications** · `ACCEPTED` · spec §3.4, §24
In addition to the spec's non-goals, the MVP does **not** include:
- customer self-cancellation of requests
- admins creating requests on behalf of customers
- admin editing of customer profiles
- customer account deletion
- email verification at sign-up, and email-address change (see D-51 for the linking safeguard)
- drag-and-drop calendar rescheduling
- recurring availability or working hours
- quotation PDFs
- percentage discounts
- multiple invoices per work order
- partial refunds or credit
- dark mode
- localization
- charts
- a background job queue

Each can be proposed later as a deliberate change.

---

## 4. Open questions for the owner

| ID | Question | Recommended answer | Needed by |
|---|---|---|---|
| Q-01 | ~~Confirm Google Sign-In as the only sign-in method.~~ **Answered 2026-10-28:** use both local email/password and Google Sign-In (D-07, D-49, D-51). | — | Resolved |
| Q-02 | ~~Confirm the public-demo access model.~~ **Answered 2026-10-28:** both local and Google sign-in in the public demo; demo accounts are seeded local-password accounts with published credentials (D-09). Residual privacy risk and mitigations are recorded in D-09. | — | Resolved |
| Q-03 | ~~Confirm the branding model.~~ **Answered 2026-10-28:** approved (D-31). | — | Resolved |
| Q-04 | Credentials schedule. The owner provides: Neon connection strings (dev, prod, optional test branch) by T03, though Docker can be used meanwhile; a Google OAuth **Web client ID** with authorized JavaScript origins for `http://localhost:3000` and the Vercel URLs by T05; Upstash REST URL and token by T09; SMTP host, port, user, password and a verified `EMAIL_FROM` by T09/T26; Render and Vercel accounts by T09. | Tasks proceed locally without them and record pending verification. | T03, T05, T09, T26 |
| Q-05 | Marketing imagery. Will you supply or approve royalty-free photos (e.g. from Unsplash or Pexels), recorded in `apps/web/public/images/CREDITS.md`? Until then, T08 uses designed, icon-based visual compositions (never broken or hot-linked images). | Supply 4–6 photos before T08 if possible. | T08 |
| Q-06 | Do you have a custom domain? With `app.` and `api.` subdomains the API could set its own first-party cookies. Without one, the rewrite proxy (D-06) is required. | Not required; the proxy works on default domains. | T09 |
| Q-07 | Install Node.js 24 LTS locally (D-05). | Required before T01. | T01 |
| Q-08 | Do you want Figma mock-ups of the principal screens before T04, as in spec Phase 0? | No. Use the code-first design system (D-32). | T04 |
| Q-09 | Render plan for the public demo. On the free tier, the API sleeps after ~15 minutes, giving reviewers about a minute of cold start. | Use a paid starter instance for the public demo period. | T26 |
| Q-10 | Confirm the scheduling policy: block overlaps (D-25), not "warn but allow". | Block. | T17 |
| Q-11 | In demo mode, may the demo admin edit public-facing business identity (name, logo URL, contact)? | Allow edits, rate-limit writes and reset demo data regularly. Optionally lock identity fields in demo mode. | T24 |
| Q-12 | Portfolio case study wording. How should the case study describe your contribution and the use of AI-assisted development? Spec §22.1 requires an accurate account. | Owner to decide; T27 leaves clearly marked fields. | T27 |

---

## 5. Decision change procedure

1. Do not change a decision silently in code. Update its entry, or add a new `D-xx` marked `SUPERSEDED by D-yy`, and record the date and reason.
2. Update every affected prompt in `prompts/` and the acceptance criteria in `docs/IMPLEMENTATION_PLAN.md`.
3. If a completed task is affected, add a follow-up item to `docs/IMPLEMENTATION_PROGRESS.md`.
