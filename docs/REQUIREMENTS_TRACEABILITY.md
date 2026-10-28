# FixFlow — Requirements Traceability

**Created:** 2026-10-28 · Maps documented requirements to implementation tasks (`T01`–`T27`, see `prompts/README.md`) and to their verification.

## How to use this file

- **IDs.** `FR-xxx` IDs come from the canonical spec (§8). All other IDs were assigned here for traceability and do **not** change the source documents:
  - `BR` — business rules (§11), numbered as in the spec
  - `SM` — status models (§6)
  - `WF` — workflows (§7)
  - `IA` — routes (§9)
  - `UX` — UI/UX (§10)
  - `DM` — data modelling (§12.3)
  - `API` — API conventions (§14.5)
  - `SEC` — security (§15)
  - `NFR` — non-functional requirements (§16)
  - `AC` — acceptance criteria (§17)
  - `TS` — testing strategy (§18)
  - `DD` — demo data (§19)
  - `DEP` — deployment (§21)
  - `PF` — portfolio (§22)
  - `SC` — success criteria (§3.3)
  - `NG` — non-goals (§3.4)
  - `CFG` — `Note.md`
- **Priority.** `MUST`, `SHOULD`, `FUTURE` and `N/A` follow the spec. Unlabelled spec items are treated as MUST.
- **Status values.** `Planned` (not yet implemented), `In progress`, `Implemented` (code exists, verification incomplete), `Verified` (acceptance tests passed and were recorded in `IMPLEMENTATION_PROGRESS.md`), `N/A` (with reason), `Excluded` (out of scope by design).
- **Updating.** After each task, update the Status column for the rows it addressed. Change a row to `Verified` only when its verification ran and passed. Add the test file names to the Verification column when they exist.

---

## 1. Functional requirements (spec §8)

### 1.1 Public website and catalogue

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-001 | Branded homepage: headline, services, CTA, trust, highlights, contact | MUST | T08 (data: T07) | E2E homepage renders API data; visual QA at 4 widths | Planned |
| FR-002 | Active services listed with name, category, description, image/icon, starting price or "Request a quote" | MUST | T07, T08 | Integration: public list excludes inactive; E2E services page | Planned |
| FR-003 | Service detail: description, inclusions, duration, request action | MUST | T08 | E2E detail + CTA routes to request flow; inactive slug → 404 | Planned |
| FR-004 | Public site responsive and accessible | MUST | T04, T08, T25 | axe (no serious/critical), keyboard nav test, overflow checks | Planned |
| FR-005 | FAQs, service area, "How it works" | SHOULD | T08 | E2E content sections present; content from settings where applicable | Planned |
| FR-006 | Inactive services hidden; direct-API request for inactive service rejected | MUST | T07, T11 | Integration: public endpoints exclude; `POST /requests` with inactive service → 422/409 | Planned |

### 1.2 Authentication and profile

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-010 | Customer registration, login, logout; password reset if email configured | MUST | T05 | Integration: local register/login, Google sign-in, forgot/reset/change password (single-use expiring token, sessions revoked), logout invalidates session; dev fallback via log transport (D-07, D-51) | Planned |
| FR-011 | Protected admin area; no hard-coded production admin credentials | MUST | T05 | Integration: admin routes 401/403; allowlist from env; secret scan in T25 | Planned |
| FR-012 | Role and ownership enforced server-side on every protected endpoint | MUST | T05, every API task, T25 | Per-endpoint integration tests; authorization matrix test (T25) | Planned |
| FR-013 | Customers view/update permitted profile fields and service addresses | MUST | T10 | Integration + E2E profile/address flows | Planned |
| FR-014 | Customers cannot change role or reach admin settings via payload manipulation | MUST | T05, T10 | Integration: strict schema rejects `role`/`email`; admin endpoints 403 for customers | Planned |
| FR-015 | HTTP-only cookies; CSRF protection appropriate to design | SHOULD | T02, T05 | Integration: cookie flags; Origin mismatch → 403 | Planned |

### 1.3 Service requests

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-020 | Customer creates request for an active service with description, address, preferred window | MUST | T11 | Integration + E2E submission | Planned |
| FR-021 | Unique human-readable reference generated server-side | MUST | T03, T11 | Unit/concurrency test of counter; integration format `FF-YYYY-NNNNN` | Planned |
| FR-022 | Customers view only their own requests and customer-visible history | MUST | T11 | Integration: customer B → 404; DTO key allowlist test | Planned |
| FR-023 | Admin search/filter/sort/paginate requests | MUST | T12 | Integration: filters, sort allowlist, max pageSize; E2E queue | Planned |
| FR-024 | Admin opens request, updates permitted status, adds internal notes, sees customer history | MUST | T12 | Integration + E2E request detail | Planned |
| FR-025 | Status changes validated and create activity events | MUST | T12 (T03 writer) | Unit transition table; integration 409 + unchanged; activity row asserted | Planned |
| FR-026 | Admin cancel with reason (internal or customer-visible) | SHOULD | T12 | Integration: reason required; customer sees only customer-visible message | Planned |

