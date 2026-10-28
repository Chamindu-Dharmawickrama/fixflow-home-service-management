# T03 — Database Schema, Migrations and Base Seed

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T03 |
| Title | Database schema, migrations and base seed |
| Phase | 1 — Foundation |
| Objective | Add Prisma with Neon-compatible configuration and implement the complete MVP data model with database-level invariants. Provide atomic reference generation, an activity writer, a safe test-database workflow, a readiness endpoint and an idempotent base seed. |

## B. Context

- Read first: `CLAUDE.md` §7–§9, §11; spec §6 (status models), §11 (business rules), §12 (data model), §15.3, §19, §21.1.
- Decisions: D-15 (DB environments/test isolation), D-16 (UUIDs), D-17 (reference formats, **PROPOSED**), D-18 (money types), D-29 (unified `ActivityEvent`, **PROPOSED**), D-36 (address snapshots), D-50 (service model), D-09 (demo accounts), D-51 (password hashing), D-47 (demo defaults), D-45 (`submissionKey`), D-26/D-27 (invoice/payment fields). Confirm D-17 and D-29 with the user before building the schema around them.
- Requirements: DM-01…DM-05, FR-021, FR-030, FR-032, FR-051, BR-01, BR-17, BR-18, FR-093 (writer), NFR-08, NFR-09, CFG-01, DD-01, DD-02, DD-03, SEC-DATA-01, DEP-01, DEP-04.

## C. Prerequisites

- T02 `COMPLETED`: config, app factory, error model and test harness exist.
- Docker is available for the local test database (`docker --version`).
- Neon `dev` connection strings are optional. Without them, develop against Docker Postgres and record "Neon verification pending" in the progress file.

## D. Scope

**In scope**
- Prisma (current stable) in `apps/api` (`prisma/schema.prisma`, migrations in `prisma/migrations`). Configure it according to the current Prisma docs for this major version: pooled `DATABASE_URL` at runtime, direct `DIRECT_DATABASE_URL` for migrations, `sslmode=require` for Neon, a client singleton in `src/lib/db.ts`, and disconnect on shutdown. Add these vars, `TEST_DATABASE_URL`, and the seed-only `DEMO_ADMIN_PASSWORD`/`DEMO_CUSTOMER_PASSWORD` to the env schema and `.env.example` (example values clearly marked demo-only).
- `docker-compose.yml` (root) with a `postgres` service for tests: current major Postgres, port 5433, a named volume, and db/user `fixflow_test`. Root script `db:test:up` and `db:test:down`.
- The **complete MVP schema** (see E.3), including enums, relations, unique constraints, indexes, and raw-SQL partial unique indexes and CHECK constraints added in a migration.
- `src/lib/password.ts`: Argon2id `hashPassword()`/`verifyPassword()` via the D-51 library, unit-tested. The seed needs it; T05 adds the password policy and auth flows on top.
- `src/lib/references.ts`: `nextReference(tx, type, at: Date, timeZone)` → `"FF-2026-00001"`. It does an atomic upsert-increment on `ReferenceCounter` (`INSERT … ON CONFLICT DO UPDATE SET value = value + 1 RETURNING value`) and computes the year in the business timezone.
- `src/modules/activity/activity.service.ts`: `recordActivity(tx, input)` with a typed input. It validates `metadata` against an allowlist of non-sensitive keys and rejects anything resembling tokens, emails or addresses in metadata. Timeline reads come in T06.
- Readiness endpoint `GET /api/v1/health/ready`: runs `SELECT 1` with a short timeout, returning `200 { data: { status: "ready" } }` or `503`. Liveness stays DB-free.
- Test DB utilities in `src/test/db.ts`:
  - `assertTestDatabase()` refuses unless `NODE_ENV === "test"` and the active URL equals `TEST_DATABASE_URL`, and that URL differs from `DATABASE_URL`.
  - `resetDatabase()` truncates all tables with `RESTART IDENTITY CASCADE`.
  - A Vitest global setup for integration tests runs `prisma migrate deploy` against `TEST_DATABASE_URL`.
