# T07 — Business Settings and Service Catalogue Management

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T07 |
| Title | Business settings and service catalogue management |
| Phase | 2 — Identity, configuration and public experience |
| Objective | Let the business admin configure the business identity, regional, tax and document defaults, and manage the service catalogue (create, edit, publish, unpublish, archive, restore). Expose the active catalogue and the public business profile through public endpoints. |

## B. Context

- Read first: `CLAUDE.md`; spec §5.2 (configurable business), §8.1 (FR-002, FR-006), §8.11 (FR-100…FR-102), §9.2 (settings routes), §12.1 (`BusinessSettings`, `Service`), §14.2 (service endpoints), §19.1.
- Decisions: D-01 (singleton business), D-30 (no uploads: logo and images are bundled keys or https URLs), D-47 (defaults), D-50 (service model), D-29 (activity), D-43 (`availableActions`).
- Requirements: FR-002 (API), FR-006 (public filtering), FR-047 (default terms/validity), FR-100, FR-101, FR-102, BR-04, IA-A13, IA-A14.

## C. Prerequisites

- T06 `COMPLETED` (activity read side and notifications). T05 guards are in place. The seeded settings and services exist (T03).

## D. Scope

**In scope — API**
- `modules/settings`:
  - `GET /api/v1/settings/public` (no auth): businessName, tagline, logo, contact email, phone, address, service area, currencyCode, timeZone. No internal fields. Cacheable (`Cache-Control: public, max-age=60`).
  - `GET /api/v1/admin/settings` and `PATCH /api/v1/admin/settings` (admin) for all fields.
  - Validation:
    - IANA timezone (`Intl.supportedValuesOf('timeZone')`)
    - ISO 4217 currency from an allowlist of 2-decimal currencies (D-18)
    - tax rate 0–100 with 2 dp
    - quotation validity 1–90 days; invoice due 0–90 days
    - https-only logo URL, or a bundled logo key
    - email and phone formats; text length limits
  - Record a `SETTINGS` activity event with changed field **names** only.
- `modules/services`:
  - Public:
    - `GET /api/v1/services`: active only (published and not archived), ordered by `sortOrder` then name, with an optional `category` filter.
    - `GET /api/v1/services/slug/:slug`: active only, otherwise 404.
    - `GET /api/v1/services/:id`: active for the public; admins may see inactive services through the admin route instead.
  - Admin:
    - `GET /api/v1/admin/services`: all, with `status` (published, unpublished, archived), search and pagination.
    - `GET /api/v1/admin/services/:id`
    - `POST /api/v1/admin/services`
    - `PATCH /api/v1/admin/services/:id`, including `isPublished`
    - `POST /api/v1/admin/services/:id/archive` and `/restore`
  - Slugs are auto-generated from the name, unique and kebab-case (`409 SLUG_TAKEN`). FIXED pricing requires `startingPrice`. Inclusions: 0–12 items, each ≤ 120 chars.
  - Admin DTO includes `availableActions` and a computed `isActive`. Activity events record publish, unpublish, archive and restore.

**In scope — Web**
- `/app/settings/business`, a sectioned form:
  - Business identity: name, tagline, logo selection
  - Contact: email, phone, address, service area description
  - Regional and tax: currency, timezone, default tax rate. A clear notice says changes apply to **new** quotations and invoices only.
  - Documents: quotation validity days, default terms, invoice due days, payment instructions, invoice footer

  The form has a save bar, a dirty-state warning, field errors from 422 `fieldErrors`, and a success toast after the server confirms.
- `/app/settings/services`:
  - list (DataTable with name, category, pricing, status badge Published/Unpublished/Archived, updated time), with status filter tabs and search
  - "New service" and edit views (dedicated page or Sheet), with fields for name, slug (with a warning about URL changes), category, short and full description, inclusions list editor, duration, pricing mode with conditional starting price, image key or URL, sort order
  - a live preview of the public service card
  - publish/unpublish toggle and archive/restore with ConfirmDialog
- Add the admin nav entries "Settings → Business" and "Settings → Services". Settings appear in the nav only for admins.
- Add `src/lib/settings`: a server helper that fetches the public settings once per request and provides the business `timeZone`/`currencyCode` to formatting (consumed from T08 onward).

**Out of scope**
Public pages (T08), image uploads (D-30), multiple businesses (D-01).

## E. Implementation instructions

1. Inspect the T03 schema and seed, the T04 form components and the T05 guards. Follow the module conventions in `CLAUDE.md` §5.
2. Write the Zod schemas, then the services, routes and DTOs, then the integration tests, then the UI.
3. Bundled image and logo keys: create a small typed registry of bundled assets in `apps/web/public/images/` (or illustrative compositions if no photos exist yet; see Q-05). The API validates a key against an allowlist kept in `@fixflow/shared`.
4. Keep currency and timezone changes safe. Existing documents keep their snapshots (enforced later by T14/T20). The settings form just explains this.

## F. Quality requirements

- Public settings and service DTOs never include internal fields such as `updatedByUserId`.
- Admin forms preserve input on errors and disable submit while saving. Destructive actions (archive) explain their effect: "Archived services are hidden from the website and can't be requested. Existing requests are unaffected."
- Lists use the URL-param pattern for filters and pagination.

## G. Acceptance criteria

1. Public endpoints return only active services. An unpublished or archived service is absent from the list and returns 404 by slug.
2. Admin service CRUD works:
   - FIXED without a price → 422
   - duplicate slug → 409
   - archive then restore works
   - customer or unauthenticated access to admin routes → 403/401
3. Settings PATCH validates every field as specified. An invalid timezone, currency, tax rate or URL returns 422 with `fieldErrors`. A valid update persists and is reflected by `/settings/public`.
4. Activity events are recorded for settings changes (field names only) and for service lifecycle actions.
5. The admin settings and services UIs work end to end, including validation errors, success feedback, confirm dialogs, empty state (no services matching the filter) and responsive layout at 4 widths.
6. Lint, typecheck, unit, integration, build and E2E pass.

## H. Testing and verification

- Integration: public filtering; admin CRUD and lifecycle; validation edges; authorization; activity events; DTO key allowlists.
- E2E: the admin creates a FIXED service, publishes it, and it appears in `GET /api/v1/services` (asserted via API request in the test); the admin edits the business phone and the public settings endpoint reflects it. Run axe on both settings pages.
- Run all standard commands and record the results.

## I. Documentation and progress updates

- Progress, traceability (FR-002 API, FR-006 public filtering, FR-047 defaults, FR-100, FR-101, FR-102, BR-04, IA-A13, IA-A14), `prompts/README.md`, `docs/API.md` endpoint reference, README if setup changed.

## J. Completion report

Report:
- what was implemented and the important files
- each acceptance criterion with pass/fail
- the commands executed and their actual results
- limitations
- a suggested commit message
- the next task: **T08 — Public website and service pages** (`prompts/08-public-website.md`)