### 1.4 Customer management

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-030 | Customer records: name, email, phone, one or more addresses | MUST | T03, T10 | Schema + profile integration tests | Planned |
| FR-031 | Admin searches customers and views request/job/invoice history | MUST | T13 | Integration + E2E customer detail tabs | Planned |
| FR-032 | Unique normalized email for login identities | MUST | T03, T05 | DB unique constraint test; sign-in with differently-cased email maps to same user | Planned |
| FR-033 | Internal customer notes separated from customer-visible data | SHOULD | T13 | Integration: notes never in customer endpoints | Planned |

### 1.5 Quotations

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-040 | Draft quotation linked to request and customer | MUST | T14 | Integration create in allowed request states only | Planned |
| FR-041 | Multiple line items: description, quantity, unit price, line amount | MUST | T14 | Integration + component test of editor | Planned |
| FR-042 | Server calculates subtotal/discount/tax/total, decimal-safe, configured currency/tax | MUST | T14 | Unit worked examples (D-19); integration ignores client totals | Planned |
| FR-043 | Preview and send to customer portal | MUST | T14 | Integration send; E2E preview + send | Planned |
| FR-044 | Customer accepts/declines only own, available quotation | MUST | T15 | Integration: B → 404; expired/void/double → 409 | Planned |
| FR-045 | Decision stores actor + timestamp, creates activity | MUST | T15 | Integration asserts `respondedAt/By` and event | Planned |
| FR-046 | Sent quotation cannot be silently edited; replacement/withdrawal workflow | MUST | T14 | Integration PATCH SENT → 409; replace voids previous atomically | Planned |
| FR-047 | Valid-until date and customer-facing terms | SHOULD | T07 (defaults), T14 | Integration + UI shows validity/terms | Planned |

### 1.6 Work orders and scheduling

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-050 | Convert accepted quotation without re-entering data | MUST | T17 | Integration idempotent conversion; E2E | Planned |
| FR-051 | Work order: reference, customer, address, scope, start/end, technician, status | MUST | T03, T17 | Schema + DTO tests | Planned |
| FR-052 | Jobs list and calendar/schedule view | MUST | T17 (list), T19 (calendar) | E2E list filters; E2E calendar navigation | Planned |
| FR-053 | Assign/change technician and time | MUST | T17 | Integration schedule/reschedule | Planned |
| FR-054 | Validate timestamps; block/warn overlapping technician appointments consistently | MUST | T17 | Unit overlap; integration 409 incl. concurrency (D-25) | Planned |
| FR-055 | Transition job through permitted statuses; completion notes | MUST | T18 | Unit transition table; integration 409 + unchanged | Planned |
| FR-056 | Customer sees schedule, status, customer-visible completion details | MUST | T18 | Integration DTO; E2E portal job detail | Planned |
| FR-057 | Reschedule records old/new time and notifies customer | SHOULD | T17 | Integration event metadata + notification | Planned |

### 1.7 Technician resources

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-060 | Create, update, deactivate, list technicians | MUST | T16 | Integration CRUD; E2E | Planned |
| FR-061 | Inactive technicians cannot be assigned to new jobs | MUST | T16, T17 | Integration schedule with inactive tech → rejected | Planned |
| FR-062 | Technician upcoming jobs and availability summary | SHOULD | T16 (data from T17) | Integration + UI | Planned |
| FR-063 | Technician login and mobile interface | FUTURE | — | — | Excluded |

### 1.8 Invoices and payments

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-070 | Draft invoice from completed job / agreed items | MUST | T20 | Integration: non-completed → 409; lines copied from accepted quote | Planned |
| FR-071 | Issue: unique invoice number, issue date, due date | MUST | T20 | Integration incl. concurrent issue → one number | Planned |
| FR-072 | Owning customer views invoice and downloads/prints PDF | MUST | T22 | Integration auth on PDF; E2E download; manual print | Planned |
| FR-073 | Record manual payment: amount, date, method, reference | MUST | T21 | Integration + E2E | Planned |
| FR-074 | Remaining balance and status calculated consistently | MUST | T20, T21 | Unit derivation; integration `amountPaid` = Σ active payments | Planned |
| FR-075 | Overpayment rejected with helpful error | MUST | T21 | Integration 422 `PAYMENT_EXCEEDS_BALANCE`; concurrent payments | Planned |
| FR-076 | No silent deletion; voids/corrections need reason + audit | MUST | T20, T21 | Integration: no delete routes; void requires reason; event recorded | Planned |
| FR-077 | Invoice filters: status, due date, customer | SHOULD | T20 | Integration + E2E filters | Planned |

