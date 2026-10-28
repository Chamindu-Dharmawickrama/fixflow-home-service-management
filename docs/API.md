# FixFlow — API Reference and Conventions

The REST API is an Express 5 application in `apps/server`. This document describes the conventions every endpoint follows (decisions D-33, D-34, D-12, D-57) and, at the end, the endpoint reference. Conventions are implemented by the platform code in `apps/server/src` (see [ARCHITECTURE.md](ARCHITECTURE.md)); error codes, limits and envelope types live in `@fixflow/shared`.

**Status:** only the conventions and `GET /health` exist (T02). Each later task adds its endpoints to the [reference](#endpoint-reference).

## 1. Base URL and transport

- Every route is under **`/api/v1`**. Anything else returns the `404` error body below.
- The browser never calls the API origin directly. It calls `/api/v1/*` on the web origin, and Next.js rewrites that to `${API_INTERNAL_URL}/api/v1/*` (D-06). Server Components call `API_INTERNAL_URL` directly and forward the `cookie` header.
- Request and response bodies are JSON (`application/json`). Request bodies are limited to **100 kb**. The body parser is strict: a top-level JSON primitive or malformed JSON is rejected.
- Primary keys are UUIDs. The human-readable references (`FF-`, `QT-`, `JOB-`, `INV-`) are display identifiers only and never authorize anything.
- Authentication and CSRF (`Origin` check) arrive in T05. Until then no endpoint is protected.

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

Money is a decimal **string** with an explicit `currencyCode` (`"1234.50"`), timestamps are ISO 8601 UTC (`2026-03-02T09:00:00.000Z`), and date-only fields are `YYYY-MM-DD`. These apply to the domain endpoints added by later tasks.

## 4. Status codes and error codes

| Status | `error.code`                                  | Used for                                                                                          |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `400`  | `BAD_REQUEST`                                 | Malformed request, for example invalid JSON or a top-level JSON primitive.                         |
| `401`  | `UNAUTHENTICATED`                             | No valid session (T05).                                                                           |
| `403`  | `FORBIDDEN`                                   | Authenticated but the role is not allowed, or the CSRF check failed (T05).                        |
| `404`  | `NOT_FOUND`                                   | The route or resource does not exist, **or is not owned by the caller** (prevents ID probing).    |
| `409`  | `CONFLICT`, `STALE_STATE`, `INVALID_STATE_TRANSITION` | The request conflicts with the record's current state. `STALE_STATE`: the record changed since it was loaded (`expectedStatus`, D-46). |
| `413`  | `PAYLOAD_TOO_LARGE`                           | Body larger than 100 kb.                                                                          |
| `422`  | `VALIDATION_ERROR`                            | Well-formed JSON whose values fail validation. Includes `fieldErrors`.                            |
| `429`  | `RATE_LIMITED`                                | A rate limit was exceeded. Includes a `Retry-After` header (seconds).                             |
| `500`  | `INTERNAL_ERROR`                              | Unexpected failure. The message is always generic; the cause is logged server-side only.          |

Later tasks add domain codes (for example authentication and quotation codes) to `ErrorCode`.

Unexpected errors never leak: a `500` body contains no stack trace, no exception message and no `fieldErrors`. The error is logged with its stack, tied to the request ID.

## 5. Validation

Route parameters, query strings and bodies are validated with Zod (`validate({ params, query, body })`). On success the parsed values (coerced, defaulted, with unknown query keys stripped) replace the raw input. On failure the API returns `422 VALIDATION_ERROR` with `fieldErrors`.

- **Body schemas are strict.** An unknown key is an error, reported on the key itself as `"Unknown field."` (so a client cannot, say, send `role` and have it silently ignored). Query strings are not strict: unknown query keys are ignored.
- **Keys are dotted paths** into the request: `customerName`, `lines.2.quantity`, `lines.0.price`. For parameters and query strings the key is the parameter name (`orderId`, `pageSize`). Issues that belong to no single field use the key `_`.
- **One message per field** (the first issue). Messages never echo the rejected value.
- A request with no JSON body is validated as `{}`, so each missing required field is reported rather than one vague error.
- Limits such as quantity, price, line-item count and text lengths are the `LIMITS` constants in `@fixflow/shared` (D-20).

## 6. Pagination and sorting

List endpoints accept these query parameters (D-34). They come from one schema factory, `createPaginationSchema`, so every list behaves the same.

| Parameter  | Default                     | Rules                                                                 |
| ---------- | --------------------------- | --------------------------------------------------------------------- |
| `page`     | `1`                         | Whole number, 1–100,000.                                              |
| `pageSize` | `20`                        | Whole number, 1–**100**.                                              |
| `sort`     | endpoint-specific           | Must be one of the endpoint's allowlisted fields.                     |
| `order`    | endpoint-specific           | `asc` or `desc`.                                                      |

Values must be plain digits (`1e2`, `+5`, `0x10` and repeated parameters are rejected). Any invalid value returns `422` with the parameter in `fieldErrors`. `totalPages` is `ceil(totalItems / pageSize)`, and `0` when there are no items. Asking for a page past the end returns an empty `data` array. Results are ordered by the requested field and then by `id`, so rows never repeat or disappear between pages.

Filters live beside these in the same query string and are validated by the endpoint's own schema.

## 7. Rate limiting

Rate limiting uses a sliding window. It is distributed through Upstash Redis in production and in-process in development and test (D-12). Exceeding a limit returns `429 RATE_LIMITED` with a **`Retry-After`** header (whole seconds until the caller may retry).

Every named limit is defined in one map, `RATE_LIMITS` in `apps/server/src/lib/rate-limit/limits.ts`:

| Name     | Limit            | Keyed by  | Applies to                  | Added in |
| -------- | ---------------- | --------- | --------------------------- | -------- |
| `global` | 300 requests / 60 s | client IP | every request, before routing | T02      |

Later tasks add their limits to the same map (login, registration, request submission, quotation decisions, …).

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
- Logs never contain cookies, `Authorization` headers, `Set-Cookie` values, request bodies, query strings, or fields named `password`, `newPassword`, `currentPassword`, `credential`, `token` or `secret`.

## Endpoint reference

Each entry will list method and path, authentication and role, request schema, response, and the errors it can return. Authentication, CSRF and ownership rules are described in the T05 section when it lands.

### System

#### `GET /api/v1/health`

Liveness check. It never touches a database or any other dependency (D-14), so the hosting platform's health check does not wake the database.

- **Auth:** none
- **Response `200`:** `{ "data": { "status": "ok" } }`

_(The readiness check, `GET /api/v1/health/ready`, is added in T03 together with the database.)_

### Authentication

_To be added in T05._

### Public catalogue and settings

_To be added in T07._

### Customers, requests, quotations, work orders, invoices, payments, technicians, dashboard

_To be added by T10–T23._