- Root scripts: `db:migrate` (dev), `db:deploy`, `db:generate`, `db:seed`, `db:studio`, `test:integration`.
- Base seed `prisma/seed.ts`. It is idempotent (upsert by natural keys) and contains:
  - `BusinessSettings` singleton per D-47
  - the 5 services from spec §19.1 with realistic copy, inclusions, durations and pricing modes
  - demo accounts per D-09, as ordinary local-password users: admin Morgan Reyes (`admin@demo.fixflow.test`); customers Alex Morgan (`alex.morgan@example.test`) and Priya Shah (`priya.shah@example.test`), the second customer for cross-customer tests. Customers get a profile and one fictional address (555-01xx phones). Passwords are Argon2id hashes of `DEMO_ADMIN_PASSWORD`/`DEMO_CUSTOMER_PASSWORD`; the seed refuses with a clear message if they are missing, and **no password literal appears in source code**
  - 3 technicians, including Jordan Lee

  The full showcase data comes in T24.
- An enum parity test: Prisma enum values equal the status/role constants exported by `@fixflow/shared` (add those constants now).
- CI: add a Postgres service container, `prisma migrate deploy`, and `npm run test:integration` to `ci.yml`.
- Docs: a data-model section in `docs/ARCHITECTURE.md` with a Mermaid `erDiagram`, a list of the DB-enforced invariants, and the migration and seed workflow in the README.

**Out of scope**
Business logic and endpoints for any domain (later tasks), session handling (T05, though the `Session` table is created here), and the full demo dataset (T24).

## E. Implementation instructions