### 1.9 Dashboard, search and reporting

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-080 | KPIs: new requests, requests needing action, jobs today/upcoming, completed awaiting invoice, unpaid balance | MUST | T23 | Integration against deterministic fixture | Planned |
| FR-081 | KPIs derived from DB, respect period and business timezone | MUST | T23 | Unit period boundaries (DST); integration timezone edge | Planned |
| FR-082 | "Needs attention" section with direct links | MUST | T23 | Integration items + E2E links navigate | Planned |
| FR-083 | Empty states with guidance | MUST | T04 (pattern), all UI tasks | Component + E2E empty-state checks | Planned |
| FR-084 | CSV export for admin lists, minimal personal data | SHOULD | T23 | Integration: columns, escaping, formula-injection guard | Planned |
| FR-085 | Date-range selection; metric explanations | SHOULD | T23 | E2E range switch; definitions rendered | Planned |

### 1.10 Notifications and activity

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-090 | In-app notifications for key events | MUST | T06 (infra); T11, T14, T15, T17, T18, T20, T21 (events) | Integration per event asserts recipient + link; E2E bell | Planned |
| FR-091 | Transactional email via provider adapter when configured | SHOULD | T06, T26 | Unit templates; integration log transport; manual SMTP in T26 | Planned |
| FR-092 | Notification creation distinct from email delivery; failures logged, never reverse action | MUST | T06 | Integration: failing transport → business op succeeds, log `FAILED` | Planned |
| FR-093 | State changes recorded with actor, timestamp, entity, action, safe summary | MUST | T03 (writer), all workflow tasks | Integration asserts events; metadata allowlist test | Planned |
| FR-094 | Internal notes and internal activity hidden from customers | MUST | T06, T11, T12, T18, T25 | DTO leak tests; E2E customer never sees internal note | Planned |

### 1.11 Settings

| ID | Requirement | Pri. | Task(s) | Verification | Status |
|---|---|---|---|---|---|
| FR-100 | Editable business name, logo, contact, currency, timezone, tax | MUST | T07 | Integration validation; E2E edit reflected on public site | Planned |
| FR-101 | Service management: create, edit, publish/unpublish, archive | MUST | T07 | Integration + E2E | Planned |
| FR-102 | Invoice footer/payment instructions; default quotation validity | SHOULD | T07, T14, T20 | Integration defaults applied to new documents | Planned |

## 2. Business rules (spec §11)

| ID | Rule (abridged) | Task(s) | Verification | Status |
|---|---|---|---|---|
| BR-01 | Login email normalized and unique | T03, T05 | Unique constraint + normalization unit test | Planned |
| BR-02 | Request belongs to one customer and one active service at submission | T11 | Integration | Planned |
| BR-03 | Customer access scoped by authenticated ID, not browser-supplied IDs | T05, all API tasks | Integration cross-customer 404; T25 matrix | Planned |
| BR-04 | Only admin manages catalogue, settings, all records | T05, T07 | Integration 403 for customers | Planned |
| BR-05 | Totals computed server-side with decimal arithmetic | T14, T20 | Unit + integration (client totals ignored) | Planned |
| BR-06 | Quantity > 0; prices, discounts, taxes, payments within allowed ranges | T02 (limits), T14, T20, T21 | Validation integration tests at limits | Planned |
| BR-07 | SENT quotation immutable; replacements preserve previous offer | T14 | Integration | Planned |
| BR-08 | Accept/decline only SENT, unexpired, own quotation | T15 | Integration | Planned |
| BR-09 | Scheduling requires accepted quotation, customer, address, valid times | T17 | Integration | Planned |
| BR-10 | End after start; technician overlap enforced server-side | T17 | Unit + integration incl. concurrency | Planned |
| BR-11 | Inactive technicians cannot receive assignments | T16, T17 | Integration | Planned |
| BR-12 | Job state transitions validated by API | T17, T18 | Unit + integration | Planned |
| BR-13 | Invoice only from eligible job; issued invoices need void/correction, not edits | T20 | Integration | Planned |
| BR-14 | Payment positive and ≤ remaining balance | T21 | Integration | Planned |
| BR-15 | Invoice payment state derived from total, payments, due date, issue/void | T20, T21 | Unit derivation precedence (D-26) | Planned |
| BR-16 | Voided/cancelled records stay with actor, date, reason | T12, T14, T18, T20, T21 | Integration asserts fields + events | Planned |
| BR-17 | Timestamps stored UTC; displayed in business timezone | T03, T04, T11, T17, T19, T23 | Unit TZ tests; E2E with differing browser TZ (T19/T25) | Planned |
| BR-18 | Explicit currency code; never inferred from browser locale | T03, T04, T14, T20 | Formatting unit tests; DTO includes `currencyCode` | Planned |
| BR-19 | Internal notes never in customer-facing payloads | T06, T11, T12, T18, T25 | DTO key allowlist tests | Planned |
| BR-20 | Activity logs exclude passwords, tokens, card data, unnecessary PII | T03, T06, T25 | Metadata allowlist unit test; log redaction test | Planned |
| BR-21 | References are not authorization | T05, T11, T25 | Integration: lookup by reference still enforces ownership | Planned |
| BR-22 | Email errors never undo the business transaction | T06 | Integration with failing transport | Planned |

