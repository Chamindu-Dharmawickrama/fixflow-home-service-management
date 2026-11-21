# FixFlow — API Reference

The REST API is an Express 5 application in `apps/server`. This document lists the conventions every endpoint follows and the full endpoint reference. The conventions are implemented by the platform code in `apps/server/src` (see [ARCHITECTURE.md](ARCHITECTURE.md)); error codes, limits and the shared types live in `@fixflow/shared`.

**Verified against the code.** The route index and the error catalogue below were checked mechanically: the index lists exactly the 84 routes the Express app registers (found by walking its router), with the access class and rate limit that the authorization test matrix (`apps/server/src/app.authorization.int.test.ts`) asserts for each one; the catalogue lists every code in `@fixflow/shared` (39) with the status the server answers it with.

**Contents:** [1 Base URL](#1-base-url-and-transport) · [2 Request IDs](#2-request-ids) · [3 Envelopes](#3-response-envelopes) · [4 Errors](#4-status-codes-and-error-codes) · [5 Validation](#5-validation) · [6 Pagination](#6-pagination-and-sorting) · [7 Rate limiting](#7-rate-limiting) · [8 Headers and CORS](#8-security-headers-cors-and-limits) · [9 Authentication](#9-authentication-sessions-and-csrf) · [Route index](#route-index) · [Endpoint reference](#endpoint-reference)

## 1. Base URL and transport

- Every route is under **`/api/v1`**. Anything else returns the `404` error body below.
- The browser never calls the API origin directly. It calls `/api/v1/*` on the web origin, and Next.js rewrites that to `${API_INTERNAL_URL}/api/v1/*`. Server Components call `API_INTERNAL_URL` directly and forward the `cookie` header.
- Request and response bodies are JSON (`application/json`). Request bodies are limited to **100 kb**. The body parser is strict: a top-level JSON primitive or malformed JSON is rejected.
- Primary keys are UUIDs. The human-readable references (`FF-`, `QT-`, `JOB-`, `INV-`) are display identifiers only and never authorize anything.
- Authentication and the CSRF (`Origin`) check are described in [section 9](#9-authentication-sessions-and-csrf).

## 2. Request IDs

Every response carries an **`x-request-id`** header, and every error body repeats it as `error.requestId`.

- A caller may send its own `x-request-id`. It is accepted when it is 8–128 characters of `A–Z a–z 0–9 . _ -`; otherwise the server ignores it and generates a UUID.
- The same ID appears in the server log line for the request, so quoting it is the fastest way to find an error.

## 3. Response envelopes

**Success, single resource or action result**

```json
{ "data": { "status": "ok" } }
```

**Success, list** (see [Pagination](#6-pagination-and-sorting))

```json
{
  "data": [ { "id": "…" } ],
  "pagination": { "page": 1, "pageSize": 20, "totalItems": 45, "totalPages": 3 }
}
```

**Error** (every non-2xx response)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid values.",
    "fieldErrors": { "lines.2.quantity": "quantity must be greater than 0." },
    "requestId": "9c2e3f1e-6c0a-4a7e-9f56-2f6f9b5d2a10"
  }
}
```

| Field         | Always? | Meaning                                                                                                          |
| ------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `code`        | yes     | Machine-readable `ErrorCode` from `@fixflow/shared`. Clients switch on this, never on `message`.                  |
| `message`     | yes     | Human-readable, safe to show. Never contains stack traces, SQL, or internal detail.                               |
| `requestId`   | yes     | Same value as the `x-request-id` response header.                                                                |
| `fieldErrors` | `422`   | One message per field, keyed by dotted request path. See [Validation](#5-validation).                            |
| `details`     | rarely  | Small object of non-sensitive primitives, for example `{ "currentStatus": "SENT" }` on `STALE_STATE`.              |

Money is a decimal **string** with an explicit `currencyCode` (`"1234.50"`), timestamps are ISO 8601 UTC (`2026-03-02T09:00:00.000Z`), and date-only fields are `YYYY-MM-DD`.

## 4. Status codes and error codes

Every error body has the shape in [section 3](#3-response-envelopes). Clients switch on `error.code`, never on the message. The statuses the API uses are `400` malformed request, `401` unauthenticated, `403` wrong role or CSRF failure, `404` missing **or not owned**, `409` state conflict, `413` body too large, `422` validation, `429` rate limited, `500` unexpected and `503` a dependency is unavailable.

| Status | `error.code` | Meaning |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | Malformed request: invalid JSON, a top-level JSON primitive, or a non-JSON body to a write endpoint. |
| `400` | `INVALID_RESET_TOKEN` | The password-reset link is invalid, expired or already used. |
| `401` | `UNAUTHENTICATED` | No valid session. |
| `401` | `INVALID_CREDENTIALS` | Sign-in failed. The same for an unknown email, a wrong password and a Google-only account. |
| `401` | `INVALID_GOOGLE_CREDENTIAL` | The Google ID token could not be verified. |
| `403` | `FORBIDDEN` | Authenticated, but the role is not allowed (or the caller is not on the admin allowlist). |
| `403` | `CSRF_ORIGIN_MISMATCH` | An unsafe request whose `Origin` is not the web app's origin. |
| `403` | `ACCOUNT_DISABLED` | The account was deactivated. Revealed only after a correct password or a verified Google sign-in. |
| `403` | `SIGNUP_DISABLED` | Public sign-up is switched off (`PUBLIC_SIGNUP_ENABLED=false`). |
| `403` | `GOOGLE_EMAIL_NOT_VERIFIED` | Google reports the email address as unverified. |
| `403` | `DEMO_ACCOUNT_LOCKED` | A shared demo account's password cannot be changed or reset while demo mode is on. |
| `404` | `NOT_FOUND` | The route or resource does not exist, **or is not owned by the caller** (this prevents ID probing). |
| `409` | `CONFLICT` | The request conflicts with the record's current state (generic). |
| `409` | `STALE_STATE` | The record changed since it was loaded (`expectedStatus` no longer matches); `details.currentStatus` says what it is now. |
| `409` | `INVALID_STATE_TRANSITION` | The status change is not allowed from the current status. |
| `409` | `EMAIL_TAKEN` | Registration with an email that already has an account. |
| `409` | `PASSWORD_NOT_SET` | A Google-only account tried to change a password it does not have. |
| `409` | `SLUG_TAKEN` | Another service already uses this web address (`fieldErrors.slug`). |
| `409` | `ADDRESS_LIMIT_REACHED` | The customer already has the maximum number of saved addresses (10). |
| `409` | `DRAFT_EXISTS` | The request already has a draft quotation; `details.quotationId` is that draft. |
| `409` | `QUOTATION_NOT_EDITABLE` | Only a draft quotation can be edited. |
| `409` | `QUOTATION_NOT_AVAILABLE` | The customer can no longer answer this quotation (already answered, expired or withdrawn); `details.currentStatus` says which. |
| `409` | `SCHEDULING_CONFLICT` | The technician has a scheduled or in-progress job that overlaps the time asked for; `details` names the first (`conflictReference`, `conflictStart`, `conflictEnd`, `conflictCount`). |
| `409` | `INVOICE_EXISTS` | The job already has an invoice that is not void; `details.invoiceId` is that invoice. |
| `409` | `INVOICE_NOT_EDITABLE` | Only a draft invoice can be edited. |
| `409` | `INVOICE_HAS_PAYMENTS` | An invoice with active payments cannot be voided; void the payments first. |
| `409` | `INVOICE_NOT_PAYABLE` | A payment cannot be recorded on a draft, void or already paid invoice. |
| `409` | `PAYMENT_ALREADY_VOIDED` | The payment was already voided. |
| `413` | `PAYLOAD_TOO_LARGE` | The body is larger than 100 kb. |
| `422` | `VALIDATION_ERROR` | Well-formed JSON whose values fail validation; `fieldErrors` names each field. |
| `422` | `INVALID_CURRENT_PASSWORD` | The current password given when changing a password is wrong. |
| `422` | `SERVICE_INACTIVE` | The service chosen for a request is not open to requests (unpublished, archived or unknown); `fieldErrors.serviceId`. Not the same as `SERVICE_UNAVAILABLE`, which is a `503`. |
| `422` | `TECHNICIAN_INACTIVE` | The technician chosen for a job is inactive (`fieldErrors.technicianId`). |
| `422` | `PAYMENT_EXCEEDS_BALANCE` | The payment is more than the remaining balance; `details.remainingBalance` is what is left. |
| `429` | `RATE_LIMITED` | A rate limit was exceeded; the `Retry-After` header gives the seconds to wait. |
| `500` | `INTERNAL_ERROR` | Unexpected failure. The message is always generic; the cause is logged server-side only. |
| `503` | `SERVICE_UNAVAILABLE` | A dependency the endpoint needs is down, for example the database (`GET /health/ready`). |
| `503` | `GOOGLE_SIGN_IN_UNAVAILABLE` | Google sign-in is not configured on this server. |
| `503` | `PASSWORD_RESET_UNAVAILABLE` | Password reset is unavailable because the server cannot send email. |

Unexpected errors never leak: a `500` body contains no stack trace, no exception message and no `fieldErrors`. The error is logged with its stack, tied to the request ID.

## 5. Validation

Route parameters, query strings and bodies are validated with Zod (`validate({ params, query, body })`). On success the parsed values (coerced, defaulted, with unknown query keys stripped) replace the raw input. On failure the API returns `422 VALIDATION_ERROR` with `fieldErrors`.

- **Body schemas are strict.** An unknown key is an error, reported on the key itself as `"Unknown field."` (so a client cannot, say, send `role` and have it silently ignored). Query strings are not strict: unknown query keys are ignored.
- **Keys are dotted paths** into the request: `customerName`, `lines.2.quantity`, `lines.0.price`. For parameters and query strings the key is the parameter name (`orderId`, `pageSize`). Issues that belong to no single field use the key `_`.
- **One message per field** (the first issue). Messages never echo the rejected value.
- A request with no JSON body is validated as `{}`, so each missing required field is reported rather than one vague error.
- Limits such as quantity, price, line-item count and text lengths are the `LIMITS` constants in `@fixflow/shared`.

## 6. Pagination and sorting

List endpoints accept these query parameters. They come from one schema factory, `createPaginationSchema`, so every list behaves the same.

| Parameter  | Default                     | Rules                                                                 |
| ---------- | --------------------------- | --------------------------------------------------------------------- |
| `page`     | `1`                         | Whole number, 1–100,000.                                              |
| `pageSize` | `20`                        | Whole number, 1–**100**.                                              |
| `sort`     | endpoint-specific           | Must be one of the endpoint's allowlisted fields.                     |
| `order`    | endpoint-specific           | `asc` or `desc`.                                                      |

Values must be plain digits (`1e2`, `+5`, `0x10` and repeated parameters are rejected). Any invalid value returns `422` with the parameter in `fieldErrors`. `totalPages` is `ceil(totalItems / pageSize)`, and `0` when there are no items. Asking for a page past the end returns an empty `data` array. Results are ordered by the requested field and then by `id`, so rows never repeat or disappear between pages.

Filters live beside these in the same query string and are validated by the endpoint's own schema.

A list may add a `meta` object beside `data` and `pagination` for facts about the whole result rather than one row. `GET /notifications/me` does: `meta.unreadCount` counts every unread notification, not only those on the page.

```json
{
  "data": [ { "id": "…" } ],
  "pagination": { "page": 1, "pageSize": 10, "totalItems": 25, "totalPages": 3 },
  "meta": { "unreadCount": 4, "timeZone": "America/New_York" }
}
```

## 7. Rate limiting

Rate limiting uses a sliding window. It is distributed through Upstash Redis in production and in-process in development and test. Exceeding a limit returns `429 RATE_LIMITED` with a **`Retry-After`** header (whole seconds until the caller may retry).

Every named limit is defined in one map, `RATE_LIMITS` in `apps/server/src/lib/rate-limit/limits.ts`:

| Name             | Limit                | Keyed by            | Applies to                                                            |
| ---------------- | -------------------- | ------------------- | --------------------------------------------------------------------- |
| `global`         | 300 requests / 60 s  | client IP           | every request, before routing                                         |
| `login`          | 20 requests / 60 s   | client IP           | every `POST /auth/login`, successful or not                           |
| `loginFailures`  | 5 failures / 15 min  | client IP + email   | **failed** sign-ins; checked before the password is tried             |
| `register`       | 5 requests / 1 h     | client IP           | `POST /auth/register`                                                 |
| `google`         | 10 requests / 60 s   | client IP           | `POST /auth/google`                                                   |
| `forgotEmail`    | 3 requests / 1 h     | email address       | `POST /auth/password/forgot`, counted whether or not the account exists |
| `forgotIp`       | 10 requests / 1 h    | client IP           | `POST /auth/password/forgot`                                          |
| `reset`          | 10 requests / 1 h    | client IP           | `POST /auth/password/reset`                                           |
| `passwordChange` | 10 requests / 1 h    | signed-in user      | `POST /auth/password/change`                                          |
| `logout`         | 30 requests / 60 s   | client IP           | `POST /auth/logout`                                                   |
| `notificationsRead` | 120 requests / 60 s | signed-in user    | `GET /notifications/me` (the bell asks once a minute per open tab)    |
| `notificationsWrite` | 60 requests / 60 s | signed-in user    | `PATCH /notifications/:id/read`, `POST /notifications/me/read-all`    |
| `adminWrite`     | 60 requests / 60 s   | signed-in admin     | `PATCH /admin/settings`, every write under `/admin/services`, `/admin/requests`, `/admin/quotations` and `POST /admin/requests/:id/quotations`, `POST /admin/customers/:id/notes`, and every write under `/admin/technicians`, `POST /admin/quotations/:id/work-order`, `PATCH /admin/work-orders/:id/schedule` and `POST /admin/work-orders/:id/transitions` |
| `customerWrite`  | 30 requests / 60 s   | signed-in customer  | `PATCH /customers/me` and every write under `/customers/me/addresses` |
| `requestSubmit`  | 10 requests / 1 h    | signed-in customer  | `POST /requests`; a repeated submission counts too                    |
| `quotationDecision` | 20 requests / 1 h | signed-in customer  | `POST /quotations/:id/accept` and `/decline` together; a refused answer counts too |
| `invoicePdf`     | 30 requests / 1 h    | signed-in user      | `GET /invoices/:id/pdf` (a PDF is built on every request)             |
| `adminExport`    | 10 requests / 60 s   | signed-in admin     | `GET /admin/exports/*.csv` (an export reads a whole list)             |
| `demoWrite`      | 60 requests / 10 min | demo account + IP   | **only with `DEMO_MODE=true`:** every POST, PATCH, PUT or DELETE made with a session of one of the three shared demo accounts, counted in the auth middleware before the handler runs. Reads are not counted |
| `demoRegister`   | 3 requests / 1 h     | client IP           | **only with `DEMO_MODE=true`:** `POST /auth/register`, on top of `register` |

- **Counting failures only.** `loginFailures` uses two calls on the limiter: `peek` (is there allowance left? it counts nothing) before the password is checked, and `consume` only when the attempt fails. A person who signs in successfully many times is never locked out, and an attacker's guesses stop after five. The counter key holds a hash of the email, never the address, so Redis never stores one.
- **Same behaviour for unknown emails.** A failed attempt for an address with no account is counted exactly like one for a real account, and `forgotEmail` counts every submitted address, so neither a `429` nor its absence reveals whether an account exists.
- **Client IP** comes from Express, which honours `X-Forwarded-For` only as far as `TRUST_PROXY` allows. The default is no trust outside production, so clients cannot spoof their address.
- **Test and E2E environments** set `RATE_LIMIT_MULTIPLIER` (for example `1000`) so repeated runs are not throttled; tests that verify the `429` behaviour pass explicit low limits. The multiplier must be `1` in production.
- **If the limiter store fails** (for example Upstash is unreachable), the request is allowed and the failure is logged, so a Redis outage does not take the API down.

### Verifying the Upstash driver manually

The Upstash adapter is unit-tested against a mocked client only, because the test suites never hold live credentials. Verify it once against a real database:

1. Create a free Upstash Redis database and copy its **REST URL** and **REST token**.
2. In `apps/server/.env` set `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and, to make the limit easy to reach, `RATE_LIMIT_MULTIPLIER=0.01` (the global limit becomes 3 per minute). The driver defaults to `upstash` when both credentials are set.
3. Run `npm run dev:server` and send four requests within a minute:
   ```bash
   for i in 1 2 3 4; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/v1/health; done
   ```
   Expected: `200 200 200 429`. `curl -i` on the fourth shows `Retry-After` of about 60.
4. In the Upstash console's Data Browser, keys beginning `fixflow:ratelimit:global:` should exist. Stop the server, start it again within the minute and confirm the next request is still `429` (the counter lives in Redis, not in the process).
5. Remove `RATE_LIMIT_MULTIPLIER` again.

## 8. Security headers, CORS and limits

- **helmet** defaults are applied to every response (including errors): `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, and others. `X-Powered-By` is removed.
- **CORS** allows exactly one origin, `WEB_ORIGIN`, with credentials. A request from any other origin gets **no** `Access-Control-Allow-*` headers, so the browser blocks it. Requests without an `Origin` header (server-to-server, curl) are unaffected. In normal operation the browser uses the same-origin proxy, so CORS is defence in depth.
- **No caching, with one exception.** Every response carries `Cache-Control: no-store` and there is no `ETag`, so neither a browser nor an intermediary can reuse one person's response for another. The exception is `GET /settings/public`, which is the same for everyone and carries `public, max-age=60`.
- Logs never contain cookies, `Authorization` headers, `Set-Cookie` values, request bodies, query strings, or fields named `password`, `passwordConfirmation`, `newPassword`, `newPasswordConfirmation`, `currentPassword`, `credential`, `token` or `secret`. Email addresses are masked (`a***@example.test`) wherever they are logged or recorded for delivery.

## 9. Authentication, sessions and CSRF

**Two ways in, one kind of session.** A person signs in with a local email and password, or with Google. Either way the API creates a server-side session: a 32-byte random token goes to the browser in a cookie, and only its HMAC-SHA-256 hash (keyed with `SESSION_SECRET`) is stored in the `sessions` table, with the user, the expiry and the last-used time. The cookie never contains a role, a user ID or anything readable.

**The cookie**

| Attribute  | Value                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Name       | `__Host-fixflow_session` in production, `fixflow_session` elsewhere                              |
| `HttpOnly` | yes: scripts cannot read it                                                                      |
| `SameSite` | `Lax`: not sent on cross-site POSTs                                                              |
| `Path`     | `/`                                                                                              |
| `Secure`   | in production (required by the `__Host-` prefix)                                                 |
| `Domain`   | **never set**, so the cookie belongs to the exact host the browser reached (the web app's, behind the same-origin proxy) |
| `Max-Age`  | 7 days, re-issued when the session is renewed                                                    |

**Lifetime.** A session lasts 7 days. When it is used after more than an hour since its last renewal, the expiry moves out to 7 days from now and the response re-issues the cookie (rolling renewal, at most once an hour). Expired sessions are deleted when found and when the user signs in again. A session whose user has been deactivated is refused. Logout deletes the row and clears the cookie, and is idempotent.

**Guards.** `requireAuth` answers `401` without a valid session. `requireCustomer` adds `403` unless the caller is a customer with a customer record. `requireAdmin` adds `403` unless the stored role is `BUSINESS_ADMIN` **and** the email is still in `ADMIN_EMAILS`, re-checked on every request with no exemptions: removing an address and restarting revokes that admin's access immediately. The caller's identity (`req.auth`) comes from the session alone; a user, role or customer ID in a request is never trusted, and every body schema is strict. `assertCustomerOwns(resourceCustomerId, auth)` throws `404` for a record that is not the customer's own.

**CSRF defence.** For every method other than `GET`, `HEAD` and `OPTIONS`, the request's `Origin` header must equal `WEB_ORIGIN`; if there is no `Origin`, `Sec-Fetch-Site: same-origin` is accepted. Anything else is `403 CSRF_ORIGIN_MISMATCH`, answered before the body is read. A write that has a body must be `application/json` (otherwise `400 BAD_REQUEST`). Browsers add `Origin` themselves; scripts and tests send it explicitly.

**Admin accounts.** An account is an admin only if its email is in `ADMIN_EMAILS` when it is created: by Google sign-in with a verified allowlisted email, or by the seed. Registering an allowlisted address is refused with a deliberately vague `422`, and an existing customer is never promoted.

**Passwords.** Argon2id (`@node-rs/argon2`; 19 MiB, 2 passes, 1 lane). The policy is 10 to 128 characters, not the account's own email address, and not on a small bundled list of common passwords (compared ignoring case, spaces and punctuation, so `Password123!` is refused). No composition rules.

## Route index

Every route, with who may call it and the named rate limit that guards it (the `global` limit of 300 requests a minute per IP address applies to all of them). Access classes: **Public** needs no session; **Signed in** needs any session (ownership is checked per record, so another person's record is a `404`); **Customer** is `403` for an admin; **Business admin** is `403` for a customer and requires the email to be on the admin allowlist.

| Method and path | Access | Rate limit |
| --- | --- | --- |
| **System** | | |
| `GET /health` | Public | global only |
| `GET /health/ready` | Public | global only |
| **Authentication** | | |
| `POST /auth/register` | Public | `register` |
| `POST /auth/login` | Public | `login` |
| `POST /auth/google` | Public | `google` |
| `POST /auth/password/forgot` | Public | `forgotIp` |
| `POST /auth/password/reset` | Public | `reset` |
| `POST /auth/logout` | Public | `logout` |
| `GET /auth/me` | Signed in (any role) | global only |
| `POST /auth/password/change` | Signed in (any role) | `passwordChange` |
| **Notifications** | | |
| `GET /notifications/me` | Signed in (any role) | `notificationsRead` |
| `POST /notifications/me/read-all` | Signed in (any role) | `notificationsWrite` |
| `PATCH /notifications/:id/read` | Signed in (any role) | `notificationsWrite` |
| **Business settings and the service catalogue** | | |
| `GET /settings/public` | Public | global only |
| `GET /services` | Public | global only |
| `GET /services/slug/:slug` | Public | global only |
| `GET /services/:id` | Public | global only |
| `GET /admin/settings` | Business admin | global only |
| `PATCH /admin/settings` | Business admin | `adminWrite` |
| `GET /admin/services` | Business admin | global only |
| `GET /admin/services/:id` | Business admin | global only |
| `POST /admin/services` | Business admin | `adminWrite` |
| `PATCH /admin/services/:id` | Business admin | `adminWrite` |
| `POST /admin/services/:id/archive` | Business admin | `adminWrite` |
| `POST /admin/services/:id/restore` | Business admin | `adminWrite` |
| **Customer profile and addresses** | | |
| `GET /customers/me` | Customer | global only |
| `GET /customers/me/overview` | Customer | global only |
| `PATCH /customers/me` | Customer | `customerWrite` |
| `GET /customers/me/addresses` | Customer | global only |
| `POST /customers/me/addresses` | Customer | `customerWrite` |
| `PATCH /customers/me/addresses/:id` | Customer | `customerWrite` |
| `DELETE /customers/me/addresses/:id` | Customer | `customerWrite` |
| `POST /customers/me/addresses/:id/default` | Customer | `customerWrite` |
| **Service requests** | | |
| `GET /requests/:id` | Signed in (any role) | global only |
| `POST /requests` | Customer | `requestSubmit` |
| `GET /requests/me` | Customer | global only |
| `GET /admin/requests` | Business admin | global only |
| `GET /admin/requests/:id` | Business admin | global only |
| `PATCH /admin/requests/:id/status` | Business admin | `adminWrite` |
| `POST /admin/requests/:id/notes` | Business admin | `adminWrite` |
| `GET /admin/exports/requests.csv` | Business admin | `adminExport` |
| **Customers (business)** | | |
| `GET /admin/customers` | Business admin | global only |
| `GET /admin/customers/:id` | Business admin | global only |
| `GET /admin/customers/:id/history` | Business admin | global only |
| `POST /admin/customers/:id/notes` | Business admin | `adminWrite` |
| **Quotations** | | |
| `GET /quotations/:id` | Signed in (any role) | global only |
| `GET /quotations/me` | Customer | global only |
| `POST /quotations/:id/accept` | Customer | `quotationDecision` |
| `POST /quotations/:id/decline` | Customer | `quotationDecision` |
| `POST /admin/requests/:id/quotations` | Business admin | `adminWrite` |
| `GET /admin/quotations/:id` | Business admin | global only |
| `PATCH /admin/quotations/:id` | Business admin | `adminWrite` |
| `POST /admin/quotations/:id/send` | Business admin | `adminWrite` |
| `POST /admin/quotations/:id/void` | Business admin | `adminWrite` |
| **Technicians** | | |
| `GET /admin/technicians` | Business admin | global only |
| `GET /admin/technicians/assignable` | Business admin | global only |
| `GET /admin/technicians/:id` | Business admin | global only |
| `POST /admin/technicians` | Business admin | `adminWrite` |
| `PATCH /admin/technicians/:id` | Business admin | `adminWrite` |
| `POST /admin/technicians/:id/deactivate` | Business admin | `adminWrite` |
| `POST /admin/technicians/:id/activate` | Business admin | `adminWrite` |
| **Work orders, scheduling and the calendar** | | |
| `GET /work-orders/:id` | Signed in (any role) | global only |
| `GET /work-orders/me` | Customer | global only |
| `GET /admin/calendar` | Business admin | global only |
| `POST /admin/quotations/:id/work-order` | Business admin | `adminWrite` |
| `GET /admin/work-orders` | Business admin | global only |
| `GET /admin/work-orders/conflicts` | Business admin | global only |
| `GET /admin/work-orders/:id` | Business admin | global only |
| `PATCH /admin/work-orders/:id/schedule` | Business admin | `adminWrite` |
| `POST /admin/work-orders/:id/transitions` | Business admin | `adminWrite` |
| **Invoices and payments** | | |
| `GET /invoices/:id` | Signed in (any role) | global only |
| `GET /invoices/:id/pdf` | Signed in (any role) | `invoicePdf` |
| `GET /invoices/me` | Customer | global only |
| `GET /admin/exports/invoices.csv` | Business admin | `adminExport` |
| `POST /admin/work-orders/:id/invoice` | Business admin | `adminWrite` |
| `GET /admin/invoices` | Business admin | global only |
| `GET /admin/invoices/:id` | Business admin | global only |
| `PATCH /admin/invoices/:id` | Business admin | `adminWrite` |
| `POST /admin/invoices/:id/issue` | Business admin | `adminWrite` |
| `POST /admin/invoices/:id/void` | Business admin | `adminWrite` |
| `POST /admin/invoices/:id/payments` | Business admin | `adminWrite` |
| `POST /admin/invoices/:id/payments/:paymentId/void` | Business admin | `adminWrite` |
| **Dashboard and exports** | | |
| `GET /admin/dashboard/summary` | Business admin | global only |
| `GET /admin/exports/jobs.csv` | Business admin | `adminExport` |

## Endpoint reference

Each entry lists method and path, authentication and role, request schema, response, and the errors it can return. Authentication, sessions and CSRF are described in [section 9](#9-authentication-sessions-and-csrf); every write below also needs a matching `Origin`.

### System

#### `GET /api/v1/health`

Liveness check. It never touches a database or any other dependency, so the hosting platform's health check does not wake the database.

- **Auth:** none
- **Response `200`:** `{ "data": { "status": "ok" } }`

#### `GET /api/v1/health/ready`

Readiness check, for diagnostics. It runs `SELECT 1` against the database with a 3 s timeout. Do not point a platform health check at it: that would keep Neon's compute awake.

- **Auth:** none
- **Response `200`:** `{ "data": { "status": "ready" } }`
- **Response `503`:** the standard error body with `code: "SERVICE_UNAVAILABLE"` and `details: { "database": "unreachable" }`. It covers a refused connection, a timeout and a server started without `DATABASE_URL`. The driver's own message is logged, never returned.

### Authentication

All bodies are strict JSON objects. Emails are trimmed and lower-cased. In every example `user` is `{ id, name, email, avatarUrl, role, hasPassword, hasGoogle }`; it never contains a hash or a Google subject.

#### `POST /api/v1/auth/register`

Creates a customer and signs them in.

- **Auth:** none. **Limit:** `register`.
- **Body:** `{ name, email, password, passwordConfirmation, acceptTerms }`. `acceptTerms` must be `true`; the passwords must match and meet the policy.
- **`201`:** `{ "data": { "user" } }` and the session cookie. The account has a customer profile and a `termsAcceptedAt` timestamp.
- **Errors:** `403 SIGNUP_DISABLED` (checked before the body), `422` (invalid values, an unknown key such as `role`, or an allowlisted email: "This email can't be registered here…"), `409 EMAIL_TAKEN` ("An account already exists for this email — sign in or reset your password."), `429`.
- Registration may tell a visitor that an email is taken. That is a documented usability trade-off, and the endpoint is rate-limited.

#### `POST /api/v1/auth/login`

- **Auth:** none. **Limits:** `login`, `loginFailures`.
- **Body:** `{ email, password }`.
- **`200`:** `{ "data": { "user" } }` and the session cookie. Records `lastSignInAt`. A browser that already had a session has it replaced.
- **Errors:** `401 INVALID_CREDENTIALS` for an unknown email, a wrong password **and** a Google-only account, with one identical body ("Email or password is incorrect. If you signed up with Google, use Continue with Google, or reset your password."). Each of the three also spends the same time on a password check (a dummy hash when there is nothing to compare against). `403 ACCOUNT_DISABLED` only after a correct password. `429` after five failures for the same IP + email in 15 minutes, even if the next password is right.

#### `POST /api/v1/auth/google`

- **Auth:** none. **Limit:** `google`.
- **Body:** `{ credential }`, the ID token from Google Identity Services. The API verifies the signature, the audience (`GOOGLE_CLIENT_ID`), the issuer and the expiry, and requires a verified email.
- **`200`:** `{ "data": { "user", "isNewUser" } }` and the session cookie.
- **Account resolution:** found by Google subject; otherwise linked to the account with the same normalized email; otherwise created. A link to a local account whose email was never verified **clears its password and revokes all its sessions** and marks the email verified (this closes the account pre-hijacking attack): Google has just proved who owns the address. A link to a verified account keeps its password. A new account is an admin only if its email is allowlisted, otherwise a customer with a profile (and subject to `PUBLIC_SIGNUP_ENABLED`).
- **Errors:** `401 INVALID_GOOGLE_CREDENTIAL`, `403 GOOGLE_EMAIL_NOT_VERIFIED`, `403 ACCOUNT_DISABLED`, `403 SIGNUP_DISABLED`, `409 CONFLICT` (the email belongs to a different Google identity), `503 GOOGLE_SIGN_IN_UNAVAILABLE`, `429`. The credential is never logged.

#### `POST /api/v1/auth/password/forgot`

- **Auth:** none. **Limits:** `forgotIp`, `forgotEmail`.
- **Body:** `{ email }`.
- **`200`:** always `{ "data": { "message": "If an account exists for that email, we've sent a reset link. It works for 60 minutes." } }`, identical whether or not the account exists.
- For an existing, active account it removes older unused links, stores a new single-use token (32 random bytes, HMAC-hashed, valid 60 minutes) and sends the link `${PUBLIC_WEB_URL}/reset-password?token=…` in the background, after the response is on its way, through the email dispatcher. A failed delivery is recorded in `email_delivery_logs` and never changes the answer.
- **Errors:** `403 DEMO_ACCOUNT_LOCKED` for the shared demo accounts while `DEMO_MODE` is on (their addresses are published, so naming them reveals nothing); `503 PASSWORD_RESET_UNAVAILABLE` in production with no SMTP configured (no token is created); `429`.

#### `POST /api/v1/auth/password/reset`

- **Auth:** none (the token is the proof). **Limit:** `reset`.
- **Body:** `{ token, password, passwordConfirmation }`.
- **`200`:** `{ "data": { "passwordReset": true } }` and the session cookie is cleared. The password is replaced, the email is marked verified, the token is spent and **every** session of the account is revoked; the person signs in again. A Google-only account can use this to add a password.
- **Errors:** `400 INVALID_RESET_TOKEN` for an unknown, expired or used token (one identical body). `422` for a weak or mismatched password, **without** spending the token. `429`.

#### `POST /api/v1/auth/password/change`

- **Auth:** any signed-in user. **Limit:** `passwordChange`.
- **Body:** `{ currentPassword, newPassword, newPasswordConfirmation }`.
- **`200`:** `{ "data": { "passwordChanged": true } }`. The user's **other** sessions are revoked; this one stays.
- **Errors:** `401`, `422 INVALID_CURRENT_PASSWORD` (with `fieldErrors.currentPassword`), `422` for a weak or mismatched new password, `409 PASSWORD_NOT_SET` for a Google-only account (use the reset flow to add a password), `403 DEMO_ACCOUNT_LOCKED` for a shared demo account in demo mode, `429`.

#### `POST /api/v1/auth/logout`

- **Auth:** none needed. **Limit:** `logout`.
- **`200`:** `{ "data": { "signedOut": true } }`. Deletes the session behind the cookie (if any) and clears the cookie. Safe to repeat.

#### `GET /api/v1/auth/me`

- **Auth:** any signed-in user.
- **`200`:** `{ "data": { "user", "customer"? } }`, where `customer` is `{ id, phone }` and only present for a customer.
- **Query:** `refresh=1` re-issues the session cookie with the expiry the session has now (`Max-Age` = what is left of it). The web app's keep-alive sends it from the browser, at most every 30 minutes: a page load's own server-side call may already have renewed the session, and that answer's cookie never reached the browser. Any other value, or none, sends no cookie unless this very request renewed the session.
- **Errors:** `401` with no cookie, a forged or tampered cookie, or an expired session (a stale cookie is also cleared). `403 FORBIDDEN` for an administrator whose email is no longer in `ADMIN_EMAILS`: the session is valid but the account has no access, and the web app shows a "no access" page.

### Notifications

In-app notifications. A notification belongs to **exactly one** user; every endpoint works on the caller's own, found through the session, so there is no way to name another user's. Customers and allowlisted admins may use them; an administrator removed from `ADMIN_EMAILS` gets `403`, like everywhere else. Notifications are created by the workflow tasks inside the transaction of the change they announce (`notify` and `notifyAdmins` in `modules/notifications`); there is no endpoint to create one.

A notification is `{ id, type, title, message, linkPath, readAt, createdAt }`. `type` is a `NotificationType` from `@fixflow/shared`. `linkPath` is a relative path into the signed-in app, always `/app/...` or `/portal/...`: the server refuses to store an absolute URL, a protocol-relative URL or a script URL, and the web app checks again before it links. `readAt` is `null` until it is read. The record it is about and the recipient are not returned.

#### `GET /api/v1/notifications/me`

- **Auth:** any signed-in customer or allowlisted admin. **Limit:** `notificationsRead`.
- **Query:** `unreadOnly` (`true` or `false`, default `false`), `page`, `pageSize` (default 20, at most 100). Newest first. `sort` and `order` are accepted for consistency, but only `createdAt` can be sorted.
- **`200`:** `{ "data": [notification, …], "pagination": { page, pageSize, totalItems, totalPages }, "meta": { "unreadCount", "timeZone" } }`. `unreadCount` counts all of the caller's unread notifications, whatever the page or the `unreadOnly` filter. `timeZone` is the business time zone (IANA) from the settings, so times can be shown in it; it is `UTC` only if the settings are missing. The bell polls this endpoint with `pageSize=1` once a minute while the tab is visible, which is why the count travels in `meta`.
- **Errors:** `401`, `403`, `422` (bad `page`, `pageSize`, `unreadOnly` or `sort`), `429`.

#### `PATCH /api/v1/notifications/:id/read`

- **Auth:** the recipient. **Limit:** `notificationsWrite`. No body.
- **`200`:** `{ "data": notification }` with `readAt` set. **Idempotent:** marking a notification that is already read changes nothing and keeps the first `readAt`.
- **Errors:** `404 NOT_FOUND` for a notification that does not exist **and** for one that belongs to someone else, with identical bodies, and the other person's notification is left untouched; `422` for an `id` that is not a UUID; `401`; `403`; `429`.

#### `POST /api/v1/notifications/me/read-all`

- **Auth:** any signed-in customer or allowlisted admin. **Limit:** `notificationsWrite`. No body.
- **`200`:** `{ "data": { "updated": 3 } }`, the number of the caller's notifications this call changed (`0` when everything was already read). Only the caller's own notifications are touched, and ones already read keep their `readAt`.

### Business settings

One business, one settings record: there is no id in any path or body. Two shapes exist on purpose: the **public** one holds only what a visitor to the website may read, the **admin** one holds everything the business configures. Neither carries the row id or `updatedByUserId`.

#### `GET /api/v1/settings/public`

- **Auth:** none. The only API response that is cacheable: `Cache-Control: public, max-age=60`, so an edit shows up on the website within a minute.
- **`200`:** `{ "data": { businessName, tagline, logoKey, logoUrl, contactEmail, phone, address: { line1, line2, city, region, postalCode }, serviceAreaDescription, currencyCode, timeZone } }`. Nothing else: no tax rate, terms, payment instructions or editor. At most one of `logoKey` (a bundled logo) and `logoUrl` (an `https://` address) is set.
- **Errors:** `503 SERVICE_UNAVAILABLE` if the settings row has not been created (the seed creates it).

#### `GET /api/v1/admin/settings`

- **Auth:** business admin on the allowlist.
- **`200`:** `{ "data": AdminSettingsDto }`: every editable field, flat (`addressLine1`, `addressLine2`, …), plus `identityLocked` (a boolean worked out from the caller: `true` only for the shared demo admin while `DEMO_MODE` is on, see below), plus `defaultTaxRate` (a **decimal string**, `"8.00"`), `quotationValidityDays`, `invoiceDueDays`, `defaultQuotationTerms`, `paymentInstructions`, `invoiceFooter` and `updatedAt` (ISO 8601 UTC).
- **Errors:** `401`, `403`.

#### `PATCH /api/v1/admin/settings`

- **Auth:** business admin on the allowlist. **Limit:** `adminWrite`. **Body:** any non-empty subset of the fields below. The body is strict: an unknown key (`id`, `updatedByUserId`) is `422`. A text field sent as `null` or blank is cleared; the required fields cannot be cleared.
- **Rules** (each failure is a `fieldErrors` entry, all reported at once):

  | Field | Rule |
  | ----- | ---- |
  | `businessName` | required, 2–100 characters, one line |
  | `tagline` | optional, ≤ 160, one line |
  | `logoKey` | optional; one of the bundled logos (`BUNDLED_LOGOS` in `@fixflow/shared`) |
  | `logoUrl` | optional; `https://` only, with a host, no credentials or whitespace, ≤ 500 |
  | `logoKey` and `logoUrl` | not both: `422` on `logoUrl`, judged on what **would be stored**, so sending one while the other is already set also fails (send the other as `null`) |
  | `contactEmail` | valid address, trimmed and lower-cased |
  | `phone` | optional leading `+`, digits with spaces, dots, hyphens and brackets; 7–15 digits; ≤ 30 characters |
  | `addressLine1`, `city`, `postalCode` | required; ≤ 120, ≤ 80, ≤ 20; the postal code is letters, digits, spaces and hyphens |
  | `addressLine2`, `region`, `serviceAreaDescription` | optional; ≤ 120, ≤ 80, ≤ 500 |
  | `currencyCode` | ISO 4217 from the **two-decimal allowlist** (`SUPPORTED_CURRENCIES`); case-insensitive on input, stored upper-case. JPY, KWD and the like are refused |
  | `timeZone` | an IANA name from `Intl.supportedValuesOf("timeZone")`, plus `UTC` |
  | `defaultTaxRate` | a **string**, 0–100 with at most two decimals (`"8"`, `"8.25"`); stored and returned with two (`"8.00"`). A JSON number is refused: money-like values are never floats |
  | `quotationValidityDays` | whole number, 1–90 |
  | `invoiceDueDays` | whole number, 0–90 |
  | `defaultQuotationTerms`, `paymentInstructions`, `invoiceFooter` | optional; ≤ 2000, ≤ 1000, ≤ 500; may span lines |

- **`200`:** `{ "data": AdminSettingsDto }`, the settings after the change. Only fields whose value really differs are written; a body that changes nothing is `200` with no write, no new `updatedAt` and no activity event. The new values show on `/settings/public` at once (a browser may keep the old public response for up to a minute).
- **Activity:** one `SETTINGS` event, `settings.updated`, staff-only, with `metadata.changedFields` listing the field **names** in form order. Values never appear in the history.
- **The public demo.** For the shared demo admin (`admin@demo.fixflow.test`) while `DEMO_MODE=true`, a body that would **change** one of the identity fields (`businessName`, `tagline`, `logoKey`, `logoUrl`, `contactEmail`, `phone`, `addressLine1`, `addressLine2`, `city`, `region`, `postalCode`, `serviceAreaDescription`; `IDENTITY_SETTINGS_FIELDS` in `@fixflow/shared`) is refused whole with `403 DEMO_ACCOUNT_LOCKED`, `fieldErrors` naming each locked field, and nothing written. Repeating a stored value is not a change. Every other field stays editable. Any other admin, such as the owner's own, is never locked.
- **Errors:** `401`, `403` (`FORBIDDEN`, or `DEMO_ACCOUNT_LOCKED` as above), `422` (with `fieldErrors`), `429`. The change and its event are one transaction.
- **Existing documents:** a change of currency, time zone, tax rate or terms applies to **new** quotations and invoices only; existing ones keep their snapshots (the settings form says so).

### Service catalogue

A service is **active** (shown on the website, can be requested) when it is published and not archived. `status` is derived from `isPublished` and `archivedAt`: `PUBLISHED`, `UNPUBLISHED` or `ARCHIVED` (an archived service is never published). Allowed moves: publish `UNPUBLISHED → PUBLISHED`; unpublish `PUBLISHED → UNPUBLISHED`; archive from either live state (also unpublishes); restore `ARCHIVED → UNPUBLISHED` (a restored service stays off the website until it is published again). Anything else is `409 INVALID_STATE_TRANSITION` with `details: { currentStatus, action }`.

**Public DTO** (`PublicServiceDto`): `id, name, slug, category, shortDescription, fullDescription, inclusions[], estimatedDurationMinutes, pricingMode, startingPrice, currencyCode, imageKey, imageUrl`. `startingPrice` is a decimal string (`"129.00"`) for `FIXED` and `null` for `QUOTE_REQUIRED`; `currencyCode` is the business currency. No lifecycle, display order or dates.

**Admin DTO** (`AdminServiceDto`): the public fields plus `sortOrder, isPublished, archivedAt, status, isActive, availableActions[], createdAt, updatedAt`. `availableActions` lists what the current state allows (`EDIT`, `PUBLISH`, `UNPUBLISH`, `ARCHIVE`, `RESTORE`); the UI renders only those and the server re-checks every one.

#### `GET /api/v1/services`

- **Auth:** none. **Query:** `category` (optional, matched ignoring case). **Not paginated** (a small catalogue). Ordered by `sortOrder`, then `name`.
- **`200`:** `{ "data": [PublicServiceDto, …] }`: **active services only**. Unpublished and archived ones are absent, even for a signed-in admin (the admin sees them through `/admin/services`). `Cache-Control: no-store`: a service unpublished a second ago must not still be offered.
- **Errors:** `422` for a `category` over 50 characters.

#### `GET /api/v1/services/slug/:slug` and `GET /api/v1/services/:id`

- **Auth:** none. **`200`:** `{ "data": PublicServiceDto }` for an active service.
- **Errors:** `404 NOT_FOUND` ("That service is not available.") for a missing, unpublished or archived service, with one identical body; `422` for a malformed slug or a non-UUID id.

#### `GET /api/v1/admin/services`

- **Auth:** business admin. **Query:** `status` (`published`, `unpublished` or `archived`; omit for all), `search` (≤ 100 characters; matched ignoring case against name, category, slug and short description; `%` and `_` are plain characters), `page`, `pageSize`, `sort` (`sortOrder` default, `name`, `category`, `updatedAt`), `order` (`asc` default).
- **`200`:** `{ "data": [AdminServiceDto, …], "pagination": {…}, "meta": { "counts": { all, published, unpublished, archived }, "currencyCode" } }`. The counts ignore `status` and `search`, so every tab can show how many it holds.
- **Errors:** `401`, `403`, `422`.

#### `GET /api/v1/admin/services/:id`

- **`200`:** `{ "data": AdminServiceDto }` whatever the state. **Errors:** `401`, `403`, `404`, `422` (id not a UUID).

#### `POST /api/v1/admin/services`

- **Auth:** business admin. **Limit:** `adminWrite`. **Body** (strict): `name` (3–80), `slug?` (lower-case words joined by single hyphens, ≤ 80), `category` (2–50), `shortDescription` (10–200), `fullDescription` (20–2000), `inclusions?` (0–12 items of 1–120 characters each, default `[]`), `estimatedDurationMinutes?` (whole minutes 5–720 or `null`), `pricingMode` (`FIXED` or `QUOTE_REQUIRED`), `startingPrice?` (decimal **string**, 0.01–999,999.99, two decimals; stored as `"129.00"`), `imageKey?` (a bundled picture, `BUNDLED_SERVICE_IMAGES`), `imageUrl?` (`https://` address), `sortOrder?` (0–9999, default 0), `isPublished?` (default `false`).
- **Rules:** `FIXED` **requires** `startingPrice` (`422` on `startingPrice`); `QUOTE_REQUIRED` must not have one; `imageKey` and `imageUrl` are exclusive. Without `slug` one is made from the name (`ac-repair`, then `ac-repair-2` when taken). A typed slug that another service already uses, **archived ones included**, is `409 SLUG_TAKEN` with `fieldErrors.slug`.
- **`201`:** `{ "data": AdminServiceDto }`. Activity: `service.created`.

#### `PATCH /api/v1/admin/services/:id`

- **Auth:** business admin. **Limit:** `adminWrite`. **Body** (strict): any non-empty subset of the create fields, plus `isPublished` (publish or unpublish through the lifecycle rules) and `expectedStatus` (`PUBLISHED`, `UNPUBLISHED` or `ARCHIVED`: the state the caller loaded; a different current state is `409 STALE_STATE` with `details.currentStatus` and nothing changes).
- **Rules:** validated on the values that would be stored. Making a service `FIXED` needs a price; switching it to `QUOTE_REQUIRED` **clears** the price (sending a price with it is `422`). `isPublished: true` on an archived service is `409 INVALID_STATE_TRANSITION`, and the whole request is refused. Asking for what already is (`isPublished: true` on a published service, a value equal to the stored one) is not an error: nothing is written and nothing is recorded. Archived services can still be edited. A slug that another service uses is `409 SLUG_TAKEN`. The write is conditional on the lifecycle state it read, so of two simultaneous opposite changes exactly one wins and the other is `409 STALE_STATE`.
- **`200`:** `{ "data": AdminServiceDto }`. Activity: `service.updated` (`metadata.changedFields`, names only) and/or `service.published` / `service.unpublished`.

#### `POST /api/v1/admin/services/:id/archive` and `/restore`

- **Auth:** business admin. **Limit:** `adminWrite`. **Body:** `{ "expectedStatus": "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED" }`, required, nothing else.
- **`200`:** `{ "data": AdminServiceDto }`. Archiving hides the service from the website and from new requests and **leaves existing requests untouched**; restoring brings it back unpublished. Activity: `service.archived` / `service.restored`, with `fromStatus` and `toStatus`.
- **Errors:** `404`, `409 STALE_STATE` (the state is not `expectedStatus`), `409 INVALID_STATE_TRANSITION` (archive twice, restore what is not archived), `422`.

All service activity events are staff-only (`entityType: SERVICE`, no customer summary) and carry names and flags in `metadata`, never the service's text.

### Customer profile and service addresses

The signed-in customer's own details and saved addresses. Every endpoint works on the caller's **own** records, found through the session: the customer is never named in a path, query or body, so there is no way to reach another customer's. An **admin has no customer profile**, so every endpoint answers an admin `403 FORBIDDEN`; the admin's view of customers is a separate set of endpoints with its own serializer.

A **service address** is `{ id, label, line1, line2, city, region, postalCode, accessNotes, isDefault, createdAt, updatedAt }`. `line2`, `region` and `accessNotes` are `null` when empty. Access notes ("Gate code, parking, pets…") are shown only to the owner and to the business team, and are never written to a log, an activity event or a notification. The owner's id is not returned.

The **profile** is `{ name, email, phone, avatarUrl, hasPassword, hasGoogle, passwordChangeLocked, addresses }`, with the addresses default first and then in the order they were saved. `email` is shown but cannot be changed. `hasPassword` and `hasGoogle` replace the password hash and the Google subject, which never leave the server. `passwordChangeLocked` is true only for the shared demo accounts while `DEMO_MODE` is on, so the web app can say so instead of offering a form that would be refused.

**Addresses.**

- A customer has **at most 10** (`LIMITS.address.maxPerCustomer`).
- The **first** address becomes the default automatically. `isDefault` cannot be sent: it is changed only by `POST …/default`.
- There is **exactly one default whenever there is at least one address.** The database allows at most one (a partial unique index, `service_addresses_one_default_per_customer_key`); the service guarantees the rest. Every change to a customer's addresses runs in one transaction that first locks the customer's row, so simultaneous requests (a double click, two tabs) are applied one after the other: the limit cannot be passed, and a default can neither be duplicated nor lost.
- **Deleting** is allowed even when requests used the address, because a request keeps its own copy of the address and its notes; the database clears the request's link to the saved address (`ON DELETE SET NULL`). **Editing** a saved address never changes a past request either.
- When the **default is deleted**, the remaining address that was changed most recently becomes the default (ties go to the larger id). Choosing a default counts as a change to the two addresses involved.
- Text is trimmed. Optional fields (`line2`, `region`, `accessNotes`) are cleared by sending `null` or blank text; required fields can never be cleared.

| Field | Rule |
| --- | --- |
| `label` | required, 2 to 40 characters ("Home", "Rental unit") |
| `line1` | required, up to 120 characters |
| `line2` | optional, up to 120 characters |
| `city` | required, up to 80 characters |
| `region` | optional, up to 80 characters |
| `postalCode` | required, up to 20 characters: letters, digits, spaces and hyphens |
| `accessNotes` | optional, up to 500 characters, may span several lines |

Single-line fields refuse line breaks and control characters. Every body is **strict**: an unknown key, including `isDefault`, `customerId`, `id`, `role` and `email`, is a `422` and nothing is stored.

#### `GET /api/v1/customers/me`

- **Auth:** customer. No limit beyond the global one.
- **`200`:** `{ "data": profile }`.
- **Errors:** `401`, `403` (an admin).

#### `PATCH /api/v1/customers/me`

- **Auth:** customer. **Limit:** `customerWrite`.
- **Body (strict, at least one of):** `name` (2 to 100 characters, trimmed) and `phone`. A phone number is optional: digits, spaces and `+ - ( )`, **7 to 20 characters** once tidied, with 7 to 15 digits and a `+` only at the start. Spaces are trimmed and runs of spaces collapsed before it is stored (`"  (212)  555-0142 "` becomes `"(212) 555-0142"`); `null` or blank clears it. The name and the phone number are written in one transaction.
- **`200`:** `{ "data": profile }`.
- **Errors:** `422` with `fieldErrors` for a bad value, an empty body, or **any other key**: `role`, `email`, `userId`, `customerId`, `isActive`, `passwordHash`… are refused and the **valid fields in the same request are not applied either**; `401`; `403`; `429`.

#### `GET /api/v1/customers/me/addresses`

- **Auth:** customer.
- **`200`:** `{ "data": [address, …] }`, default first.

#### `POST /api/v1/customers/me/addresses`

- **Auth:** customer. **Limit:** `customerWrite`.
- **Body (strict):** `label`, `line1`, `city`, `postalCode` (required); `line2`, `region`, `accessNotes` (optional).
- **`201`:** `{ "data": address }`; `isDefault` is `true` for the customer's first address and `false` after that.
- **Errors:** `409 ADDRESS_LIMIT_REACHED` when the customer already has 10, `422`, `401`, `403`, `429`.

#### `PATCH /api/v1/customers/me/addresses/:id`

- **Auth:** the owner. **Limit:** `customerWrite`.
- **Body (strict, at least one of):** any of the address fields above. `isDefault` is not accepted.
- **`200`:** `{ "data": address }`.
- **Errors:** `404 NOT_FOUND` for an address that does not exist **and** for one that belongs to another customer, with identical bodies, leaving the other customer's address untouched; `422`, including an `id` that is not a UUID; `401`; `403`; `429`.

#### `DELETE /api/v1/customers/me/addresses/:id`

- **Auth:** the owner. **Limit:** `customerWrite`.
- **`200`:** `{ "data": { "id": "…" } }`. If it was the default and others remain, the most recently changed one is now the default (see above).
- **Errors:** `404`, `422`, `401`, `403`, `429`, as for `PATCH`.

#### `POST /api/v1/customers/me/addresses/:id/default`

- **Auth:** the owner. **Limit:** `customerWrite`. No body.
- **`200`:** `{ "data": address }` with `isDefault: true`. The previous default is cleared in the same transaction. Choosing the address that is already the default changes nothing.
- **Errors:** `404`, `422`, `401`, `403`, `429`, as for `PATCH`.

### Service requests

A customer's service requests. The shapes below are the **customer's**; the staff view of a request (queue, internal notes, status changes) is a different set of endpoints and serializers, described under "Admin service requests". The owner of a request is always the session's customer: no body, path or query can name another.

A **request** as the customer sees it (`CustomerRequestDto`) is:

| Field | Meaning |
| --- | --- |
| `id`, `reference` | The id is the key. The reference (`FF-YYYY-NNNNN`) is a label to read out and **never** a way in. |
| `status`, `statusLabel`, `nextStep` | The status, its customer-facing name, and what happens next ("We're reviewing your request and will send a quotation."). The words come from `@fixflow/shared` (`REQUEST_STATUS_LABELS`, `REQUEST_NEXT_STEPS`). |
| `serviceName` | The service's name **when the request was made**; renaming the service later does not change it. |
| `description` | The problem, as typed (trimmed, line breaks kept). |
| `address` | `{ line1, line2, city, region, postalCode, accessNotes }`: a **copy** taken at submission. Editing or deleting the saved address later does not change it. |
| `preferredDate`, `preferredWindow` | `YYYY-MM-DD` and `MORNING`, `AFTERNOON` or `EVENING`. |
| `preferredStart`, `preferredEnd` | The window as UTC instants, worked out on the **business's** calendar and clock for that day: 08:00-12:00, 12:00-16:00 and 16:00-19:00 local time. The offset is looked up for the day itself, so a change of the clocks (`2026-03-08`, `2026-11-01` in New York) cannot move a window by an hour. |
| `submittedAt` | When it was submitted (the server's clock). |
| `cancellation` | `null` unless the request was cancelled; then `{ cancelledAt, message }`, where `message` is what the business chose to tell the customer, or `null` when it wrote none. The internal reason, who cancelled and any other internals are **never** here. |
| `quotations` | The quotations the customer was **sent** for this request, newest sent first, so the first is the current one: `[{ id, reference, status, statusLabel, totalAmount, currencyCode, validUntil, sentAt, respondedAt, replacedBy }]`. `status` is the *effective* one (a sent quotation past its last day reads `EXPIRED`). `replacedBy` is `{ id, reference }` or `null`, and is set only once the replacement was sent to the customer. A draft, and a quotation voided before it was sent, are never in the list; there is no void reason, staff name or timeline. |
| `notes` | `[{ id, body, author, createdAt }]`: only notes the business marked `CUSTOMER_VISIBLE`. `author` is `"You"` or the business name, never a staff member's name. |
| `timeline` | `[{ id, publicSummary, toStatus, actor, createdAt }]` from the customer timeline: only events with a customer-facing summary that belong to this customer. |

A request in the **list** has the first nine fields only (no description, address, instants, notes or timeline).

Never in a customer response: internal notes, internal activity events or summaries, activity metadata, staff names or user ids, the customer's own ids, the service id, `submissionKey`, or cancellation internals (the reason, who cancelled). The serializer is a field-by-field allowlist over a column-by-column `select`, with a test that inserts an `INTERNAL` note and an internal-only event and asserts that neither appears.

#### `POST /api/v1/requests`

- **Auth:** customer (an admin gets `403 FORBIDDEN` and nothing is created). **Limit:** `requestSubmit` (10 per hour per customer).
- **Body (strict):**

  | Field | Rule |
  | --- | --- |
  | `serviceId` | required UUID of an **active** service (published and not archived) |
  | `description` | required, trimmed, 20 to 2000 characters, line breaks allowed |
  | `serviceAddressId` **or** `newAddress` | exactly one. `serviceAddressId` is one of the caller's saved addresses. `newAddress` is `{ label?, line1, line2?, city, region?, postalCode, accessNotes? }` with the same limits as a saved address |
  | `saveAddressToProfile` | only with `newAddress`; `true` also saves it to the caller's profile, and then `newAddress.label` (2 to 40 characters) is required |
  | `preferredDate` | required `YYYY-MM-DD`, from **tomorrow** to **90 days from today** on the business's calendar (the server's injected clock) |
  | `preferredWindow` | required: `MORNING`, `AFTERNOON` or `EVENING` |
  | `submissionKey` | required UUID, made once per form session |

  The owner, reference, status, snapshots, times and `submittedAt` are the server's: sending `customerId`, `status`, `reference`, `preferredStart`, `submittedAt` or any other key is a `422` (`"Unknown field."`) and nothing is created.
- **What one call does, in one transaction** (`runInTransaction`): locks the customer's row; returns the existing request if the key was already used; checks the service, the address and the date; optionally saves the address (it counts towards the limit of 10); allocates the reference; inserts the request with the service-name and address snapshots, status `SUBMITTED` and the UTC window; records the activity event `request.submitted` (staff text "*Alex Morgan submitted request FF-2026-00012 for AC Repair.*", customer text "*You submitted your request.*", metadata: reference, date, window); and creates a `REQUEST_RECEIVED` notification for **every active admin**, linking to `/app/requests/:id`. Any failure rolls all of it back, including a saved address and the reference number.
- **After the commit** (never inside it, never able to undo it): a confirmation email to the customer (reference, service, preferred time in the business's zone, next steps) and an alert to the business's `contactEmail`. Neither contains the description or the address. Each is logged in `EmailDeliveryLog` (`LOGGED` with the log transport, `SENT` over SMTP, `FAILED` with a safe code if the mail server is down).
- **`201`:** `{ "data": request }` for a new request; **`200`:** the same body for a repeated `submissionKey` of the same customer (the first request, whatever the repeat says; no second request, event, notification or email, and no reference number is used up). Concurrent repeats are safe: they queue on the customer's row and all but one get the `200`. Two customers may use the same key.
- **Errors:**
  - `422 VALIDATION_ERROR` with `fieldErrors` (dotted paths such as `description`, `preferredDate`, `newAddress.line1`, `newAddress.label`). The date range message is "*Choose a date from tomorrow onwards.*" or "*Choose a date within the next 90 days.*". Rules between fields (both addresses, neither, "save" without a new address, "save" without a label) are reported once the individual fields are valid.
  - `422 SERVICE_INACTIVE` with `fieldErrors.serviceId` when the service is unpublished, archived or unknown, through any client. An unknown id and an inactive one give the same answer. Other problems found in the same request are in the same `fieldErrors`.
  - `422 VALIDATION_ERROR` with `fieldErrors.serviceAddressId` when the saved address is not the caller's or does not exist: both give an identical answer, so addresses cannot be probed.
  - `409 ADDRESS_LIMIT_REACHED` when `saveAddressToProfile` would pass the limit of 10; nothing is created.
  - `401`, `403` (an admin, or a cross-origin write), `429` with `Retry-After`.

#### `GET /api/v1/requests/me`

- **Auth:** customer (an admin gets `403`). No limit beyond the global one.
- **Query:** `page`, `pageSize` (default 20, at most 100), `status` (one of the seven request statuses). `sort` can only be `submittedAt`, and `order` is `desc` (newest first) unless `asc` is asked for; any other `sort` or `order` is a `422`. A `customerId` in the query is ignored: the list is always the caller's.
- **`200`:** `{ "data": [listItem, …], "pagination": { page, pageSize, totalItems, totalPages } }`.

#### `GET /api/v1/requests/:id`

- **Auth:** the owner, **or an admin** (a preview of what the customer sees). An admin who has been removed from the allowlist gets `403`.
- **`200`:** `{ "data": request }` in the customer shape **for both callers**: the admin gets the customer's view, not an admin view.
- **Errors:** `404 NOT_FOUND` for another customer's request, with a body identical to one for an id that does not exist; `422` for an id that is not a UUID, which includes a **reference**: `GET /requests/FF-2026-00012` opens nothing for anyone; `401`.

### Admin service requests

The business's view of requests. **All four endpoints are admin-only**: a customer, and an admin who is no longer on the allowlist, get `403 FORBIDDEN`; no session is `401`. They answer with admin shapes (below) that carry the customer's contact details, every note with its visibility and the internal reason of a cancellation, and the customer's own endpoints never do. Status values are the seven of `ServiceRequestStatus`.

The **queue row** (`AdminRequestListItemDto`) is `{ id, reference, status, statusLabel, isNew, serviceName, customerName, city, preferredDate, preferredWindow, submittedAt, updatedAt }`. `isNew` is true while the status is `SUBMITTED` (nobody has looked at it yet). The **detail** (`AdminRequestDto`) is everything the customer sees (`reference`, `status`, `statusLabel` and `nextStep` in the customer's words, `serviceName`, `description`, `address`, preferred date, window and instants, `submittedAt`) plus:

| Field | Meaning |
| --- | --- |
| `serviceId`, `updatedAt` | The service as it is now (`serviceName` is what it was called when the request was made), and when the request last changed. |
| `customer` | `{ id, name, email, phone \| null, previousRequests, totalRequests, workOrderCount, invoiceCount }`. `previousRequests` is the customer's other requests, newest first, at most ten (`{ id, reference, serviceName, status, statusLabel, submittedAt }`); `totalRequests` counts all of them, this one included. The counts of jobs and invoices are real and are `0` until those exist. |
| `notes` | Every note, newest first: `{ id, body, visibility: INTERNAL \| CUSTOMER_VISIBLE, author: { name }, createdAt }`. |
| `timeline` | The history, oldest first, in the staff shape (`AdminTimelineEventDto`): staff wording, the customer's wording (`publicSummary`, `null` for an internal event), the actor and the status change. |
| `cancellation` | `null`, or `{ cancelledAt, cancelledBy: { name } \| null, reason, customerMessage \| null }`: the **internal** reason and what the customer was told. |
| `quotations` | Every version of the request's quotation, newest first: `{ id, reference, status, statusLabel, totalAmount, currencyCode, validUntil, sentAt, createdAt, replacesReference }`. The status is the effective one: a sent quotation past its last day already reads `EXPIRED`. |
| `availableActions` | What the admin may do now, most likely first, from the request transition table: a subset of `START_REVIEW`, `CREATE_QUOTATION` (a request under review with no draft), `REOPEN`, `CANCEL`, and `CREATE_WORK_ORDER` for an accepted request that has no job. The screen offers exactly these; the server checks the action again when it is used. |

#### The status table

| From | To | Who | Action |
| --- | --- | --- | --- |
| `SUBMITTED` | `UNDER_REVIEW` | admin | `START_REVIEW` |
| `SUBMITTED`, `UNDER_REVIEW`, `QUOTED`, `ACCEPTED`, `DECLINED` | `CANCELLED` | admin | `CANCEL` |
| `DECLINED` | `UNDER_REVIEW` | admin | `REOPEN` |
| `UNDER_REVIEW` → `QUOTED`; `QUOTED` → `ACCEPTED`, `DECLINED` or back to `UNDER_REVIEW`; `ACCEPTED` → `CONVERTED_TO_JOB` | | the system only | never by hand (`markQuoted` and the others in `requests.transitions.ts`, called by the quotation and work-order services) |

`CANCELLED` and `CONVERTED_TO_JOB` have no way out. The table is data in `requests.domain.ts`; the actions and the buttons are derived from it, and `requests.transitions.ts` is the only code that writes a status.

#### `GET /api/v1/admin/requests`

- **Query (strict):** `page`, `pageSize` (default 20, at most 100); `sort` one of `submittedAt` (default), `updatedAt`, `status` (in workflow order, not alphabetical) or `reference`, and `order` (`desc` by default); `q` (at most 100 characters, trimmed, blank means none: matches the reference, the customer's name or email, case-insensitively, with `%` and `_` taken literally); `status` (one or several: `status=SUBMITTED&status=QUOTED` or `status=SUBMITTED,QUOTED`; repeats collapse); `serviceId`; `customerId` (used by the customer's page in the admin area; the queue's own screen does not offer it); `submittedFrom` and `submittedTo` (`YYYY-MM-DD`, **both inclusive**, days on the business's calendar, so a day with a change of the clocks is 23 or 25 hours long and the server's and browser's zones do not matter).
- **`200`:** `{ "data": [row, …], "pagination": { … }, "meta": { "statusCounts", "totalForFilters" } }`. `statusCounts` has **all seven** statuses (`0` when none) and counts the requests under the search, service, customer and date filters **ignoring the status filter**, so a chip can say what choosing it would show; `totalForFilters` is their sum. Three queries however many rows: the page (with the customer's name), its total, and one grouped count.
- **Errors:** `422` with `fieldErrors` for an unknown status or sort, a bad id, a bad date, a `q` over 100 characters, or `submittedTo` before `submittedFrom` (`fieldErrors.submittedTo`); a bad entry in a list is reported as `status.0` (its position). `401`, `403`.

#### `GET /api/v1/admin/requests/:id`

- **`200`:** `{ "data": detail }`.
- **Errors:** `404` for an id that does not exist; `422` for an id that is not a UUID (a reference opens nothing); `401`, `403`.

#### `PATCH /api/v1/admin/requests/:id/status`

- **Auth:** admin. **Limit:** `adminWrite`.
- **Body (strict):** `action` (`START_REVIEW`, `CANCEL` or `REOPEN`; a status such as `QUOTED` cannot even be named), `expectedStatus` (the status the screen showed, required), `reason` (`CANCEL` and `REOPEN`: required, 5 to 500 characters; `START_REVIEW`: refused), `customerMessage` (only with `CANCEL`: optional, up to 500 characters; sending it with another action is a `422`).
- **What one call does, in one transaction:** reads the request; refuses a changed status; refuses an action the request's transition table does not allow here; writes the new status with a **conditional update** on the status that was read (two people acting at once cannot both succeed); and records the activity event (`request.review_started`, `request.cancelled`, `request.reopened`) with the staff wording and, for the customer, "*We started reviewing your request.*", "*We cancelled your request.*" or "*We reopened your request.*" The actor's name is in the staff wording only.
  - **`CANCEL`** also stores the internal reason, the optional message, the time and the admin on the request; voids every open (`DRAFT` or `SENT`) quotation of the request **in this same transaction** (`voidOpenQuotationsOnCancel`; see "Requests: quotations on a request"); creates a `REQUEST_CANCELLED` notification for the customer, linking to `/portal/requests/:id`; and queues an email to the customer **after the commit**. The email carries the customer message or, when there is none, only the neutral text. The template has **no field for the reason**, so it cannot reach a customer. The customer's page shows the message, never the reason.
  - **`REOPEN`** keeps its reason as an **internal note** ("*Reopened the request. Reason: …*").
- **`200`:** `{ "data": detail }`, after the change.
- **Errors:** `409 STALE_STATE` when the request is no longer in `expectedStatus` (checked first: the caller's view is out of date, and refreshing may show that the action is gone); `409 INVALID_STATE_TRANSITION` when the transition table does not allow the action here (the message says why, for example "*This request is cancelled, so it can no longer be changed.*"); `422` for a missing reason or a message with the wrong action; `404`, `401`, `403` (a customer, or a cross-origin write), `429` with `Retry-After`. After any refusal the request, its notes, its history and its notifications are unchanged.

#### `POST /api/v1/admin/requests/:id/notes`

- **Auth:** admin. **Limit:** `adminWrite`. **Body (strict):** `body` (required, trimmed, up to 2000 characters, line breaks kept) and `visibility` (`INTERNAL` or `CUSTOMER_VISIBLE`, **required**: the admin chooses on every note, there is no default in the API).
- **`201`:** `{ "data": note }`. The event `request.note_added` is recorded. An **internal** note leaves no sentence for the customer, so it is not on the customer's timeline; a **customer-visible** note appears on the customer's request page and timeline ("*We added a note to your request.*") and the customer gets an in-app `NOTE_ADDED` notification **without the note's text**. There is no email for a note. Notes cannot be edited or deleted.
- **Errors:** `422` (empty or too long, visibility missing or unknown, unknown key), `404`, `401`, `403`, `429`.

### Admin customers

The business's directory of customers and each customer's whole history. **All four endpoints are admin-only**: a customer, and an admin who is no longer on the allowlist, get `403 FORBIDDEN`; no session is `401`. They answer with admin shapes that carry the customer's history, their money position and the team's private notes; the customer's own endpoints (`/customers/me`, `/requests/:id`, …) never do. A customer is addressed by the **profile id** (`customer.id` of an admin request); anything that is not a UUID is `422`, an id that is not a customer's (including an admin's user id) is `404`.

The **list row** (`AdminCustomerListItemDto`) is `{ id, name, email, phone | null, city | null, requestCount, openJobCount, outstandingBalance, currencyCode, lastActivityAt, createdAt }`. `city` is the city of the **default** address (`null` with no address). `openJobCount` counts jobs that are not `COMPLETED` or `CANCELLED`. `outstandingBalance` is a decimal string, Σ (total − paid) over the customer's `ISSUED`, `PARTIALLY_PAID` and `OVERDUE` invoices **in the business's currency** (`currencyCode`); invoices in another currency are not added in. `lastActivityAt` is the latest activity event recorded about the customer, or `createdAt` (when they signed up) when there is none.

The **detail** (`AdminCustomerDto`) is `{ id, name, email, phone, customerSince, lastActivityAt, addresses, summary, recent, notes, noteCount }`:

| Field | Meaning |
| --- | --- |
| `addresses` | Every saved address with its **access notes**, the default first (`ServiceAddressDto`, the same shape the customer sees). |
| `summary` | `{ requestCount, quotationCount, jobCount, openJobCount, invoiceCount, outstandingBalance, currencyCode }`. |
| `recent` | `{ requests, quotations, jobs, invoices }`: the latest five of each, newest first, in the same row shapes as the history (below). Equal to page 1 of each history with `pageSize=5`. |
| `notes`, `noteCount` | The latest 50 internal notes, newest first (`{ id, body, author: { name }, createdAt }`), and how many exist in all. |

**History rows.** A request: `{ id, reference, serviceName, status, preferredDate, preferredWindow, submittedAt }`. A quotation: `{ id, reference, status, totalAmount, currencyCode, validUntil, sentAt | null, createdAt, request }`. A job: `{ id, reference, serviceName, status, scheduledStart | null, completedAt | null, createdAt, request }`. An invoice: `{ id, invoiceNumber | null, status, totalAmount, amountPaid, balanceDue, currencyCode, dueDate | null, issuedAt | null, createdAt, request }`, where `balanceDue` is total − paid for an issued, partly paid or overdue invoice and `"0.00"` otherwise, and `invoiceNumber` is `null` while it is a draft. `request` is `{ id, reference }`, the request the record belongs to. Money is always a decimal string with its `currencyCode`.

#### `GET /api/v1/admin/customers`

- **Query (strict):** `page`, `pageSize` (default 20, at most 100); `sort` one of `name` (default, case-insensitive), `createdAt` or `lastActivityAt`, and `order` (`asc` by default); `q` (at most 100 characters, trimmed, runs of spaces count as one, blank means none). `q` matches the **name or email** case-insensitively, with `%`, `_` and `\` taken literally; text that is only digits, spaces and `+ - ( ) .` with **at least three digits** also matches the **digits of the phone number**, so `212-555`, `(212) 555` and `2125550142` find `(212) 555-0142`. It is a bound parameter, never part of the SQL.
- **`200`:** `{ "data": [row, …], "pagination": { … } }`. Seven queries however many rows (the page of ids and the total as two statements, then the rows and three grouped queries for that page only). Every sort ends with the id, so pages never repeat or lose a customer.
- **Errors:** `422` with `fieldErrors` for an unknown sort, a bad order, a bad page, a `q` over 100 characters or given twice; `401`, `403`.

#### `GET /api/v1/admin/customers/:id`

- **`200`:** `{ "data": detail }`. Only this customer's records are ever read: every query names the customer.
- **Errors:** `404` for a customer that does not exist; `422` for an id that is not a UUID; `401`, `403`.

#### `GET /api/v1/admin/customers/:id/history`

- **Query (strict):** `type` (**required**: `requests`, `quotations`, `jobs` or `invoices`), `page`, `pageSize` (default 20, at most 100). There is no sort: newest first.
- **`200`:** `{ "data": [row, …], "pagination": { … } }` with the rows of the requested kind. An empty history is `200` with no rows and `totalItems: 0`.
- **Errors:** `404` for a customer that does not exist; `422` for a missing or unknown `type`, a bad page or an id that is not a UUID; `401`, `403`.

#### `POST /api/v1/admin/customers/:id/notes`

- **Auth:** admin. **Limit:** `adminWrite`. **Body (strict):** `body` only (required, trimmed, up to 2000 characters, line breaks kept). There is nothing else to send: the author is the session's admin, the customer is the address, a note is always internal and has no visibility, and a key such as `visibility`, `authorUserId`, `customerId` or `createdAt` is `422`.
- **`201`:** `{ "data": { id, body, author: { name }, createdAt } }`. In one transaction the note is stored and `customer.note_added` is recorded on entity `CUSTOMER` with the staff wording ("*Morgan Reyes added an internal note about Alex Morgan.*"), **no customer wording** (so no customer timeline can show it) and no metadata (the text stays out of the event). No notification and no email. Notes cannot be edited or deleted.
- **Internal means internal:** no endpoint a customer can call reads `customer_notes`, and the integration tests assert that the text appears in none of `/auth/me`, `/customers/me`, `/customers/me/addresses`, `/requests/me`, `/requests/:id` and `/notifications/me`, and that those answers are unchanged by the note.
- **Errors:** `422` (empty or too long, unknown key, an id that is not a UUID), `404`, `401`, `403` (a customer, or a cross-origin write), `429`. After any refusal nothing is written.

### Quotations

The business's quotation builder and the customer's read of a quotation. The customer's side, their list and their answer, follows the admin endpoints below. Money is a decimal string next to `currencyCode`; `validUntil` is `YYYY-MM-DD`; every other time is ISO 8601 UTC. Every `/admin/...` endpoint is **admin-only** (a customer, and an admin no longer on the allowlist, get `403`; no session is `401`); the write endpoints are limited by `adminWrite`. The role check is on each route, because the router shares the `/admin` prefix with other modules.

**The status table.** `DRAFT` → `SENT` or `VOID`; `SENT` → `ACCEPTED`, `DECLINED` (the customer), `EXPIRED` (the system, as time passes) or `VOID`. The other four have no way out. The table is data in `quotations.domain.ts`; `quotations.transitions.ts` is the only code that writes a status, always with an update conditional on the status that was read. A pair that is not allowed is `409 INVALID_STATE_TRANSITION`; an `expectedStatus` that is no longer the stored status is `409 STALE_STATE` (checked first).

**Expiry.** A `SENT` quotation is expired once the business's calendar day is past `validUntil` (until 23:59:59 on that day, in the business time zone). The status in every response is the *effective* one, and the stored one is saved before any read of a quotation, a request or a request list (`syncExpiredQuotations`): `EXPIRED`, an event with no actor, and a `QUOTED` request with no other sent quotation goes back to `UNDER_REVIEW`. It is idempotent, safe from concurrent reads, and notifies no one.

**The admin quotation** (`AdminQuotationDto`) is the document (`QuotationDocumentDto`, below) plus:

| Field | Meaning |
| --- | --- |
| `requestId`, `requestStatus`, `requestStatusLabel`, `customer` | The request and who it is for (`customer` is `{ id, name, email, phone \| null }`). |
| `createdAt`, `updatedAt`, `createdBy`, `sentBy` | `updatedAt` is the version a save sends back as `expectedUpdatedAt`. |
| `declineReason`, `expiredAt`, `voided` | `voided` is `null`, or `{ at, by: { name } \| null, reason }`: the **internal** reason. |
| `replaces`, `replacedBy` | The neighbours in the chain: `{ id, reference, status, statusLabel }` or `null`. |
| `timeline` | The history, oldest first, in the staff shape (`AdminTimelineEventDto`). |
| `availableActions` | Most likely first: a draft `EDIT`, `SEND`, `VOID`; a sent quotation `REPLACE` (left out while the request has a draft) and `VOID`; nothing otherwise. |

The **document** (`QuotationDocumentDto`, what a customer may see) is `{ id, reference, status, statusLabel, requestReference, serviceName, customerName, address, business, currencyCode, taxRate, lines, subtotal, discountAmount, taxableBase, taxAmount, totalAmount, validUntil, terms, customerNote, sentAt, respondedAt }`. `address` has no access notes. `business` is `{ name, tagline, logoKey, logoUrl, email, phone, address }` from the settings. A line is `{ id, position, description, quantity, unitPrice, taxable, lineTotal }`.

#### `POST /api/v1/admin/requests/:id/quotations`

- **Body (strict):** `replacesQuotationId` (optional UUID: the sent quotation to replace). **`201`:** `{ "data": AdminQuotationDto }`.
- **What the server fills in:** the reference (`QT-YYYY-NNNNN`), the currency and tax rate from the settings, `validUntil` = the business's today + `quotationValidityDays`, the default terms, and one starter line (the service name as the customer asked for it; its price when the service has one fixed price, `0.00` otherwise). A replacement copies the lines, the discount, the terms and the note of the sent quotation. The event `quotation.created` is staff-only; nothing is sent to anyone.
- **Errors:** `409 INVALID_STATE_TRANSITION` unless the request is `UNDER_REVIEW` (a first quotation) or `QUOTED` (a replacement; without `replacesQuotationId` it is refused: replace the sent one), or when the quotation to replace is not `SENT`; `409 DRAFT_EXISTS` with `details.quotationId` when the request has a draft (two clicks at once create exactly one); `404` for a request, or a quotation to replace, that is not found (on that request); `422`; `401`, `403`, `429`. After any refusal nothing is created.

#### `GET /api/v1/admin/quotations/:id`

- **`200`:** `{ "data": AdminQuotationDto }`, after saving any expiry that is due. **Errors:** `404`, `422` (not a UUID: a reference opens nothing), `401`, `403`.

#### `PATCH /api/v1/admin/quotations/:id`

- **Drafts only.** **Body (strict):** `lines` (1 to 50 of `{ description (1 to 200), quantity, unitPrice, taxable }`), `discountAmount`, `taxRate`, `validUntil`, `terms` and `customerNote` (`string` or `null`; blank clears), `expectedUpdatedAt`. Amounts are decimal strings with at most two decimal places. **A total cannot be sent: `subtotal`, `taxAmount`, `totalAmount`, a line's `lineTotal` and every other unknown key are `422` ("Unknown field.")**, so a client cannot believe it set one.
- **What one call does:** replaces the lines and the details and **recomputes every amount from the lines** with `calculateDocumentTotals` of `@fixflow/shared` (the code the editor's preview runs), in one transaction under the request's lock and a conditional update on the version that was read. No event: a save would only bury the history.
- **`200`:** `{ "data": AdminQuotationDto }`. **Errors:** `409 QUOTATION_NOT_EDITABLE` for a quotation that is not a draft (judged **first**, so the answer is the same from any page; the record is unchanged); `409 STALE_STATE` when `expectedUpdatedAt` is not the stored version (two saves from one version: one wins); `422` with `fieldErrors` keyed `lines.2.quantity`, `lines.0.unitPrice`, `lines`, `discountAmount` (more than the subtotal), `taxRate`, `validUntil`, `terms`, `customerNote`; `404`, `401`, `403`, `429`.

#### `POST /api/v1/admin/quotations/:id/send`

- **Body (strict):** `expectedStatus` (the status the screen showed; required). **`200`:** `{ "data": AdminQuotationDto }`, now `SENT`.
- **Before it goes:** at least one line, a total above zero and `validUntil` today or later in the business time zone (`422`, `fieldErrors` keyed `lines`, `totalAmount`, `validUntil`); the request `UNDER_REVIEW` or `QUOTED`; no other sent quotation on the request.
- **In one transaction:** if this is a replacement, the previous `SENT` quotation is voided first (reason `Replaced by QT-…`, the admin, the time; if the customer answered it first the send is `409` and nothing changes, and if it expired or was voided meanwhile it is left as it is); the draft becomes `SENT` with `sentAt` and `sentBy`; the request becomes `QUOTED` by the system; events `quotation.sent` (customer wording "*We sent you quotation QT-…*") and `request.quoted` (staff-only, no actor); the customer gets a `QUOTATION_SENT` notification linking to `/portal/quotations/:id`. The email (`quotation-sent`) is queued and sent **after the commit**; a failure to send is logged and never undoes the send.
- **Duplicate-safe:** the request's row lock makes two sends take turns, the status change is conditional on the draft still being a draft, and the second of two clicks is `409 STALE_STATE`: exactly one `SENT` quotation, one notification, one email, one event. **Other errors:** `409 INVALID_STATE_TRANSITION` (not a draft, or the request is not open for it), `404`, `401`, `403`, `429`.

#### `POST /api/v1/admin/quotations/:id/void`

- **Body (strict):** `reason` (required, 5 to 500 characters, **internal**), `expectedStatus` (`DRAFT` or `SENT`), `customerMessage` (optional, up to 500 characters; only for a sent quotation, otherwise `422`). **`200`:** `{ "data": AdminQuotationDto }`, now `VOID` with `voided` set.
- **What it does:** records who, when and why and the event `quotation.voided`. A **sent** quotation's customer is told (`QUOTATION_WITHDRAWN`, link `/portal/requests/:id`, an email) with `customerMessage` or a standard line; **the reason is not an input of the notification, the email or any customer DTO**. When it was the request's only sent quotation, the request returns to `UNDER_REVIEW` (staff-only event `request.review_resumed`). A **draft** that was started as a replacement lets go of the link to the quotation it was to replace, so that one can be replaced again.
- **Errors:** `409 INVALID_STATE_TRANSITION` for a quotation that is answered, expired or already void (unchanged), `409 STALE_STATE`, `422` (no reason, a reason outside 5 to 500, a message with a draft), `404`, `401`, `403`, `429`. Two admins voiding together: one wins.

#### `GET /api/v1/quotations/:id` (the customer's read)

- **Auth:** any signed-in user. A customer gets their own quotation **once it has been sent** (`200`, `CustomerQuotationDto`: the document plus `requestId`, `replacedBy` and `preview`). `replacedBy` is `{ id, reference }` when the quotation was replaced by one the customer has been sent, otherwise `null` (a replacement still in draft is not theirs to know about). A draft, a quotation voided before it was sent, another customer's quotation and an id that does not exist are all the same `404`, with the same words. An admin may read it to see what the customer sees; a quotation that has not been sent only with `?preview=1` (then `preview: true`), otherwise `404`. A customer asking for a preview of a draft still gets `404`.
- **Nothing internal:** no staff names, no void reason, no timeline, no `availableActions`, no access notes; the key list is pinned by a test. The expiry is saved before reading, so the customer sees `EXPIRED` the moment it is true.
- **Errors:** `422` for an id that is not a UUID (a reference opens nothing) or `preview` other than `1`; `401`.

#### Requests: quotations on a request

- `GET /admin/requests/:id` carries `quotations`: every version, newest first, `{ id, reference, status, statusLabel, totalAmount, currencyCode, validUntil, sentAt, createdAt, replacesReference }`, and `availableActions` may now include `CREATE_QUOTATION` (a request under review with no draft). It is not a status change: `PATCH /admin/requests/:id/status` still takes only `START_REVIEW`, `CANCEL` and `REOPEN`.
- `PATCH /admin/requests/:id/status` with `CANCEL` now **voids every open (`DRAFT` or `SENT`) quotation in the same transaction**, with the reason `Request cancelled: <reason>`, the admin and an event each; the customer is told once, by the cancellation notice, and gets no separate "withdrawn" message. If the cancellation fails, the quotations are left as they were.
- The admin request list and detail and the customer's request list and detail save any due expiry first, so a request whose only quotation ran out of time is already back under review.

### Customer quotation decisions

The customer's side of a quotation: what they were sent, and their answer. Acceptance is "a recorded business decision, not an electronic signature": the server records who, when and what followed. Whose quotation it is comes from the session only.

#### `GET /api/v1/quotations/me`

- **Auth:** customer (an admin gets `403`; no session `401`). No limit beyond the global one.
- **Query:** `page`, `pageSize` (default 20, at most 100), `status` (one of `SENT`, `ACCEPTED`, `DECLINED`, `EXPIRED`, `VOID`; `DRAFT` is a `422`). There is no `sort`: the order is fixed.
- **`200`:** `{ "data": [item, …], "pagination": { page, pageSize, totalItems, totalPages } }` where an item is the summary above (`id, reference, status, statusLabel, totalAmount, currencyCode, validUntil, sentAt, respondedAt, replacedBy`) plus `requestId`, `requestReference` and `serviceName`.
- **Which, and in what order:** only quotations **sent to the caller** (`sentAt` set), so never a draft, a quotation voided before it was sent, or another customer's. The ones **awaiting an answer** (`SENT`) come first, the soonest to run out leading; the rest follow, newest sent first. A page that starts in the first group and ends in the second takes its remaining rows from the second, so no row is repeated or lost between pages. A due expiry is saved before listing, so nothing that has run out is listed as awaiting.

#### `POST /api/v1/quotations/:id/accept`

- **Auth:** customer. An admin gets `403 FORBIDDEN` (the role check runs first) and nothing is read or written. **Limit:** `quotationDecision` (20 per hour per customer, accept and decline together; a refused answer counts).
- **Body (strict):** none. `{}` or no body; any key (`status`, `respondedAt`, `customerId`, …) is `422 "Unknown field."`: acceptance is the act itself, and the owner, the time and the status are the server's.
- **`200`:** `{ "data": CustomerQuotationDto }`, now `ACCEPTED` with `respondedAt` set.
- **What one call does, in one transaction** (`runInTransaction`): saves any due expiry (in its own earlier transaction, so it stands even when this answer is refused); judges ownership from the id alone (`404` for a missing quotation, another customer's, a draft, or a draft that was voided; the same words for all four); takes the request's row lock, which orders this against an admin voiding or replacing the quotation, the expiry sync and any other answer; **reads the quotation again under the lock**; refuses unless it is `SENT` and in date; then changes the status with a **conditional update** (`WHERE id AND status = 'SENT' AND customer_id = <the owner> AND valid_until >= <today in the business time zone>`); moves the request `QUOTED` → `ACCEPTED` as the system; records `respondedAt` and `respondedByUserId`; writes two events, `quotation.accepted` (staff: "*Alex Morgan accepted quotation QT-2026-00004.*", customer: "*You accepted quotation QT-2026-00004.*") and `request.accepted` (staff-only, no actor); creates a `QUOTATION_ACCEPTED` notification for **every active admin** linking to `/app/quotations/:id`; and queues one `quotation-decision-admin` email to the business's `contactEmail`, linking to the request. The email is sent **after the commit**; a failure to send is logged and never undoes the answer. Any failure rolls all of it back.
- **In date** means until 23:59:59 on `validUntil` in the business time zone, by the injected clock: a quotation valid until the 5th can be accepted at 21:00 in New York on the 5th (already the 6th in UTC) and not at 00:00 on the 6th.
- **`409 QUOTATION_NOT_AVAILABLE`** for anything but a sent quotation in date, with `details.currentStatus` (the *effective* status) and a message written for the customer, specific to what it is:
  - `ACCEPTED`: "*You already accepted this quotation on Nov 3, 2026. There is nothing more to do: we'll contact you to schedule the work.*" (for a decline: "*… so it can't be declined now. Contact us if you need to change anything.*")
  - `DECLINED`: "*You declined this quotation on Nov 3, 2026, so it can't be accepted now. Contact us and we'll send a new quotation if you'd like one.*" (for a second decline: "*You already declined this quotation on Nov 3, 2026.*")
  - `EXPIRED`: "*This quotation was valid until Nov 17, 2026 and has expired. Contact us and we'll send an updated quotation.*"
  - `VOID`: "*This quotation was withdrawn, so you can't accept it. Check your request for an updated quotation, or contact us.*" The internal void reason is never in it.
  The record is unchanged after a refusal: no event, no notification, no email.
- **Concurrency:** an accept and a decline sent together, five accepts together, and an accept racing the business's void each leave exactly **one** winner and a consistent state (the quotation, the request, the event, the one notification per admin and the one email agree); the rest are `409`. The integration tests repeat each race.
- **Other errors:** `404` (see above), `422` (not a UUID: a reference opens nothing), `401`, `403` (an admin, or a cross-origin write), `429` with `Retry-After`.

#### `POST /api/v1/quotations/:id/decline`

- The same guards, limit, transaction, notification (`QUOTATION_DECLINED`, "*Quotation QT-… declined*") and email as `accept`; the quotation becomes `DECLINED` and the request `DECLINED` (the business can reopen it).
- **Body (strict):** `reason` (optional, trimmed, up to 500 characters, line breaks kept; blank or missing means none). A reason over 500 characters is `422` with `fieldErrors.reason`, and nothing changes.
- The reason is the customer's own words. It is stored with the quotation and shown to the business (`declineReason` on the admin quotation, the banner on the admin page), and is deliberately **not** in the activity events (whose metadata is a closed allowlist with no free text), the notification or the email.
- **`200`:** `{ "data": CustomerQuotationDto }`, now `DECLINED`.

### Technician resources

The people the business schedules for jobs. A technician is a **resource record, not a user**: they have no login and no role (technician login is out of scope), so there is no technician-facing side. **Every endpoint is admin-only**: a customer, and an admin who is no longer on the allowlist, get `403 FORBIDDEN`; no session is `401`. Every shape below is the admin's (it carries the internal notes and the contact details); the customer's own view of a job names its technician by display name only and is built by its own serializer. A technician is addressed by `id`; anything that is not a UUID is `422`, an unknown one `404`.

**What "upcoming" means.** A job counts as an upcoming assignment of a technician when it is **`SCHEDULED` or `IN_PROGRESS`**, its appointment **has not ended** (`scheduledEnd > now`) and it **starts before the end of the 14th day** counted from today (`scheduledStart < ` the start of today + 14 days). Days are days on the **business's calendar and time zone**, not 24-hour spans, so late in the evening in New York "today" is still today, and the day the clocks change is 23 or 25 hours long. A job under way right now counts; one that ended this morning does not. `COMPLETED`, `CANCELLED`, `PENDING_SCHEDULING` and `NEEDS_RESCHEDULING` jobs never count. These are the same two statuses the scheduling overlap check uses.

**List row** (`AdminTechnicianListItemDto`): `{ id, name, phone | null, email | null, specialties: string[], calendarColor, isActive, upcomingJobCount, nextJob: { id, reference, scheduledStart } | null, availableActions }`. There are **no internal notes** in a list row. `calendarColor` is a key of the shared palette (`blue`, `green`, `amber`, `purple`, `rose`, `teal`, `orange`, `slate`; `TECHNICIAN_COLORS` in `@fixflow/shared`), never a colour value; the web app maps it to design tokens whose contrast is tested. `availableActions` lists what the admin may do now: `EDIT` always, then `DEACTIVATE` for an active technician or `ACTIVATE` for an inactive one.

**Detail** (`AdminTechnicianDto`, the answer of every single-technician endpoint): the list row plus `notes | null` (internal), `createdAt`, `updatedAt`, `upcomingAssignments` and `availability`:

| Field | Meaning |
| --- | --- |
| `upcomingAssignments` | The upcoming jobs, soonest first (ties by id): `{ id, reference, customerName, serviceName, scheduledStart, scheduledEnd, status }` (the job's `id` is for its page, `/app/jobs/:id`). `serviceName` is the name the job was made with. Nothing else of the job or the customer is in it (no address, access notes, contact details or internal notes). |
| `availability` | Seven entries, today first: `{ date: "YYYY-MM-DD", scheduledMinutes }`, the minutes of `SCHEDULED` and `IN_PROGRESS` appointments that fall on that business day. An appointment that crosses midnight is split between its days, and a job that ran earlier today still counts for today. It is booked time only: FixFlow has no working-hours model, so `0` means nothing is scheduled, not that the technician is off. Minutes are an integer, not a fractional hour. |
| `upcomingJobCount`, `nextJob` | Taken from `upcomingAssignments` (its length and its first entry). |

#### `GET /api/v1/admin/technicians`

- **Query (strict):** `active` one of `true`, `false` or `all` (leaving it out is `all`); `q` (at most 100 characters, trimmed, runs of spaces count as one, blank means none); `page`, `pageSize` (default 20, at most 100); `sort` is `name` (the only field) and `order` `asc` or `desc`. `q` matches a **name, email address or specialty** case-insensitively, with `%`, `_` and `\` taken literally, and, like the customer search, text that is only digits, spaces and `+ - ( ) .` with at least three digits also matches the **digits of the phone number**. It is a bound parameter, never part of the SQL.
- **`200`:** `{ "data": [row, …], "pagination": { … }, "meta": { "counts": { "all", "active", "inactive" }, "suggestedColor" } }`. The counts ignore the filter and the search, so the tabs can say what each holds. `suggestedColor` is the palette colour the fewest technicians have (inactive ones included), which the "Add technician" form offers first. The upcoming count and next job are read for the page's technicians in one query.
- **Errors:** `422` with `fieldErrors` for an unknown `active`, `sort` or `order`, a bad page, a `q` over 100 characters; `401`, `403`.

#### `GET /api/v1/admin/technicians/assignable`

- Who can be given a **new** assignment: **active technicians only**, A to Z. Not paginated (a small company's team). `200`: `{ "data": [{ id, name, specialties, calendarColor }, …] }`. Nothing else is in it: no contact details, no notes. The scheduling dialog uses it; the scheduling endpoints re-check that the technician is active.
- **Errors:** `401`, `403`.

#### `GET /api/v1/admin/technicians/:id`

- **`200`:** `{ "data": detail }` (above). The jobs, the hours and the count come from the real `work_orders` table.
- **Errors:** `404`; `422` for an id that is not a UUID; `401`, `403`.

#### `POST /api/v1/admin/technicians`

- **Auth:** admin. **Limit:** `adminWrite`. **Body (strict):**

  | Field | Rule |
  | --- | --- |
  | `name` | required, 2 to 100 characters, one line, trimmed |
  | `phone` | optional; 7 to 15 digits with spaces, `+ - ( )` (the customer phone rule); blank or `null` stores nothing |
  | `email` | optional; a valid address, stored in lower case; blank or `null` stores nothing |
  | `specialties` | optional list of at most 8 tags of at most 40 characters; spaces inside a tag are tidied and a repeated tag (ignoring case) is dropped, keeping the first spelling and the order |
  | `notes` | optional, at most 1000 characters, line breaks kept; **internal** |
  | `calendarColor` | optional, a palette key; without one the technician gets the colour the fewest others have |

  `isActive`, `id`, timestamps and any unknown key are `422`: a new technician is active, and the rest is the server's.
- **`201`:** `{ "data": detail }`. In one transaction the technician is stored and `technician.created` is recorded on entity `TECHNICIAN` with the staff wording ("*Morgan Reyes added the technician "Jordan Lee".*"), no customer wording, and metadata `{ isActive: true }` only.
- **Errors:** `422` with a `fieldErrors` entry per field (a tag is `specialties.0`, `specialties.1`, …); `401`, `403` (a customer, or a cross-origin write), `429`. After any refusal nothing is written.

#### `PATCH /api/v1/admin/technicians/:id`

- **Auth:** admin. **Limit:** `adminWrite`. **Body (strict):** any subset of the fields above except `isActive` (a technician is switched with the two endpoints below, which record who did it), and at least one. A field sent as `null` or blank is cleared (`name` and `calendarColor` cannot be). Editing is allowed in both states.
- **`200`:** `{ "data": detail }`. Only the fields whose value differs are written, so two admins changing different details do not undo each other. A body that changes nothing (the same values, only spaced differently) writes nothing, records nothing and still answers `200`. Otherwise `technician.updated` is recorded with the **names** of the changed fields (`changedFields`) in the wording ("*… updated the technician "Jordan Lee" (changed: specialties).*") and never the values, so contact details and notes stay out of the history.
- **Errors:** `404`; `422` (including an empty body, `isActive`, and the same field rules as `POST`); `401`, `403`, `429`.

#### `POST /api/v1/admin/technicians/:id/deactivate` and `/activate`

- **Auth:** admin. **Limit:** `adminWrite`. **No body.** Makes the technician unavailable (or available again) for **new** assignments. They are **idempotent**: asking for the state the technician is already in changes nothing, records nothing and answers `200` with the technician as they are, so a retry or a double click is safe. The write is conditional on the opposite state, so of two simultaneous requests exactly one records the change.
- **Existing assignments are never changed.** A deactivated technician keeps every job already assigned to them; the answer's `upcomingJobCount` (and `upcomingAssignments`) is how many remain assigned, so the screen can tell the admin. Reassigning is done job by job from the job's page.
- **`200`:** `{ "data": detail }`. A real change records `technician.deactivated` or `technician.activated` (with `fromStatus` and `toStatus` `ACTIVE`/`INACTIVE`, metadata `{ isActive }`) and, for a deactivation, the number of jobs that stay assigned in the staff wording ("*… deactivated the technician "Jordan Lee" (3 upcoming jobs stay assigned).*"). The technician then leaves `/admin/technicians/assignable` at once and comes back when reactivated.
- **Errors:** `404`; `422` for an id that is not a UUID; `401`, `403`, `429`.

### Work orders and scheduling

A **work order** is what the UI calls a **job**: the operational record made from a quotation the customer accepted. It is made once, scheduled with a technician, and then started, completed, cancelled or sent back for a new time. **Every `/admin/…` endpoint here is admin-only** (a customer gets `403`, a visitor `401`); the customer's own view of a job is `GET /api/v1/work-orders/me` and `/:id`, described after the admin endpoints. Shapes are in `@fixflow/shared` (`work-orders.ts`).

**Statuses and the actions that lead to them.** `PENDING_SCHEDULING` → `SCHEDULED` (action `SCHEDULE`, needs a time and an active technician); `NEEDS_RESCHEDULING` → `SCHEDULED` (`SCHEDULE`); `SCHEDULED` → `SCHEDULED` (`RESCHEDULE`, needs a reason); and, by `POST …/transitions`, `SCHEDULED` → `IN_PROGRESS` (`START`), `SCHEDULED`/`IN_PROGRESS` → `NEEDS_RESCHEDULING` (`MARK_NEEDS_RESCHEDULING`), `IN_PROGRESS` → `COMPLETED` (`COMPLETE`), `PENDING_SCHEDULING`/`SCHEDULED`/`NEEDS_RESCHEDULING` → `CANCELLED` (`CANCEL`). `COMPLETED` and `CANCELLED` are terminal, and an `IN_PROGRESS` job cannot be cancelled. `availableActions` on a job lists what its status allows, the most likely first (`SCHEDULE`, `RESCHEDULE`, `START`, `COMPLETE`, `MARK_NEEDS_RESCHEDULING`, `CANCEL`), and, for a completed job with no invoice that is not void, `CREATE_INVOICE` (which changes no status; see Invoices). A job also carries `invoice`: its invoice that is not void, or `null`.

**Times** are UTC instants in ISO 8601 (`2026-03-03T15:00:00.000Z`) everywhere. A request may send `Z` or an offset (`…T10:00:00-05:00`); a time with no zone or a bare date is `422`. The web form turns the business's date and time into instants with `wallClockToInstant`.

**Overlap rule.** Two appointments overlap when each starts before the other ends: intervals are half-open, `[start, end)`, so one that ends the moment another starts is fine. Only jobs that hold a technician's time count: `SCHEDULED` and `IN_PROGRESS`. Other technicians' jobs, and jobs that are waiting, finished or cancelled, never block.

**Error codes added:** `SCHEDULING_CONFLICT` (`409`) and `TECHNICIAN_INACTIVE` (`422`).

#### `POST /api/v1/admin/quotations/:id/work-order`

- **Auth:** admin. **Limit:** `adminWrite`. **No body.** Turns an accepted quotation into a job without re-entering anything: the customer, the service (and its name as it was when the request was made), the service address with its access notes, and a scope written from the request's description and the accepted lines ("*…problem…* \n\nAgreed work:\n- *line*\n- *line*"). The job starts `PENDING_SCHEDULING` with a `JOB-YYYY-NNNNN` reference; the request becomes `CONVERTED_TO_JOB`.
- **Idempotent.** `201` with the new job, or **`200` with the job the quotation already has**, so repeating it (a double click, a retry, a second tab) is safe and every answer names the same job. Concurrent calls make one job: the request's row lock serialises them, the unique `quotationId` is the database's own refusal if a second row were ever inserted (answered with the existing job), and the request's transition is conditional.
- **`409 INVALID_STATE_TRANSITION`** when the quotation is not `ACCEPTED`, or its request is not (for example it was cancelled after the customer accepted); `details` has `currentStatus` (the quotation's) and `requestStatus`. Nothing is created.
- **History:** `work_order.created` on the job (staff: "*Morgan Reyes created job JOB-… from quotation QT-… for request FF-…*"; customer: "*We created job JOB-… for your request.*") and `request.converted_to_job` on the request (the system, staff-only). No notification or email: the customer is told when the visit is scheduled.
- **Errors:** `404` (no such quotation); `422` for an id that is not a UUID; `401`, `403` (a customer, or a cross-origin write), `429`.
- The request's `availableActions` lists `CREATE_WORK_ORDER` while it is `ACCEPTED`, and so does the accepted quotation's (`QuotationAction.CREATE_WORK_ORDER`, only while its request is still `ACCEPTED`).

#### `GET /api/v1/admin/work-orders`

- **Query (strict values, unknown keys ignored):** `view` one of `needs-scheduling` (`PENDING_SCHEDULING` and `NEEDS_RESCHEDULING`), `upcoming` (`SCHEDULED`), `in-progress`, `ready-to-invoice` (`COMPLETED` jobs that have **no invoice other than a void one**: until invoices exist, every completed job), `completed` (every completed job), `all` (every status); `status` one or more statuses, repeated (`status=A&status=B`) or comma-separated, which **narrows** the view; `technicianId`, `customerId` (UUIDs); `scheduledFrom`, `scheduledTo` (`YYYY-MM-DD` days on the **business's calendar**, inclusive, matched against the day the appointment **starts**; a job with no appointment is in no range; `scheduledTo` before `scheduledFrom` is `422`); `q` (at most 100 characters; matches the reference or the customer's name or email, ignoring case, with `%` and `_` as plain characters); `page`, `pageSize` (default 20, at most 100); `sort` one of `scheduledStart` (jobs with no appointment last, in either direction), `completedAt` (jobs that are not completed last), `createdAt` (the default, newest first) or `status` (in the order of the workflow); `order`.
- **`200`:** `{ "data": [row, …], "pagination": { … }, "meta": { "viewCounts": { "needs-scheduling", "upcoming", "in-progress", "ready-to-invoice", "completed", "all" } } }`. The counts obey every filter **except** `view` and `status`, so each tab says what choosing it would show.
- **Row** (`AdminWorkOrderListItemDto`): `{ id, reference, status, statusLabel, serviceName, customerName, city, scheduledStart | null, scheduledEnd | null, technician: { id, name, calendarColor } | null, completedAt | null, createdAt }`. No contact details, address or notes. A job that needs a new time keeps its old appointment in `scheduledStart`/`scheduledEnd` as a reference; it holds no technician's time.
- **Errors:** `422` with `fieldErrors` naming the parameter (an invalid entry of a list is reported as `status.0`); `401`, `403`.

#### `GET /api/v1/admin/work-orders/:id`

- **`200`:** `{ "data": job }` (`AdminWorkOrderDto`): `id`, `reference`, `status`, `statusLabel`, `scopeDescription`, `serviceId`, `serviceName`, `scheduledStart`, `scheduledEnd`, `technician` (`{ id, name, calendarColor, phone, email, isActive }` or `null`), `customer` (`{ id, name, email, phone }`), `address` (with `accessNotes`, as it was when the request was made), `request` and `quotation` (`{ id, reference }`; the quotation also has `currencyCode`, `subtotal`, `discountAmount`, `taxRate`, `taxAmount`, `totalAmount` as decimal strings and its `lines`), `startedAt`, `completedAt`, `completionNote` (what the customer reads), `internalCompletionNote` (the team only), `cancelledAt`, `cancelReason` (the team only), `createdBy`, `createdAt`, `updatedAt`, `timeline` (the internal history with staff summaries, oldest first) and `availableActions`.
- **Errors:** `404`; `422` for an id that is not a UUID; `401`, `403`.

#### `GET /api/v1/admin/work-orders/conflicts`

- The read-only pre-check the scheduling dialog runs while the admin chooses. **Query (all required but `excludeId`):** `technicianId`, `start`, `end` (ISO 8601 instants, `end` after `start`, at most 7 days apart), `excludeId` (the job being scheduled, so it never clashes with its own old appointment).
- **`200`:** `{ "data": [{ id, reference, status, scheduledStart, scheduledEnd, serviceName, customerName }, …] }`, earliest first, empty when nothing overlaps. Asking for a whole day (midnight to midnight) lists that technician's jobs that day. It writes nothing and takes no lock: it is advice, and the schedule endpoint checks again.
- **Errors:** `404` (no such technician); `422` (a missing or invalid parameter, `end` not after `start`, a window over 7 days); `401`, `403`.

#### `PATCH /api/v1/admin/work-orders/:id/schedule`

- **Auth:** admin. **Limit:** `adminWrite`. **Body (strict):**

  | Field | Rule |
  | --- | --- |
  | `scheduledStart`, `scheduledEnd` | required, ISO 8601 instants with `Z` or an offset |
  | `technicianId` | required, the id of an **active** technician |
  | `expectedStatus` | required, the status the screen showed |
  | `reason` | **required when the job is `SCHEDULED`** (a reschedule), 5 to 200 characters, internal; not accepted for a first booking |

  A status, a reference, a customer or any unknown key is `422`.
- **Allowed from** `PENDING_SCHEDULING`, `NEEDS_RESCHEDULING` and `SCHEDULED`. In **one transaction**: the job's row is locked, then the technician's row is locked (`SELECT … FOR UPDATE`), the technician is checked, the technician's other `SCHEDULED`/`IN_PROGRESS` jobs are searched for an overlap, the status is changed by a conditional update, the history is written, and the customer is notified. Two schedulings of one technician therefore run one after the other: of two overlapping requests sent together **exactly one succeeds**. The email is queued and sent after the commit; a failing mail server never undoes the booking.
- **Checks, in order:** the times make sense, `422` (`scheduledEnd` is after `scheduledStart`; at most 12 hours; the start is not more than 15 minutes before now; each message is on the field) → `404` → `409 STALE_STATE` (`details.currentStatus`) → `409 INVALID_STATE_TRANSITION` (a job that is in progress, completed or cancelled) → `422` for the reason → `422` for an unknown technician (on `technicianId`) → `422 TECHNICIAN_INACTIVE` (also on `technicianId`) → **`409 SCHEDULING_CONFLICT`** → `422` if nothing would change.
- **`SCHEDULING_CONFLICT`** carries the message "*Jordan Lee is already booked for JOB-2026-00031 on Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST. Choose another time or technician.*" (the time on the business's clocks) and, in `details`, the first conflicting job: `conflictJobId`, `conflictReference`, `conflictStart`, `conflictEnd` (ISO instants) and `conflictCount`. The job is unchanged.
- **`200`:** `{ "data": job }`. **History** (entity `WORK_ORDER`, with the request's id and the customer's id): `work_order.scheduled` ("*Morgan Reyes scheduled job JOB-… for … with Jordan Lee.*" / customer: "*We scheduled your visit for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST.*"), or `work_order.rescheduled` ("*… rescheduled job JOB-… to … with … (was …). Reason: …*" / customer: "*We moved your visit to …*"), with metadata `workOrderReference`, `scheduledStart`, `scheduledEnd`, `technicianId` and, when there was an appointment, `previousScheduledStart`, `previousScheduledEnd` and `previousTechnicianId`. **The reason is in the staff line only**. **Notification** to the customer: `JOB_SCHEDULED` or `JOB_RESCHEDULED`, titled "*Visit for JOB-… scheduled*" / "*… rescheduled*", with the date and window and nothing else, linking to `/portal/jobs/:id`; and the `job-scheduled` or `job-rescheduled` email, with times in the business time zone. **Neither names the technician or the reason.**
- **Changing only the technician** (the same times, another technician) is recorded as `work_order.reassigned`, staff-only, and the customer is told nothing (their date and window did not change, and they never see a technician).
- **Errors:** as above; `401`, `403` (a customer, or a cross-origin write), `429`.

#### `POST /api/v1/admin/work-orders/:id/transitions`

- **Auth:** admin. **Limit:** `adminWrite`. Starts, completes, cancels or sends back for a new time. **Body (strict):** `action` and `expectedStatus` (the status the screen showed) are always required; the rest depends on the action, and **a field the action does not take is `422`** (blank optional text counts as absent):

  | `action` | Allowed from | Needs | May also carry |
  | --- | --- | --- | --- |
  | `START` | `SCHEDULED` | | |
  | `MARK_NEEDS_RESCHEDULING` | `SCHEDULED`, `IN_PROGRESS` | `reason` (5 to 200 characters, internal) | `customerMessage` (at most 500) |
  | `COMPLETE` | `IN_PROGRESS` | `completionNote` (10 to 2000 characters, **shown to the customer**) | `internalNote` (at most 2000, team only) |
  | `CANCEL` | `PENDING_SCHEDULING`, `SCHEDULED`, `NEEDS_RESCHEDULING` | `reason` (5 to 500 characters, internal) | `customerMessage` (at most 500) |

  A status, a timestamp, a technician or any other key is `422`; so are `SCHEDULE` and `RESCHEDULE` (they have their own endpoint). Text is trimmed.
- **In one transaction:** the job's row is locked; `expectedStatus` is checked (`409 STALE_STATE`, `details.currentStatus`, **before** the action is judged); the action is checked against the work-order transition table (`409 INVALID_STATE_TRANSITION`, `details.currentStatus` and `requestedStatus`; a job in progress cannot be cancelled and a job that is pending, scheduled or needing a time cannot be completed); the status changes by a **conditional update** on the status that was read; the history is written; the customer's notification is created; the email is queued and sent after the commit (a failing mail server never undoes the change, and a failing notification rolls everything back). Every refusal leaves the job, its history, its notifications and its emails exactly as they were. The checks run `422` (body) → `404` → `409 STALE_STATE` → `409 INVALID_STATE_TRANSITION`.
- **What changes:** `START` sets `startedAt` to the server's clock. `MARK_NEEDS_RESCHEDULING` clears `startedAt` and **keeps** `scheduledStart`/`scheduledEnd` and the technician as a reference (only `SCHEDULED` and `IN_PROGRESS` jobs hold a technician's time, so the old slot is free at once; the old appointment is also in the history metadata). `COMPLETE` sets `completedAt` and stores both notes; the job then appears under `view=ready-to-invoice`. `CANCEL` sets `cancelledAt` and `cancelReason`. The request stays `CONVERTED_TO_JOB` and the quotation `ACCEPTED`.
- **History** (entity `WORK_ORDER`): `work_order.started` ("*Morgan Reyes started job JOB-… before its scheduled start.*" when it was early / customer: "*We started work on your job.*"), `work_order.needs_rescheduling` (staff: the old time, "*The customer was sent a message.*" and "*Reason: …*" / customer: "*We need to find a new time for your visit.*"; metadata `previousScheduledStart`, `previousScheduledEnd`, `technicianId`), `work_order.completed` (customer: "*We marked your job as complete.*") and `work_order.cancelled` (staff has the reason). **No note and no reason is ever in a customer sentence, in metadata or in a notification.**
- **Customer notification and email** (`JOB_NEEDS_RESCHEDULING`, `JOB_COMPLETED`, `JOB_CANCELLED`; `START` sends none): titled "*Visit for JOB-… needs a new time*", "*Job JOB-… is complete*" and "*Job JOB-… was cancelled*", linking to `/portal/jobs/:id`. The emails (`job-needs-rescheduling`, `job-completed`, `job-cancelled`) are built from the job's reference, the service, the customer's name and a link; the first and last also take the optional `customerMessage`. Their input types have **no field** for a reason, an internal note or a technician, and the completion note is read on the job page, not in the email.
- **`200`:** `{ "data": job, "meta": { "startedBeforeSchedule": boolean } }`. `startedBeforeSchedule` is `true` when a `START` happened before the appointment's start: allowed, but the screen says so. It is `false` for every other action.
- **Errors:** as above; `401`, `403` (a customer, even for their own job, or a cross-origin write), `429`.

#### `GET /api/v1/work-orders/me`

- **Auth:** customer (an admin gets `403`). The signed-in customer's own jobs, in this order: a **booked or started visit** (`SCHEDULED`, `IN_PROGRESS`), the soonest first; then a **job waiting for a time** (`NEEDS_RESCHEDULING`, `PENDING_SCHEDULING`), the one that has waited longest first (a job that needs a new time keeps its old appointment in the table, but that time does not decide its place); then **finished and cancelled** jobs (`COMPLETED`, `CANCELLED`), the most recent visit first. The three are read as one list, so a page that crosses from one to the next never repeats or loses a row.
- **Query:** `page`, `pageSize` (default 20, at most 100); `group` = `upcoming` (the first two stretches) or `past` (the third), which is how the portal fills "Upcoming visits" and "Past jobs". A `sort` other than `scheduledStart` is `422` (there is no choice: the order is the list's). The owner is the session's: `customerId` in the query is ignored.
- **`200`:** the standard list envelope; each item is `{ id, reference, status, statusLabel, serviceName, scheduledStart | null, scheduledEnd | null, technician: { displayName } | null, completedAt | null }`. The visit (`scheduledStart`/`scheduledEnd`) and the technician are shown **only for `SCHEDULED`, `IN_PROGRESS` and `COMPLETED` jobs**; a job that needs a new time or was cancelled has neither. `displayName` is the technician's **first name**; their surname, phone, email and id are never in a customer shape.

#### `GET /api/v1/work-orders/:id`

- **Auth:** any signed-in user. The **owner** gets the customer's shape. **An admin gets the same shape** (a preview of what the customer sees). **Another customer gets `404`**, exactly like an id that does not exist, and the reference never opens a job (only the id does, and a reference is `422`).
- **`200`:** `{ "data": job }` (`CustomerWorkOrderDto`): the list item's fields plus `statusExplanation` (plain words: "*Your technician has started work.*", "*We need to find a new time for your visit…*"), `timeZone` (the business's IANA zone: the times are UTC instants, shown in it), `scopeDescription`, `address` (the customer's own, with their access notes), `previouslyScheduled` (`{ start, end }` for a job that needs a new time or was cancelled after being booked: history, not a booking; otherwise `null`), `startedAt`, `cancelledAt`, `completionNote` (**only once the job is `COMPLETED`**), `request` and `quotation` (`{ id, reference }`, to link back), `invoice` (the issued invoice that is not void as `{ id, invoiceNumber, status, statusLabel }`, or `null`) and `timeline` (the customer's history, oldest first).
- **Never in it:** `internalCompletionNote`, `cancelReason`, the staff who acted, any staff-only history event, the technician's id, surname or contact details, other customers' data. The query selects only the customer-safe columns, the serializer builds the shape field by field, and tests assert the exact key set and the absence of seeded secrets from this endpoint, the list, the customer's request page, their notifications and their emails.
- **Errors:** `401`; `404` (no such job, or not yours); `422` (not a UUID). A customer has no endpoint that changes a job (`POST`/`PATCH`/`DELETE` on `/work-orders/:id` are `404`).

#### The customer's request now links its job

`GET /api/v1/requests/:id` gains `job`: `{ id, reference, status, statusLabel } | null`, the job made from the request, so the portal can link to it. The admin request shape does not carry it.

### Scheduling calendar

#### `GET /api/v1/admin/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&technicianId=&includeUnbooked=`

- **Auth:** business admin only (`401`; `403` for a customer). Read-only: nothing is written and no history is recorded.
- **Query:** `from` and `to` (required) are days on the **business's calendar**, both inclusive, read in the business time zone whatever the zone of the caller or the server; `to` must not be before `from` and the span, both ends counted, is at most **42 days** (otherwise `422` with the message on `to`). `technicianId` (a UUID, optional) narrows the visits to one technician; an id that matches nobody gives no visits, not `404`. `includeUnbooked=true` also returns cancelled jobs and jobs that need a new time (they hold no technician's time); `false` or absent leaves them out; anything else is `422`.
- **`200`:** `{ "data": { from, to, timeZone, items, truncated, needsScheduling, needsSchedulingTotal } }`.
  - `items`: the visits whose **start** falls in the range with status `SCHEDULED`, `IN_PROGRESS` or `COMPLETED` (plus the two above with the flag), earliest first, at most **500**; `truncated` is `true` when more matched. Each: `id`, `reference`, `status`, `statusLabel`, `start` and `end` (UTC instants), `technician` (`{ id, name, calendarColor }`), `customerName`, `serviceName`, `city`, `availableActions`. No address, phone, email or note is in it.
  - `needsScheduling`: jobs in `PENDING_SCHEDULING` or `NEEDS_RESCHEDULING`, whatever the range and the technician, `NEEDS_RESCHEDULING` first and then the longest waiting, at most **20**; `needsSchedulingTotal` counts them all. Each: `id`, `reference`, `status`, `statusLabel`, `serviceName`, `customerName`, `city`, `scheduledStart` and `scheduledEnd` (the old appointment of a job that needs a new time, else `null`) and `technician` (or `null`).
- **Errors:** `401`, `403`, `422` (a missing or impossible date, `to` before `from`, more than 42 days, a bad `technicianId` or flag).
- Rescheduling from the calendar is `PATCH /admin/work-orders/:id/schedule`, unchanged: the reason, the `409 SCHEDULING_CONFLICT` and the `409 STALE_STATE` behave as described there.

### Invoices

The business's invoices: drafting from a completed job, editing, issuing with a number and a frozen snapshot, and voiding. Recording payments is in the next section; the customer's own invoice endpoints and the PDF are in "Customer invoices and the invoice PDF" below. Money is a decimal string next to `currencyCode`; `issueDate` and `dueDate` are `YYYY-MM-DD`; every other time is ISO 8601 UTC. Every endpoint is **admin-only** (a customer, and an admin no longer on the allowlist, get `403`; no session is `401`); the write endpoints are limited by `adminWrite`. The role check is on each route, because the router shares the `/admin` prefix with other modules. **There is no `DELETE`**: an invoice that exists stays in the history.

**The status table.** `DRAFT` → `ISSUED` or `VOID`; `ISSUED` → `OVERDUE` (the system, as time passes) or `VOID`; `OVERDUE` → `VOID`; `PARTIALLY_PAID` → `OVERDUE` (the system). `VOID` has no way out. Payments move an invoice between `ISSUED`, `PARTIALLY_PAID`, `OVERDUE` and `PAID` (trigger `PAYMENT`: ten more pairs, so a paid invoice can fall back when a payment is voided); no payment status leads to `VOID`. The table is data in `invoices.domain.ts`; `invoices.transitions.ts` is the only code that writes a status, always with an update conditional on the status that was read. A pair that is not allowed is `409 INVALID_STATE_TRANSITION`; an `expectedStatus` that is no longer the stored status is `409 STALE_STATE` (checked first).

**What an invoice is now.** `deriveInvoiceStatus` decides with the precedence `VOID > DRAFT > PAID > OVERDUE > PARTIALLY_PAID > ISSUED`: voided wins; never issued is a draft; a balance (`totalAmount − amountPaid`) of zero or less is `PAID`; a balance after the end of the due date is `OVERDUE` (partly paid or not); part paid is `PARTIALLY_PAID`; otherwise `ISSUED`. An invoice is due until **23:59:59 on `dueDate` in the business time zone** and overdue from the next local midnight (compared as dates, so a day on which the clocks change is still one day). The status in every response is that derived one, and the stored one is saved before any read of an invoice, the invoice list or a job (`syncOverdueInvoices`): `OVERDUE`, an event with no actor. It is idempotent, safe from concurrent reads, and notifies no one.

**Invoice numbers.** `INV-YYYY-NNNNN`, the year being the business's calendar year at the moment of issue. The number is taken inside the issuing transaction (`nextReference`), so if anything after it fails the counter rolls back with everything else: a number is never taken and lost, and a refused or failed issue leaves no gap. A voided invoice keeps its number, which is never reused.

#### `POST /api/v1/admin/work-orders/:id/invoice`

- **Auth:** admin. **Limit:** `adminWrite`. **Body:** `{}` (anything else is `422`). Starts a draft for a **completed** job, filled in from the quotation the customer accepted: its lines, discount and tax rate, its `currencyCode`, `issueDate` empty (it means "the day it is issued"), `dueDate` = today + `invoiceDueDays` on the business's calendar, and totals worked out by the shared calculation. No number yet.
- **`201`** with the admin invoice (below). **`404`** unknown job. **`409`**: the job is not `COMPLETED` (`INVALID_STATE_TRANSITION`), or it already has an invoice that is not void (`INVOICE_EXISTS`, `details.invoiceId`). The job's row lock makes two creates take turns, and the partial unique index `invoices_one_active_per_work_order_key` is the database's own refusal: concurrent creates give one `201` and `409 INVOICE_EXISTS` for the rest. After a void a new draft may be created.
- A job's `availableActions` includes `CREATE_INVOICE` while it is completed with no invoice that is not void, and its `invoice` is `{ id, invoiceNumber, status, statusLabel }` or `null`.

#### `GET /api/v1/admin/invoices`

- **Query:** `status` (one or several of `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOID`, repeated or comma-separated; the effective status), `customerId`, `q` (invoice number, customer name or job reference; case-insensitive; `%` and `_` are plain characters), `dueFrom`/`dueTo` and `issuedFrom`/`issuedTo` (days on the business's calendar, both ends inclusive; a draft has no issue date and is never in an issue range), `sort` (`createdAt` by default, `issueDate`, `dueDate`, `totalAmount`, `status`; an empty date sorts last either way) and `order`, `page`, `pageSize` (default 20, max 100). A range backwards, an unknown status or sort field, or a bad date is `422`.
- **`200`:** `{ "data": [...], "pagination": {...}, "meta": { "counts": { all, DRAFT, ISSUED, PARTIALLY_PAID, PAID, OVERDUE, VOID } } }`. The counts are for the search and filters in force **ignoring the status**, so each chip says what choosing it would show. Each row: `id`, `invoiceNumber` (`null` for a draft), `status`, `statusLabel`, `customerId`, `customerName`, `workOrderId`, `jobReference`, `issueDate`, `dueDate`, `currencyCode`, `totalAmount`, `amountPaid`, `balanceDue`, `daysOverdue` (whole business days past the due date; `0` unless overdue), `createdAt`.

#### `GET /api/v1/admin/invoices/:id`

- **`200`:** the admin invoice. Its fields: `id`, `invoiceNumber`, `status`, `statusLabel`, `currencyCode`, `taxRate`, `lines` (`{ id, position, description, quantity, unitPrice, taxable, lineTotal }`), `subtotal`, `discountAmount`, `taxableBase`, `taxAmount`, `totalAmount`, `amountPaid`, `balanceDue`, `issueDate`, `dueDate`, `daysOverdue`, `customerNote`, `isSnapshot`, `business`, `customer` (`{ name, email, address }`), `paymentInstructions`, `footer`, `serviceName`, `customerId`, `job`, `request`, `quotation` (`{ id, reference }`), `payments` (see Payments below; voided ones included), `createdAt`, `updatedAt` (the version a save sends back as `expectedUpdatedAt`), `issuedAt`, `createdBy`, `issuedBy`, `voided` (`{ at, by, reason }` or `null`; the reason is internal), `timeZone`, `timeline` (the staff history) and `availableActions` (`EDIT`, `ISSUE`, `VOID`, `RECORD_PAYMENT`, `VOID_PAYMENT`, the most likely first).
- **Snapshots.** While it is a draft, `business`, `customer`, `paymentInstructions` and `footer` are the **current** settings and customer (a preview; `isSnapshot` is `false`). Once issued they are the snapshot taken at the moment of issue, whatever the settings, the customer's name or the service price say later; `isSnapshot` is `true`. The service address on the snapshot never carries the access notes. **`404`** unknown id; **`422`** malformed id.

#### `PATCH /api/v1/admin/invoices/:id`

- **Auth:** admin. **Limit:** `adminWrite`. Drafts only. **Body (strict, every field required):** `lines` (1 to 50 of `{ description, quantity, unitPrice, taxable }`), `discountAmount`, `taxRate`, `issueDate` (`YYYY-MM-DD` or `null`), `dueDate` (on or after `issueDate` when one is given), `customerNote` (or `null`), `expectedUpdatedAt`. **A total cannot even be named**: `subtotal`, `taxableBase`, `taxAmount`, `totalAmount`, `amountPaid`, a line's `lineTotal` and every other unknown key are `422`. The server recomputes every total from the lines with the shared calculation and replaces the lines.
- **`200`** with the admin invoice. **`409 INVOICE_NOT_EDITABLE`** for an invoice that is issued or void (the record is untouched; the message says to void it and start a new one); **`409 STALE_STATE`** when `expectedUpdatedAt` is not the stored version (the update is conditional on it, so a save racing a save or an issue writes nothing). **`422`** names the fields (`lines.2.quantity`, `dueDate`, …).

#### `POST /api/v1/admin/invoices/:id/issue`

- **Auth:** admin. **Limit:** `adminWrite`. **Body:** `{ "expectedStatus": "DRAFT" }`. In one transaction, under the invoice's row lock: takes the next `INV-` number, sets `issuedAt`/`issuedBy`, `issueDate` (the one saved, or today on the business's calendar) and the due date, **snapshots** the business (name, address, contact), the customer (name, email, service address), the payment instructions and the footer, moves it to `ISSUED`, records the event (staff: "… issued invoice INV-… to …"; customer: "We issued invoice INV-…"), and notifies the customer (`INVOICE_ISSUED`, link `/portal/invoices/:id`, the customer's invoice page). **After the commit** the customer is emailed the invoice number, the total, the due date and the link (a failure is logged in `EmailDeliveryLog` and never reverses the issue).
- **`422`** names the field: no lines (`lines`), a total of zero (`totalAmount`), a due date before the day it is issued (`dueDate`); nothing is taken and the draft is unchanged. **`409 STALE_STATE`** when the invoice is no longer a draft: two issues at the same moment give one `200` and one `409`, one number, one notification, one email.

#### `POST /api/v1/admin/invoices/:id/void`

- **Auth:** admin. **Limit:** `adminWrite`. **Body:** `{ "reason": "5 to 500 characters", "expectedStatus": "<the status the screen showed>" }`. Allowed for `DRAFT`, `ISSUED` and `OVERDUE` invoices with **no active payment**; records `voidedAt`, `voidedBy` and the reason (internal), and the event. An invoice that had been issued tells the customer (`INVOICE_VOIDED`, a customer-safe message, and an email): the reason is not an input of the notification, the email or the customer's history, so it cannot reach them. A draft was never sent, so nobody is told. Afterwards the job has no live invoice and may be invoiced again.
- **`409 INVOICE_HAS_PAYMENTS`** when a payment that has not been voided is recorded against it (checked before the status table, so a paid invoice gets this answer, not a bare invalid-transition); **`409 INVALID_STATE_TRANSITION`** for an invoice that is already void; **`409 STALE_STATE`** when `expectedStatus` is not the stored status. Two voids at the same moment give one `200` and one `409`.

**Error codes added:** `INVOICE_EXISTS`, `INVOICE_NOT_EDITABLE` and `INVOICE_HAS_PAYMENTS` (all `409`).

### Payments

Manual payment records on an issued invoice: staff enter money the business **already received outside FixFlow**, and correct a mistake by voiding the payment and recording a new one. FixFlow takes, processes and verifies nothing: there is no gateway, no card or bank data and no refund or credit balance. Both endpoints are **admin-only** (a customer, even the invoice's own, gets `403`; no session is `401`), limited by `adminWrite`, and need a matching `Origin` (`403 CSRF_ORIGIN_MISMATCH`). **There is no `PATCH`, `PUT` or `DELETE` of a payment, and no `GET` of a collection**: those are `404`, and a test lists the router's routes to prove it. A payment is read through the invoice (`payments` on `GET /admin/invoices/:id`).

**One rule keeps the books right.** Every change takes the invoice's row lock (`SELECT … FOR UPDATE`) in one transaction and works from the stored `totalAmount` and the payments that have **not been voided**, never from a number the client sends or the stored `amountPaid`. `amountPaid` is then written as the sum of the active payments together with the status from `deriveInvoiceStatus` (the precedence `VOID > DRAFT > PAID > OVERDUE > PARTIALLY_PAID > ISSUED`, so a part payment on an overdue invoice leaves it `OVERDUE`). Two payments racing for one balance take turns: with 300.00 owed and two payments of 200.00 at once, exactly one is `201`, the other is `422 PAYMENT_EXCEEDS_BALANCE`, and `amountPaid` is 200.00. The database also refuses `amount_paid > total_amount`.

#### `POST /api/v1/admin/invoices/:id/payments`

- **Body (strict):** `{ "amount": "120.50", "paymentDate": "2026-03-02", "method": "BANK_TRANSFER", "reference"?: "…", "notes"?: "…" }`.
  - `amount` is **text**, digits with at most two places, above zero (`"120"` is read as `120.00`); a JSON number, a sign, an exponent, a thousands separator, zero and more than two places are `422` on `amount`.
  - `paymentDate` is `YYYY-MM-DD` and not later than **today in the business time zone** (`422` on `paymentDate`; the browser's clock is never used).
  - `method` is `CASH`, `BANK_TRANSFER`, `CARD_TERMINAL` (taken on a terminal outside FixFlow), `CHEQUE` or `OTHER`.
  - `reference` (at most 100 characters, one line) and `notes` (at most 500) are internal, blank means `null`, and are **never** card or bank credentials: the form says so. They are not written to the history, the notification, the customer's email or the logs.
  - `amountPaid`, `status`, a recorder, an invoice id and every other key are unknown fields: `422`. The recorder is the session's admin.
- **`201`** with the admin invoice (`payments` includes the new one; `status` is `PARTIALLY_PAID`, `OVERDUE` or `PAID`; `availableActions` is recomputed).
- **Errors, in this order:** `404` unknown invoice; `422` a malformed body; **`409 INVOICE_NOT_PAYABLE`** (`details.currentStatus`) when the invoice is not `ISSUED`, `PARTIALLY_PAID` or `OVERDUE`, with a message for a draft ("still a draft"), a void ("was voided") and a paid one ("already paid in full"), checked **before** the amount, so an overpayment on a paid invoice is `409`; `422` on `paymentDate` for a future date; **`422 PAYMENT_EXCEEDS_BALANCE`** when `amount` is more than what is still owed: `message` and `fieldErrors.amount` are "This payment exceeds the remaining balance of $200.00" and `details` is `{ remainingBalance: "200.00", currencyCode: "USD" }`. A refusal leaves the invoice, its payments, its history, its notifications and its emails exactly as they were.
- **Side effects, in the same transaction:** the payment row; `amountPaid` and the status (through the transition table, trigger `PAYMENT`); the history event `payment.recorded` on the invoice (staff: "Morgan Reyes recorded a payment of $100.00 received on Mar 2, 2026 (Cheque)"; customer: "We recorded your payment of $100.00 received on Mar 2, 2026"; metadata is `invoiceReference`, `amount`, `currencyCode`, `paymentMethod`, `paymentDate`, `amountPaid` and `balance` only); the customer's in-app notification (`PAYMENT_RECORDED`, link `/portal/invoices/:id`, "We recorded a payment of … The balance due is …" or "The invoice is now paid in full."). **After the commit** the customer is emailed (`payment-recorded`: amount, date, method, remaining balance; worded as "recorded", never "processed"); a mail failure is logged in `EmailDeliveryLog` and never reverses the payment.

#### `POST /api/v1/admin/invoices/:id/payments/:paymentId/void`

- **Body (strict):** `{ "reason": "5 to 500 characters" }`. Internal: the customer never reads it, and it is not in the history, the notification or the logs.
- Voids one **active** payment on an invoice that is not void. In one transaction under the invoice's lock it sets `voidedAt`, `voidedBy` and `voidReason`, recomputes `amountPaid` from the payments that still stand and the status (`PAID` falls back to `PARTIALLY_PAID`, `ISSUED` or, past the due date, `OVERDUE`), and records `payment.voided`. The payment **stays** in `payments` with its `voided` object (`at`, `by`, `reason`). The customer is told in the app (a reversal always raises the balance they see) with the new balance and no reason; no email is sent.
- **`200`** with the admin invoice. **`404`** unknown invoice, unknown payment, or a payment that belongs to another invoice. **`409 PAYMENT_ALREADY_VOIDED`** (two voids at once give one `200` and one `409`, and the balance rises once). **`409 INVALID_STATE_TRANSITION`** when the invoice itself is void. **`422`** a missing, short or long reason, or any other key.
- **Voiding the invoice** (`POST /admin/invoices/:id/void`) is `409 INVOICE_HAS_PAYMENTS` while any payment stands, and works once every payment is voided; the voided payments stay in the invoice's history.

**`payments` on the admin invoice** (oldest payment date first, then recorded): `{ id, amount, paymentDate, method, methodLabel, reference, notes, recordedBy: { name }, createdAt, voided: { at, by: { name } | null, reason } | null }`. **`availableActions`** now also lists `RECORD_PAYMENT` (issued, partly paid or overdue) and `VOID_PAYMENT` (any non-void invoice with an active payment): for example `["RECORD_PAYMENT", "VOID"]` for an issued invoice, `["RECORD_PAYMENT", "VOID_PAYMENT"]` once part is paid, `["VOID_PAYMENT"]` once paid in full.

**Error codes added:** `INVOICE_NOT_PAYABLE` (`409`), `PAYMENT_ALREADY_VOIDED` (`409`) and `PAYMENT_EXCEEDS_BALANCE` (`422`).

### Customer invoices and the invoice PDF

An invoice as its customer sees it, and the same invoice as a PDF. All three endpoints are **read-only** and live on `/api/v1/invoices`, beside the business's `/admin/invoices`. They need a session (no session is `401`). Whose invoice it is comes from the session, never from the path: **another customer's invoice, a draft and an id that does not exist are the same `404`**, and a malformed id is `422`.

**What a customer can be shown.** Only an invoice that **was issued** (it has an `issuedAt`): a draft is the business's working copy, and a draft that was voided before it was ever issued never reached the customer. An issued invoice the business later voided *is* shown, as `VOID`, with the day it was withdrawn and **no reason**. The status is what the invoice is now (overdue included): any overdue invoice that is due is saved before the list, an invoice or a PDF is read, and never before the caller has been authorized.

**What a customer is never sent.** The customer's serializers (`invoices.customer.dto.ts`) are explicit allowlists: the queries `select` these columns only, and each DTO is built field by field. The void reason, who created, issued or voided the invoice, the internal history, a payment's reference, notes and recorder, a voided payment and its reason, and any column added later cannot reach a customer because none is read. A test pins the exact key set of every shape and searches the whole response for internal words.

#### `GET /api/v1/invoices/me`

- **Auth:** customer (an admin gets `403`). **Query:** `status` (one or several of `ISSUED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOID`, repeated or comma-separated; `DRAFT` or anything else is `422`), `sort` (`issueDate` by default, `dueDate`, `totalAmount`), `order` (`desc` by default: newest first, then by the moment it was issued), `page`, `pageSize` (default 20, max 100). A `customerId` in the query is ignored.
- **`200`:** `{ "data": [...], "pagination": {...} }`. Each row: `id`, `invoiceNumber`, `status`, `statusLabel`, `issueDate`, `dueDate`, `currencyCode`, `totalAmount`, `amountPaid`, `balanceDue`, `daysOverdue`, `serviceName`, `jobReference`. The portal's Outstanding filter is `status=ISSUED,PARTIALLY_PAID,OVERDUE` and Paid is `status=PAID`.

#### `GET /api/v1/invoices/:id`

- **Auth:** the owner (an issued invoice) or an admin (an issued invoice: the shape the customer sees, as a preview). Anyone else, and a draft for anyone, is `404` (the admin's drafts are on `/admin/invoices/:id`).
- **`200`:** the customer invoice: the row's fields plus `taxRate`, `lines` (`{ id, position, description, quantity, unitPrice, taxable, lineTotal }`), `subtotal`, `discountAmount`, `taxableBase`, `taxAmount`, `customerNote`, `business`, `customer` (`{ name, email, address }`), `paymentInstructions`, `footer`, `job` and `request` (`{ id, reference }`), `payments`, `paidOn`, `voidedAt` and `timeZone`. `business`, `customer`, `paymentInstructions` and `footer` are the **snapshot taken at issue**: changing the settings, the customer's name or the job's address later changes none of them.
- **`payments`** lists the payments that **stand**, oldest first: `{ id, paymentDate, method, methodLabel, amount }`. A payment the business voided is **omitted**, and `amountPaid` and `balanceDue` are already the totals without it. `paidOn` is the day of the last of them once the invoice is paid in full, and `null` otherwise.

#### `GET /api/v1/invoices/:id/pdf`

- **Auth:** the same as the invoice above, except that an **admin may also download a draft** (watermarked `DRAFT`) and a draft that was voided before it was issued (watermarked `VOID`). **Limit:** `invoicePdf` (30 per hour per user). **Query:** `inline=1` asks for the browser to show it instead of saving it; any other value is `422`.
- **Order of work:** the body of the request and the path are validated; the caller is **authorized from the owner's id alone** (a refused caller costs one small query: nothing is saved, built or read for them); any overdue invoice that is due is saved; the invoice is read and the PDF is built from that persisted row only. It writes nothing, so a builder failure leaves every record as it was and answers `500 INTERNAL_ERROR` with the generic message (the cause is logged on the server, never sent), without any PDF header.
- **`200`:** the file, with `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="INV-2026-00012.pdf"` (`inline; …` with `?inline=1`; `invoice-draft.pdf` for a draft), `Content-Length`, `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
- **The document.** Built in-process by `pdfmake` (no headless browser, so it fits a 512 MB server), page 8.27 × 11 in (as wide as A4 and as tall as Letter, so either paper holds it), Inter from bundled TTF files and the business's bundled logo (an SVG for each logo key); **no remote address is ever fetched** (a business's logo web address is ignored, and pdfmake's URL and file policies refuse everything else). It prints the business, the logo, "Invoice", the number, the status (a `VOID` or `DRAFT` watermark), who it is billed to, the service, the job and request references, the issue and due dates (and how many days overdue), the lines with right-aligned amounts, the subtotal, discount, tax with its rate, total, amount paid and balance due, the payments that stand, "Paid in full on …", the customer note, how to pay with "Payments are made directly to …; FixFlow doesn't process payments." (not on a void invoice), the footer and "Page n of m". Every string is drawn as text, never as markup.

**The customer's job** (`GET /api/v1/work-orders/:id`) carries `invoice`: `{ id, invoiceNumber, status, statusLabel }` for the issued invoice that is not void, and `null` otherwise. The customer's invoice notifications and emails link to `/portal/invoices/:id`.

**Limit added:** `invoicePdf`, 30 requests per hour per signed-in user (a PDF is built on every request).

### Dashboard, the customer overview and CSV exports

Every figure is read from the database for the request, on the business's calendar; nothing is cached or hard-coded. The expiry and overdue syncs run first, so an expired quotation or an overdue invoice is counted as what it is.

#### `GET /api/v1/admin/dashboard/summary?range=today|7d|30d`

- **Auth:** admin only (`401`, `403`). **Query:** `range` (default `7d`); anything else is `422`. Read-only, no write limit.
- **Response `200`:** `{ "data": AdminDashboardSummaryDto }`
  - `period`: `{ range, from, to }`, the first and last day (`YYYY-MM-DD`, inclusive) on the business's calendar. `today` is one day; `7d` and `30d` are the last 7 and 30 calendar days, today included. The bounds are the start of each day looked up for that day, so a period that crosses a change of the clocks is still whole days.
  - `today`, `timeZone`, `currencyCode`, `generatedAt` (the server's clock), `isFresh` (no request exists at all).
  - `kpis`: five figures, each with `label`, `definition` (plain language), `link` (a path whose filters reproduce the figure) and `scope` (`range` or `current`).
  - `needsAttention`: `{ items, totalItems, counts }`. `items` is at most 15, most urgent kind first, longest-waiting first inside a kind. Each item: `id`, `type`, `title` (reference and customer's name), `context` ("AC Repair · submitted 2 h ago", "overdue by 6 days"), `link`, `actionLabel`, `amount` (the balance, for an overdue invoice) and `since`.
  - `upcomingSchedule`: the next 8 booked jobs (time, reference, customer's name, service, technician, link).
  - `recentActivity`: the latest 10 activity events, in the staff shape, each with a `link` where the record has a page.

**The KPIs (the definitions are the queries):**

| KPI | Counts | Scope | Link |
|---|---|---|---|
| New requests | requests with `submittedAt` inside the period | range | `/app/requests?submittedFrom=…&submittedTo=…` |
| Requests needing action | requests in `SUBMITTED`, `UNDER_REVIEW` (a request with a quotation out is `QUOTED`), `ACCEPTED` (not yet a job: a job makes it `CONVERTED_TO_JOB`) or `DECLINED` (not yet closed: closing makes it `CANCELLED`) | current | `/app/requests?status=SUBMITTED,UNDER_REVIEW,ACCEPTED,DECLINED` |
| Jobs today | `SCHEDULED` or `IN_PROGRESS` jobs whose `scheduledStart` is today; `upcomingCount` is the same kind starting on the 7 days after today | current | `/app/jobs?view=all&status=SCHEDULED,IN_PROGRESS&scheduledFrom=<today>&scheduledTo=<today+7>` (both together) |
| Completed, awaiting invoice | `COMPLETED` jobs with no invoice other than a `VOID` one | current | `/app/jobs?view=ready-to-invoice` |
| Unpaid balance | the sum of (total − amount paid) over `ISSUED`, `PARTIALLY_PAID` and `OVERDUE` invoices in the business's currency, with the `OVERDUE` count and amount | current | `/app/invoices?status=ISSUED,PARTIALLY_PAID,OVERDUE` (overdue: `?status=OVERDUE`) |

A job that needs a new time keeps its old appointment as a reference, so every count reads the **status**, never "has a time". Money is added in decimal arithmetic and returned as a string.

**The needs-attention kinds, in priority order:** `OVERDUE_INVOICE` (status `OVERDUE`, most overdue first; links to the invoice), `JOB_TODAY_NOT_STARTED` (`SCHEDULED` with its start today; links to the job), `NEW_REQUEST` (`SUBMITTED`; the request), `ACCEPTED_QUOTATION` (request `ACCEPTED`; the request, where "Create job" is), `JOB_NEEDS_SCHEDULING` (`PENDING_SCHEDULING` or `NEEDS_RESCHEDULING`; the job with the scheduling dialog open), `JOB_AWAITING_INVOICE` (ready to invoice; the job) and `QUOTATION_EXPIRING` (`SENT`, last valid day today to 2 days ahead; the quotation). `counts` gives how many of each exist, so the screen can say how many are not shown.

#### `GET /api/v1/customers/me/overview`

- **Auth:** customer only (`401`; `403` for an admin). The customer is found from the session; there is no id in the request.
- **Response `200`:** `{ "data": CustomerOverviewDto }`: `actionRequired.quotations` (sent and unanswered, soonest to run out first, 5), `actionRequired.invoices` (still owing, soonest due first, 3), `upcomingVisits` (3), `recentRequests` (3, newest first), each as `{ items, totalItems }` in the **customer's** shapes, and `counts: { actionRequired, upcomingVisits, requests }`. It is composed from the customer's own list functions, so it holds nothing another customer's list would not.

#### `GET /api/v1/admin/exports/requests.csv`, `jobs.csv`, `invoices.csv`

- **Auth:** admin only. **Limit:** `adminExport` (10 per minute per admin). **Query:** the matching list's own (`/admin/requests`, `/admin/work-orders`, `/admin/invoices`: search, status or view, dates, technician, sort); `page` and `pageSize` are accepted and ignored, because an export is the whole list. A bad filter is `422`, as for the list.
- **Response `200`:** `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="fixflow-<kind>-<YYYY-MM-DD>.csv"` (the business's today), `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`. Streamed in batches of 500 rows; the first batch is read before the headers go out, so a failure is a normal error response, and one after that cuts the connection (logged).
- **Format:** UTF-8 with a byte-order mark (so Excel reads accents), CRLF line ends, RFC 4180 quoting (a field with a comma, a double quote or a line break is quoted, and a quote is doubled). **Formula injection:** a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a `'` in front.
- **Columns (operational fields only; no email, phone, street address, access note, description or internal note):** requests: Reference, Status, Submitted, Service, Customer, City, Preferred date, Last updated. Jobs: Reference, Status, Service, Customer, City, Scheduled start, Scheduled end, Technician, Completed, Created. Invoices: Invoice number, Status, Job, Customer, Issue date, Due date, Currency, Total, Paid, Balance due, Days overdue. Times are `YYYY-MM-DD HH:mm` on the business's clocks; the customer is the name alone.
