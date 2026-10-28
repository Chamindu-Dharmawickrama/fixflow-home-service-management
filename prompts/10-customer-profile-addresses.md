# T10 — Customer Profile and Service Addresses

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T10 |
| Title | Customer profile and service addresses |
| Phase | 3 — Customers and service requests |
| Objective | Let customers view and update their permitted profile fields and manage multiple service addresses with a default. Role, email and identity fields cannot be manipulated. |

## B. Context

- Read first: `CLAUDE.md`; spec §4.3 (customer needs), §8.2 (FR-013, FR-014), §8.4 (FR-030), §9.3 (`/portal/profile`), §12.1 (`CustomerProfile`, `ServiceAddress`), §14.1 (`PATCH /customers/me`), §15.2 (collect only required data).
- Decisions: D-07 (dual sign-in; email is read-only in the profile, D-39), D-51 (change password), D-36 (address snapshots: editing an address never changes past requests), D-20 (limits), D-41.
- Requirements: FR-013, FR-014, FR-030, SEC-DATA-02, IA-C06.

## C. Prerequisites

- T05 and T06 `COMPLETED`.

## D. Scope

**In scope — API** (`modules/customers`, customer-facing part)
- `GET /api/v1/customers/me`: profile (name, email read-only, phone, avatar) and addresses (default first).
- `PATCH /api/v1/customers/me { name?, phone? }`:
  - strict schema; unknown keys such as `role`, `email`, `userId`, `isActive` → 422
  - name 2–100 chars, trimmed
  - phone optional; a lenient international format (digits, spaces, `+ - ( )`, 7–20 chars) normalized for storage
- `GET /api/v1/customers/me/addresses`, `POST /api/v1/customers/me/addresses`, `PATCH /api/v1/customers/me/addresses/:id`, `DELETE /api/v1/customers/me/addresses/:id`, `POST /api/v1/customers/me/addresses/:id/default`.
  - Fields: label (e.g. Home, Rental unit, 2–40 chars), line1, line2?, city, region?, postalCode, accessNotes? (≤ 500; "Gate code, parking, pets…").
  - Maximum 10 addresses per customer.
  - The first address becomes the default automatically. Changing the default is transactional (exactly one default). Deleting the default promotes the most recently updated remaining address.
  - Deleting is allowed because requests store snapshots; the FK on requests is `SET NULL`.
  - Ownership is enforced: another customer's address ID returns 404.
- Admins calling `/customers/me*` get 403 (admins have no customer profile).

**In scope — Web**
- `/portal/profile`:
  - "Contact details" form (name, phone, email shown read-only with "Contact us if you need to change your email")
  - "Sign-in & security" section: the sign-in methods on the account (password, Google) and the T05 `ChangePasswordForm` (or "Set a password" via the reset flow when the account has no password). Demo accounts see that password changes are disabled in the demo.
  - "Service addresses" card list showing the label, formatted address, a default badge and access notes (truncated); actions Edit, Set as default and Delete (ConfirmDialog explaining that past requests keep their original address)
  - "Add address" dialog with validation
  - empty state guiding the customer to add an address
  - success toasts after the server confirms
- Add the portal nav entry "Profile". Update the `/portal` interim home to show the profile summary with a link.
- Create a reusable `AddressForm` and `AddressSelector` components (selector used by T11).

**Out of scope**
Admin views of customers (T13), address geocoding or validation services, customer account deletion (D-39).

## E. Implementation instructions

1. Inspect the T03 models, the T05 session (`req.auth.customerId`) and the T04 form components.
2. Implement the services with ownership helpers, then the routes, then the integration tests. Make sure customer scope always comes from `req.auth`.
3. Build the UI, then the E2E tests and axe.

## F. Quality requirements

- Collect only the fields the workflow needs (SEC-DATA-02).
- Access notes are shown only to the owner and to admins; they are never in public payloads or logs.
- Forms preserve input on server errors and show field-level messages.

## G. Acceptance criteria

1. A customer can read and update their name and phone. Payloads with `role`, `email` or unknown keys are rejected with 422, and the stored values are unchanged.
2. Address CRUD works, with exactly one default at all times (DB constraint plus service logic). Default promotion works on delete. The limit of 10 is enforced.
3. Customer B receives 404 when reading, updating, deleting or defaulting customer A's address, and A's data is unchanged. Admins receive 403 on `/customers/me*`.
4. `/portal/profile` supports every flow with loading, empty, error and success states, works at 4 widths, and is axe-clean.
5. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Integration: all of G.1–G.3.
- E2E (demo customer): edit phone; add an address; set it as default; delete one with confirmation; check the empty state with a fresh customer (customer-b, after removing its address in setup).
- Run all standard commands.

## I. Documentation and progress updates

- Progress, traceability (FR-013, FR-014, FR-030, SEC-DATA-02, IA-C06), `prompts/README.md`, `docs/API.md`.

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their results
- limitations
- a suggested commit message
- the next task: **T11 — Service request submission and customer request tracking** (`prompts/11-service-request-submission.md`)