## 3. Status models (§6) and workflows (§7)

| ID | Requirement | Task(s) | Verification | Status |
|---|---|---|---|---|
| SM-REQ | Service-request statuses and transitions (§6.2, D-21) | T12, T14, T15, T17 | Table-driven unit test of all pairs; integration for system transitions | Planned |
| SM-QUO | Quotation statuses incl. EXPIRED/VOID; no in-place edit of SENT (§6.3, D-22) | T14, T15 | Unit + integration (clock-driven expiry) | Planned |
| SM-WO | Work-order statuses; no COMPLETED from PENDING_SCHEDULING (§6.4, D-24) | T17, T18 | Unit table + integration | Planned |
| SM-INV | Invoice statuses derived consistently (§6.5, D-26) | T20, T21 | Unit derivation + integration | Planned |
| WF-7.1 | Customer requests a service | T11 | E2E | Planned |
| WF-7.2 | Business reviews and prepares quotation | T12, T14 | E2E | Planned |
| WF-7.3 | Customer accepts/declines quotation | T15 | E2E | Planned |
| WF-7.4 | Business schedules a job | T17, T19 | E2E | Planned |
| WF-7.5 | Job completion | T18 | E2E | Planned |
| WF-7.6 | Invoice issuance and manual payment | T20, T21, T22 | E2E | Planned |
| WF-7.7 | Customer returns to view progress | T11, T15, T18, T22, T23 | E2E main journey (T25) | Planned |

## 4. Information architecture (spec §9)

| ID | Route | Task | Status |
|---|---|---|---|
| IA-P01 | `/` | T08 | Planned |
| IA-P02 | `/services` | T08 | Planned |
| IA-P03 | `/services/[slug]` | T08 | Planned |
| IA-P04 | `/login` | T05 | Planned |
| IA-P05 | `/register` | T05 | Planned |
| IA-P07 | `/forgot-password`, `/reset-password` (FR-010; added by D-07) | T05 | Planned |
| IA-P06 | `/request-service` | T11 | Planned |
| IA-A01 | `/app/dashboard` | T05 (interim), T23 (final) | Planned |
| IA-A02 | `/app/requests` | T12 | Planned |
| IA-A03 | `/app/requests/[id]` | T12 (+T14, T17 actions) | Planned |
| IA-A04 | `/app/quotations/[id]` | T14 | Planned |
| IA-A05 | `/app/jobs` | T17 (+T18 tabs) | Planned |
| IA-A06 | `/app/calendar` | T19 | Planned |
| IA-A07 | `/app/jobs/[id]` | T17, T18 (+T20 invoice action) | Planned |
| IA-A08 | `/app/customers` | T13 | Planned |
| IA-A09 | `/app/customers/[id]` | T13 | Planned |
| IA-A10 | `/app/technicians` | T16 | Planned |
| IA-A11 | `/app/invoices` | T20 | Planned |
| IA-A12 | `/app/invoices/[id]` | T20, T21, T22 | Planned |
| IA-A13 | `/app/settings/business` | T07 | Planned |
| IA-A14 | `/app/settings/services` | T07 | Planned |
| IA-C01 | `/portal` | T05 (interim), T11/T15/T18/T22 (sections), T23 (final) | Planned |
| IA-C02 | `/portal/requests`, `/portal/requests/[id]` | T11 | Planned |
| IA-C03 | `/portal/quotations/[id]` | T15 | Planned |
| IA-C04 | `/portal/jobs`, `/portal/jobs/[id]` | T18 | Planned |
| IA-C05 | `/portal/invoices`, `/portal/invoices/[id]` | T22 | Planned |
| IA-C06 | `/portal/profile` | T10 | Planned |
| IA-X01 | Role-aware navigation; customers never see admin links (server still enforces) | T04, T05 | Planned |
| IA-X02 | `/privacy` demo privacy notice (supports SEC-DATA-05) | T08 | Planned |

## 5. UI/UX (spec §10)