1. Inspect the current API structure and env schema. Confirm D-17 and D-29 with the user (if they were rejected, adapt the schema and record the change).
2. Install and initialise Prisma. Map models to snake_case tables and columns (`@@map`/`@map`). Use `@db.Uuid` UUID ids defaulting to database-generated UUIDs, `@db.Timestamptz(3)` timestamps, and `@db.Date` date-only fields.
3. Model these entities. Field names may be refined, but every invariant must hold.
   - **Enums:**
     - `Role` (BUSINESS_ADMIN, CUSTOMER)
     - `PricingMode` (FIXED, QUOTE_REQUIRED)
     - `ServiceRequestStatus` (§6.2)
     - `PreferredWindow` (MORNING, AFTERNOON, EVENING)
     - `NoteVisibility` (INTERNAL, CUSTOMER_VISIBLE)
     - `QuotationStatus` (§6.3)
     - `WorkOrderStatus` (§6.4)
     - `InvoiceStatus` (§6.5)
     - `PaymentMethod` (D-27)
     - `NotificationType` (one per D-38 event)
     - `EmailDeliveryStatus` (PENDING, SENT, LOGGED, FAILED, SKIPPED)
     - `ActivityEntityType` (SERVICE_REQUEST, QUOTATION, WORK_ORDER, INVOICE, PAYMENT, SERVICE, TECHNICIAN, SETTINGS, CUSTOMER)
     - `ReferenceType` (REQUEST, QUOTATION, WORK_ORDER, INVOICE)
   - **User:** id, email (normalized, unique), name, avatarUrl?, role, passwordHash?, googleSubject? (unique), emailVerifiedAt?, isActive, termsAcceptedAt?, lastSignInAt?, createdAt, updatedAt. CHECK: `passwordHash` or `googleSubject` is not null (D-07).
   - **Session:** id, tokenHash (unique), userId FK (cascade), expiresAt, lastUsedAt, createdAt; index on userId and expiresAt.
   - **PasswordResetToken:** id, userId FK (cascade), tokenHash (unique), expiresAt, usedAt?, createdAt; index on userId (D-51).
   - **CustomerProfile:** id, userId (unique FK), phone?, createdAt, updatedAt.
   - **CustomerNote:** id, customerId FK, authorUserId FK, body, createdAt. Internal only (FR-033).
   - **ServiceAddress:** id, customerId FK, label, line1, line2?, city, region?, postalCode, accessNotes?, isDefault, createdAt, updatedAt. Partial unique index: one default per customer.
   - **BusinessSettings:** singleton enforced by a fixed id plus a CHECK constraint. Fields: businessName, tagline?, logoKey?/logoUrl?, contactEmail, phone, address lines, serviceAreaDescription?, currencyCode `CHAR(3)`, timeZone, defaultTaxRate `Decimal(5,2)`, quotationValidityDays, invoiceDueDays, defaultQuotationTerms?, invoiceFooter?, paymentInstructions?, updatedAt, updatedByUserId?.
   - **Service:** id, name, slug (unique), category, shortDescription, fullDescription, inclusions `text[]`, estimatedDurationMinutes?, pricingMode, startingPrice `Decimal(12,2)`?, imageKey?/imageUrl?, isPublished, archivedAt?, sortOrder, createdAt, updatedAt. CHECK: FIXED ⇒ startingPrice is not null.
   - **ServiceRequest:** id, reference (unique), customerId FK, serviceId FK, serviceNameSnapshot, serviceAddressId? (FK `SET NULL`), address snapshot fields plus accessNotesSnapshot?, description, preferredDate, preferredWindow, preferredStart, preferredEnd, status, cancelReason?, cancelCustomerMessage?, cancelledAt?, cancelledByUserId?, submissionKey? (unique with customerId), submittedAt, updatedAt. Indexes: (status, submittedAt), customerId, serviceId.
   - **RequestNote:** id, requestId FK, authorUserId FK, body, visibility, createdAt.
   - **Quotation:** id, reference (unique), requestId FK, customerId FK, status, currencyCode, taxRate, subtotal, discountAmount, taxableBase, taxAmount, totalAmount, validUntil (date), terms?, customerNote?, replacesQuotationId? (self FK, unique), sentAt?, sentByUserId?, respondedAt?, respondedByUserId?, declineReason?, voidedAt?, voidedByUserId?, voidReason?, expiredAt?, createdByUserId, createdAt, updatedAt. Partial unique indexes: one `SENT` per request and one `DRAFT` per request.
   - **QuotationLineItem / InvoiceLineItem:** id, parent FK (cascade), position, description, quantity `Decimal(10,2)` (CHECK > 0), unitPrice `Decimal(12,2)` (CHECK ≥ 0), taxable, lineSubtotal.
   - **Technician:** id, name, phone?, email?, specialties `text[]`, notes?, calendarColor (token key), isActive, createdAt, updatedAt.
   - **WorkOrder:** id, reference (unique), requestId (unique FK), quotationId (unique FK), customerId FK, serviceId FK, serviceNameSnapshot, address snapshot fields, scopeDescription, status, scheduledStart?, scheduledEnd?, technicianId? FK, startedAt?, completedAt?, completionNote?, internalCompletionNote?, cancelReason?, cancelledAt?, createdByUserId, createdAt, updatedAt. CHECK: both schedule times are null or end > start. Indexes: (technicianId, scheduledStart), (status, scheduledStart).
   - **Invoice:** id, invoiceNumber? (unique), workOrderId FK, quotationId? FK, customerId FK, status, currencyCode, taxRate, subtotal, discountAmount, taxableBase, taxAmount, totalAmount, amountPaid (default 0), issueDate?, dueDate?, issuedAt?, issuedByUserId?, customerNote?, businessSnapshot `jsonb`?, customerSnapshot `jsonb`?, paymentInstructionsSnapshot?, footerSnapshot?, voidedAt?, voidedByUserId?, voidReason?, createdByUserId, createdAt, updatedAt. Partial unique index: one non-VOID invoice per work order. CHECKs: amounts ≥ 0, amountPaid ≤ totalAmount.
   - **PaymentRecord:** id, invoiceId FK, amount (CHECK > 0), paymentDate, method, reference?, notes?, recordedByUserId, createdAt, voidedAt?, voidedByUserId?, voidReason?.
   - **Notification:** id, recipientUserId FK, type, title, message, linkPath, entityType?, entityId?, readAt?, createdAt; index (recipientUserId, readAt, createdAt).
   - **EmailDeliveryLog:** id, notificationId? FK, template, recipientMasked, transport, status, errorCode?, attemptedAt?, sentAt?, createdAt.
   - **ActivityEvent:** per D-29; indexes (entityType, entityId, createdAt), (requestId, createdAt), (customerId, createdAt), (createdAt).
   - **ReferenceCounter:** composite primary key (type, year), value.