| ID | Requirement | Task(s) | Verification | Status |
|---|---|---|---|---|
| UX-01 | Professional before decorative | T04, all UI tasks, T25 | Visual QA checklist | Planned |
| UX-02 | One product identity across site, admin, portal | T04, T25 | Visual QA; shared tokens | Planned |
| UX-03 | Action-oriented dashboard | T23 | Needs-attention items link to actions | Planned |
| UX-04 | Status = text + consistent colour | T04 | `StatusBadge` test covers every enum value | Planned |
| UX-05 | Realistic content | T08, T24 | Content review; no lorem ipsum (grep) | Planned |
| UX-06 | Complete interaction states | T04, all UI tasks | Per-screen state checklist in each prompt | Planned |
| UX-07 | Responsive by design; tables collapse or scroll intentionally | T04, all UI tasks, T25 | Overflow assertions at 4 widths | Planned |
| UX-08 | Accessible controls | T04, all UI tasks, T25 | axe + keyboard walkthrough | Planned |
| UX-VD | Visual direction: navy/blue-green primary, teal accent, neutrals, semantic status colours, readable sans-serif | T04 | Contrast table in `DESIGN_SYSTEM.md` | Planned |
| UX-QB-DASH | Dashboard quality bar (§10.3) | T23 | E2E + screenshot review | Planned |
| UX-QB-REQ | Request-detail quality bar | T12 | E2E + screenshot review | Planned |
| UX-QB-QUO | Quotation-editor quality bar | T14 | Component + E2E | Planned |
| UX-QB-CAL | Calendar quality bar incl. list alternative | T19 | E2E at 360 px and 1440 px | Planned |
| UX-QB-INV | Print-ready invoice; issuance vs payment distinct | T20, T21, T22 | Manual print check; E2E | Planned |
| UX-INT-01 | Validation feedback; values preserved after errors | T04 (FormField), all forms | Component + E2E | Planned |
| UX-INT-02 | Confirm destructive/irreversible actions with consequences | T04 (ConfirmDialog), T12, T14, T15, T18, T20, T21 | E2E | Planned |
| UX-INT-03 | Optimistic UI only when reliably reversible | All UI tasks | Code review (default: update after server success) | Planned |
| UX-INT-04 | Disable duplicate submissions | T04 (Button loading), all forms | E2E double-click tests on key actions | Planned |
| UX-INT-05 | Skeletons/loading indicators; explained empty states | T04, all UI tasks | E2E with delayed network | Planned |
| UX-INT-06 | Never fake success, email delivery or payment confirmation | T06, T21, all UI tasks | Review + integration (`LOGGED` vs `SENT`) | Planned |

## 6. Data model, API conventions and security

| ID | Requirement | Task(s) | Verification | Status |
|---|---|---|---|---|
| DM-01 | FKs and unique constraints for invariants | T03 | Constraint integration tests | Planned |
| DM-02 | Enums for roles/statuses | T03 | Enum parity test (Prisma ↔ shared) | Planned |
| DM-03 | Decimal money, defined rounding | T03, T14 | Schema + unit tests | Planned |
| DM-04 | Snapshot sent quotations / issued invoices | T14, T20 | Integration: price change after send doesn't alter document | Planned |
| DM-05 | Transactions for multi-record operations | T03 + domain tasks | Integration failure-injection tests roll back fully | Planned |
| DM-06 | Avoid duplicate conversion/issuance on double-click | T15, T17, T20 | Concurrency integration tests | Planned |
| DM-07 | Status-based voiding instead of deleting history | T14, T20, T21 | No delete routes; void fields populated | Planned |
| API-01 | Validate params, query, body | T02, all API tasks | Integration 422 tests | Planned |
| API-02 | 401/403/404/409/422 used consistently | T02, all API tasks, T25 | Error-contract tests; matrix | Planned |
| API-03 | Consistent error format | T02 | Error-handler tests | Planned |
| API-04 | Pagination with max page size | T02, list endpoints | Integration | Planned |
| API-05 | Totals, roles, ownership, transitions server-side | All API tasks | Integration | Planned |
| API-06 | Duplicate-submission protection | T11, T14, T15, T17, T20, T21 | Concurrency/idempotency tests | Planned |
| API-07 | No hashes, secrets, internal notes in serializers | All API tasks, T25 | DTO leak tests | Planned |
| SEC-AUTH-01 | Modern password hashing if local passwords | T05 | Unit: Argon2id hash/verify; integration: no plaintext stored or logged (D-51) | Planned |
| SEC-AUTH-02 | Secure HTTP-only same-site cookies | T05, T26 | Integration cookie attributes; prod verification | Planned |
| SEC-AUTH-03 | Every admin endpoint protected | T05, T25 | Authorization matrix | Planned |
| SEC-AUTH-04 | Ownership for requests, quotes, jobs, invoices, notifications, PDFs | T05, T06, T11, T15, T18, T22, T25 | Cross-customer tests | Planned |
| SEC-AUTH-05 | Validate uploads if introduced | — | N/A: no uploads (D-30) | N/A |
| SEC-AUTH-06 | Rate limiting on login, registration, abuse-prone endpoints | T02, T05, T11, T15, T24 | Integration 429 | Planned |
| SEC-AUTH-07 | No hard-coded secrets; no committed `.env` | T01, T25 | `.gitignore`; secret scan | Planned |
| SEC-DATA-01 | Fictional demo identities and addresses | T03, T24 | Seed review (`.test` emails, 555-01xx phones) | Planned |
| SEC-DATA-02 | Collect only required data | T10, T11 | Schema review | Planned |
| SEC-DATA-03 | Private notes separate from customer-visible | T12, T13 | Integration | Planned |
| SEC-DATA-04 | No descriptions/emails/addresses in broad logs | T02, T25 | Redaction test; log review | Planned |
| SEC-DATA-05 | Clear demo privacy notice / portfolio disclosure | T08, T24 | E2E banner + `/privacy` | Planned |
| SEC-DATA-06 | Restrict demo admin access; rotate if abused | T05, T24, T26 | Demo-mode tests; runbook | Planned |
| SEC-TXN-01 | Transactions for multi-record changes | T03 + domain tasks | Integration | Planned |
| SEC-TXN-02 | No double acceptance, duplicate work orders, duplicate issuance | T15, T17, T20 | Concurrency tests | Planned |
| SEC-TXN-03 | Validate balances; no negative totals | T14, T21 | Unit + integration | Planned |
| SEC-TXN-04 | Audit history for quotes, job changes, invoice voids, payment corrections | T14, T18, T20, T21 | Integration asserts events | Planned |
| SEC-TXN-05 | Notification/PDF failures never produce misleading success or corrupt records | T06, T22 | Failure-injection tests | Planned |
| SEC-FILE-01 | PDFs from persisted data | T22 | Unit: builder takes DB snapshot only | Planned |
| SEC-FILE-02 | PDF endpoint authorizes owner/admin | T22 | Integration | Planned |
| SEC-FILE-03 | Email templates escape untrusted text | T06 | Unit XSS payload test | Planned |
| SEC-FILE-04 | No internal notes in customer emails | T06 + emitting tasks | Template input types exclude internal fields | Planned |
| SEC-FILE-05 | Email failures recorded safely | T06 | Integration log row without secrets | Planned |

## 7. Non-functional requirements (spec §16)

| ID | Area | Task(s) | Verification | Status |
|---|---|---|---|---|
| NFR-01 | Usability (first-time request/new-request discovery without training) | T11, T12, T23, T25 | E2E journey; manual walkthrough | Planned |
| NFR-02 | Responsiveness | T04, all UI tasks, T25 | Overflow + screenshot checks at 4 widths | Planned |
| NFR-03 | Accessibility (WCAG 2.2 AA practices) | T04, all UI tasks, T25 | axe + keyboard | Planned |
| NFR-04 | Performance (pagination, no unbounded sets) | T02, list tasks, T25 | Max pageSize tests; query review | Planned |
| NFR-05 | Reliability (visible errors; success only after server success) | T04, T06, T25 | E2E network-error tests | Planned |
| NFR-06 | Maintainability (TS, modules, lint, migrations, setup docs) | T01, T02, T03, T27 | CI | Planned |
| NFR-07 | Security | T02, T05, T25 | Matrix, headers, audit | Planned |
| NFR-08 | Data integrity | T03 + domain tasks | Constraint + transaction tests | Planned |
| NFR-09 | Observability (structured logs, health endpoint, safe errors) | T02, T03 | Integration health/ready; log tests | Planned |
| NFR-10 | Portability (env config; local dev without prod creds) | T01, T02, T03 | Fresh-clone check (T27) | Planned |
| NFR-11 | SEO (titles, descriptions, semantic content, shareable URLs) | T08 | Metadata tests; sitemap | Planned |
| NFR-12 | Browser support (Chrome, Edge, Firefox, Safari; mobile emulation) | T25, T26 | Playwright chromium/firefox/webkit | Planned |

## 8. Acceptance criteria (spec §17)