4. Generate the initial migration, then create a second migration (`--create-only`) with the raw SQL for the partial unique indexes and CHECK constraints. Never edit an applied migration.
5. Implement `nextReference` and `recordActivity` with tests. The concurrency test runs 20 parallel `nextReference` calls in separate transactions and asserts 20 unique, gap-free values.
6. Implement the test-DB guard, reset and global setup. Verify that the guard throws when the URLs match.
7. Write the seed and run it twice to prove idempotency.
8. Add the readiness endpoint and its tests (DB up → 200; simulate DB down → 503).
9. Update CI and docs.

## F. Quality requirements

- Constraints live in the database, not only in code. Add tests that attempt the violations directly with Prisma or raw SQL and assert that the database rejects them.
- No floats for money: every money column is `Decimal`.
- Seed data is entirely fictional (`.test` emails, 555-01xx phones, fictional street addresses), and its copy is realistic and specific (no lorem ipsum).
- Migrations are reproducible from an empty database, and `prisma migrate deploy` is the only way schema changes reach shared environments.

## G. Acceptance criteria

1. `npm run db:test:up` followed by `npm run test:integration` applies all migrations to an empty test DB and runs the integration tests green.
2. Database-level tests prove each of the following is rejected:
   - a second SENT quotation for a request
   - a second DRAFT quotation for a request
   - a second non-VOID invoice for a work order
   - a second work order for a quotation or request
   - two default addresses for one customer
   - `scheduledEnd ≤ scheduledStart`
   - `quantity ≤ 0`
   - a negative amount
   - `amountPaid > totalAmount`
   - a duplicate normalized email or Google subject
   - a user with neither `passwordHash` nor `googleSubject`
   - a second `BusinessSettings` row
   - a FIXED service without a price
3. `nextReference` produces the D-17 format, uses the business-timezone year (test a UTC instant that falls in a different local year), and is unique and sequential under 20 concurrent calls.
4. `recordActivity` stores events and rejects disallowed metadata keys.
5. `assertTestDatabase()` throws when `NODE_ENV` is not `test` or when the test URL equals `DATABASE_URL`.
6. `/api/v1/health/ready` returns 200 with the DB up and 503 with it unreachable; `/api/v1/health` never queries the DB.
7. `npm run db:seed` runs twice without duplicates and creates the settings, 5 services, the 3 demo accounts (Argon2id hashes verifiable with the env passwords; customers with profiles and addresses), and 3 technicians. Without the demo password variables it refuses with a clear message.
8. The enum parity test passes.
9. CI includes Postgres and the integration tests. `docs/ARCHITECTURE.md` contains the ER diagram and the invariants list.
10. If Neon credentials were provided, `prisma migrate deploy` and the seed succeed against the Neon `dev` branch through the direct URL and the app connects through the pooled URL. If they were not provided, this is recorded as pending.

## H. Testing and verification

Run and record:
- `npm run db:test:up`
- `npm run test:integration`
- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run db:seed`, twice, against the dev DB (Docker or Neon dev)
- `curl` both health endpoints

## I. Documentation and progress updates

- Progress file: the T03 entry. Add "Neon verification" to the pending external verifications if it was not done.
- Traceability: DM-01…DM-05, FR-021 (generator), FR-030, FR-032, FR-051, BR-01, BR-17/18 (storage), NFR-08/09, DD-01…DD-03, CFG-01, DEP-01 (local/test), DEP-04.
- `prompts/README.md` status; decisions D-17 and D-29 marked `ACCEPTED`, or updated.
- README (DB setup, test DB, migrations, seed), `docs/ARCHITECTURE.md`, `.env.example`, and `CLAUDE.md` §6 if commands changed.

## J. Completion report

Report:
- what was implemented and the important files
- the schema summary (entities and DB-enforced invariants)
- each acceptance criterion with pass/fail
- the commands executed and their actual results
- the Neon verification status
- limitations or blockers
- a suggested commit message
- the next task: **T04 — Design system, UI primitives and application shells** (`prompts/04-design-system.md`), if it has not already been done; otherwise **T05**