| ID | Criterion | Task(s) | Verification | Status |
|---|---|---|---|---|
| AC-RQ-01 | Customer signs in, selects active service, submits request | T05, T11 | E2E | Planned |
| AC-RQ-02 | Invalid fields show errors; no partial request | T11 | Integration + E2E | Planned |
| AC-RQ-03 | Unique server-generated reference | T11 | Integration | Planned |
| AC-RQ-04 | Request in admin queue; accessible to owner only | T11, T12 | Integration + E2E | Planned |
| AC-RQ-05 | Admin moves to review; creates multi-line quotation | T12, T14 | E2E | Planned |
| AC-RQ-06 | Server totals match lines, discount, tax | T14 | Unit + integration | Planned |
| AC-RQ-07 | Customer accepts/declines sent, unexpired quotation | T15 | E2E | Planned |
| AC-RQ-08 | Another customer cannot view/accept by guessing ID | T15 | Integration | Planned |
| AC-RQ-09 | No double acceptance; none after expiry/void | T15 | Integration | Planned |
| AC-SJ-01 | Accepted quotation creates exactly one work order | T17 | Integration concurrency | Planned |
| AC-SJ-02 | Schedule and assign active technician | T17 | E2E | Planned |
| AC-SJ-03 | Invalid times and conflicts handled per documented rule | T17 | Integration | Planned |
| AC-SJ-04 | Portal reflects schedule and customer-visible status | T18 | E2E | Planned |
| AC-SJ-05 | Allowed lifecycle; completion note recorded | T18 | E2E | Planned |
| AC-SJ-06 | Unauthorized transitions rejected; record unchanged | T18 | Integration | Planned |
| AC-IP-01 | Completed job → invoice draft with agreed items | T20 | Integration + E2E | Planned |
| AC-IP-02 | Issue assigns unique number; snapshot locked | T20 | Integration | Planned |
| AC-IP-03 | Customer accesses/downloads only own invoice PDF | T22 | Integration + E2E | Planned |
| AC-IP-04 | Valid payment reduces balance; status updates | T21 | Integration + E2E | Planned |
| AC-IP-05 | Invalid/negative/over-balance payment rejected helpfully | T21 | Integration + E2E | Planned |
| AC-IP-06 | Invoice/payment void controlled, reasoned, audited | T20, T21 | Integration | Planned |
| AC-UQ-01 | Consistent branding and typography | T04, T25 | Visual QA | Planned |
| AC-UQ-02 | Every primary CTA has real action + loading/error/success | All UI tasks, T25 | E2E + review | Planned |
| AC-UQ-03 | Key screens correct at 360/768/1024/1440 | T04, all UI tasks, T25 | Playwright viewport checks | Planned |
| AC-UQ-04 | Seeded fictional records for full demo scenario | T24 | Seed invariant checker | Planned |
| AC-UQ-05 | Fresh clone configured/started via README, no manual DB edits | T01, T03, T27 | Fresh-clone dry run | Planned |
| AC-UQ-06 | Env vars + HTTPS in deployment; no committed secrets | T09, T26 | Deployment verification | Planned |
| AC-UQ-07 | Critical automated tests pass; E2E scenario repeatable | T25, T26 | CI + prod smoke | Planned |

## 9. Testing strategy (spec §18)

| ID | Item | Task(s) | Status |
|---|---|---|---|
| TS-UNIT-01 | Quotation subtotal/discount/tax/total | T14 | Planned |
| TS-UNIT-02 | Invoice balance and status derivation | T20, T21 | Planned |
| TS-UNIT-03 | Request/quotation/work-order/invoice transitions | T12, T14, T17, T18, T20 | Planned |
| TS-UNIT-04 | Scheduling overlap detection | T17 | Planned |
| TS-UNIT-05 | Reference generation | T03 | Planned |
| TS-UNIT-06 | Permission predicates and ownership | T05 | Planned |
| TS-UNIT-07 | Validation of quantities, prices, date ranges, payments | T11, T14, T17, T21 | Planned |
| TS-INT-01 | Unauthenticated / wrong-role rejected | T05 + all, T25 matrix | Planned |
| TS-INT-02 | Customer A cannot read B's requests, quotes, jobs, invoices, notifications, PDFs | T06, T11, T15, T18, T22, T25 | Planned |
| TS-INT-03 | Quotation acceptance atomic and duplicate-safe | T15 | Planned |
| TS-INT-04 | Conversion cannot create two work orders | T17 | Planned |
| TS-INT-05 | Issuance and payments transactionally consistent | T20, T21 | Planned |
| TS-INT-06 | Invalid state changes return stable errors | All domain tasks | Planned |
| TS-INT-07 | Pagination and filters behave | T12, T13, T17, T20 | Planned |
| TS-E2E-01 | Main journey steps 1–10 | Slices T11–T22; full spec T25 | Planned |
| TS-E2E-02 | Responsive, empty states, network errors, validation, expired quote, unauthorized access | T25 | Planned |
| TS-VQA-01…08 | Manual visual QA checklist (§18.4) incl. PDF print and branding | T25 (PDF: T22) | Planned |

## 10. Demo data, deployment, portfolio and success criteria

| ID | Requirement | Task(s) | Verification | Status |
|---|---|---|---|---|
| DD-01 | One fictional business (CoolBreeze Home Services) | T03, T24 | Seed | Planned |
| DD-02 | Suggested services (§19.1) | T03 | Seed | Planned |
| DD-03 | Demo accounts, clearly documented, no personal passwords | T03, T05, T24 | Seeded local accounts with env-supplied, documented fictional credentials; demo accounts locked against password changes (D-09) | Planned |
| DD-04 | Seed volumes (§19.3) | T24 | Invariant checker counts | Planned |
| DD-05 | Internally consistent sample data | T24 | Invariant checker | Planned |
| DD-06 | 2–3 minute demo script/video | T27 | `docs/DEMO_SCRIPT.md` (recording by owner) | Planned |
| DEP-01 | Local, preview/staging, production environments isolated | T03, T09, T26 | `docs/DEPLOYMENT.md` | Planned |
| DEP-02 | Documented env vars; no secrets in `NEXT_PUBLIC_*` | T01, T02, T09 | `.env.example` review | Planned |
| DEP-03 | Repository layout (apps/web, apps/api, packages/shared, CI) | T01 | Tree | Planned |
| DEP-04 | CI: lint, typecheck, tests | T01, T03, T25 | GitHub Actions run | Planned |
| DEP-05 | README minimum content (§21.4) | T27 | Checklist | Planned |
| DEP-06 | Current stable versions; lockfiles committed | T01 | Lockfile present | Planned |
| DEP-07 | Backup/reset approach; local never targets prod DB | T24, T26 | Runbook; guard tests | Planned |
| PF-01 | Case study structure (§22.1) | T27 | `docs/PORTFOLIO_CASE_STUDY.md` | Planned |
| PF-02 | Screenshot selection and order (§22.2) | T27 | `docs/screenshots/` from real app | Planned |
| PF-03 | Honest portfolio status everywhere | T08, T27 | Banner, README, case study | Planned |
| PF-04 | No stock images presented as product screenshots | T27 | Review | Planned |
| SC-01 | Product understandable within 30 s | T08 | Manual review | Planned |
| SC-02 | Shared design system across experiences | T04, T25 | Visual QA | Planned |
| SC-03 | Full workflow demonstrable without manual DB edits | T25, T26 | E2E + prod smoke | Planned |
| SC-04 | Desktop/tablet/mobile | T25 | Viewport checks | Planned |
| SC-05 | No decorative/non-functional buttons | All UI tasks, T25 | Review + E2E | Planned |
| SC-06 | Server-validated status changes reflected in connected screens | Domain tasks, T25 | E2E | Planned |
| SC-07 | Realistic fictional data | T24 | Seed review | Planned |
| SC-08 | Setup/demo instructions usable by another developer | T27 | Fresh-clone dry run | Planned |
| SC-09 | Honest about portfolio status | T08, T27 | Review | Planned |

## 11. Non-goals (spec §3.4) — guarded, not implemented

| ID | Excluded capability | Guard |
|---|---|---|
| NG-01 | Multi-tenant SaaS | CLAUDE.md §1, D-01 |
| NG-02 | Subscriptions/plans/billing for FixFlow | CLAUDE.md §1 |
| NG-03 | Payment gateway or card storage | CLAUDE.md §1, D-27 |
| NG-04 | Route optimization, GPS, live location | CLAUDE.md §1 |
| NG-05 | Native mobile apps | CLAUDE.md §1 |
| NG-06 | Full accounting/tax filing | CLAUDE.md §1; disclaimer in README |
| NG-07 | Payroll, procurement, supplier management | CLAUDE.md §1 |
| NG-08 | Automated WhatsApp/SMS | CLAUDE.md §1 |
| NG-09 | Reviews, campaigns, loyalty | CLAUDE.md §1 |
| NG-10 | Complex approval chains / workflow builder | CLAUDE.md §1 |
| NG-11 | AI chatbot | CLAUDE.md §1 |

## 12. Project configuration (Note.md)

| ID | Configuration | Task(s) | Verification | Status |
|---|---|---|---|---|
| CFG-01 | Neon PostgreSQL | T03, T09, T26 | Migrations deploy to Neon branches | Planned |
| CFG-02 | Upstash Redis | T02, T09, T26 | Rate-limit integration (memory) + hosted check (Upstash) | Planned |
| CFG-03 | Google Sign-In | T05, T09, T26 | Mocked-verifier tests + manual Google sign-in | Planned |
| CFG-04 | Nodemailer + SMTP | T06, T26 | Log transport tests + real SMTP delivery check | Planned |
| CFG-05 | Frontend on Vercel | T09, T26 | Deployed URL | Planned |
| CFG-06 | Backend on Render | T09, T26 | Deployed URL + health | Planned |
