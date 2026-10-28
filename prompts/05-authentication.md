# T05 — Authentication, Sessions and Access Control

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T05 |
| Title | Authentication, sessions and access control (email/password and Google Sign-In) |
| Phase | 2 — Identity, configuration and public experience |
| Objective | Let customers and admins register and sign in with **either** a local email/password **or** Google, recover access through an emailed password reset, and use the seeded demo accounts through the same real login form. Maintain server-side sessions in first-party HTTP-only cookies, enforce role and ownership on the server, defend against CSRF and brute force, and give the web app protected, role-aware areas. |

## B. Context

- Read first: `CLAUDE.md` §7–§9; spec §4.2, §8.2, §9.1 (`/login`, `/register`), §9 (navigation note), §14.1, §15.1, §15.2, §19.2.
- Decisions:
  - D-07 (dual authentication), D-09 (demo accounts), D-49 (account creation), D-51 (password handling): **ACCEPTED** by the owner on 2026-10-28
  - **D-08 (admin allowlist, PROPOSED)**: confirm with the user before starting
  - D-06 (rewrite proxy), D-10 (sessions), D-11 (CSRF), D-12 (rate limits), D-13 (email adapter, whose minimal part is built here), D-52 (reserved-domain email policy), D-40, D-41
- Requirements: FR-010, FR-011, FR-012, FR-014, FR-015, FR-032, BR-01, BR-03, BR-04, BR-21, SEC-AUTH-01/02/03/04/06, SEC-DATA-06, IA-P04, IA-P05, IA-P07, IA-A01 (interim), IA-C01 (interim), IA-X01, TS-UNIT-06, TS-INT-01, DD-03, CFG-03, CFG-04 (minimal).

## C. Prerequisites

- T03 `COMPLETED` (the `User`, `Session`, `PasswordResetToken`, `CustomerProfile` and `EmailDeliveryLog` tables exist, and the demo accounts are seeded) and T04 `COMPLETED` (shells and components).
- Optional: a Google OAuth **Web** client ID with authorized JavaScript origin `http://localhost:3000`. Without one, local sign-in works fully; Google is built and tested with the fake verifier, and the manual Google check is recorded as pending.
- SMTP is optional. Without it, use `EMAIL_TRANSPORT=log`; reset links appear in `.data/outbox/`.

## D. Scope

**In scope — API**
- Env (add to the T02 schema and `.env.example`):
  - `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS` (comma-separated, normalized)
  - `SESSION_SECRET` (≥ 32 chars; HMAC key for session and reset-token hashes); `SESSION_COOKIE_NAME` derived: `__Host-fixflow_session` in production, `fixflow_session` otherwise
  - `DEMO_MODE`, `PUBLIC_SIGNUP_ENABLED` (default `true`)
  - `DEMO_ADMIN_PASSWORD`, `DEMO_CUSTOMER_PASSWORD` (used by the seed; never defaulted in production)
  - email: `EMAIL_TRANSPORT` (`log`|`smtp`), `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `PUBLIC_WEB_URL`
- `src/lib/password.ts` (hash and verify already exist from T03): add the password policy validator (10–128 chars, not equal to the email, not in a bundled common-password list).
- **Minimal email module** `modules/email` (T06 extends it):
  - `EmailSender` interface `send({ to, subject, html, text })`
  - `SmtpEmailSender` (Nodemailer, timeouts, TLS per `SMTP_SECURE`) and `LogEmailSender` (masked recipient in logs; full HTML/text written to `.data/outbox/` outside production; status `LOGGED`)
  - the D-52 reserved-domain check (`.test`, `.example`, … always use the log transport)
  - `escapeHtml` and a password-reset template (business name from settings, plain accessible HTML and text)
  - a small `sendAndLog()` helper that writes an `EmailDeliveryLog` row (`PENDING` → `SENT`/`LOGGED`/`FAILED`) and never throws to the caller
- `modules/auth` endpoints:
  - `POST /api/v1/auth/register { name, email, password, passwordConfirmation, acceptTerms }`:
    - strict schema; `acceptTerms` must be `true`; passwords must match and pass the policy
    - `PUBLIC_SIGNUP_ENABLED=false` → `403 SIGNUP_DISABLED`
    - an email in `ADMIN_EMAILS` → `422` with the generic D-08 message; an existing email → `409 EMAIL_TAKEN` ("An account already exists for this email — sign in or reset your password")
    - creates a `CUSTOMER` with a `CustomerProfile`, `passwordHash` and `termsAcceptedAt`, then signs the user in (session and cookie); returns `201 { data: { user } }`
  - `POST /api/v1/auth/login { email, password }`:
    - normalize the email; verify the hash, using a constant-cost dummy verify when the user does not exist or has no password, to avoid timing enumeration
    - any failure → `401 INVALID_CREDENTIALS` with the generic message
    - inactive user → `403 ACCOUNT_DISABLED`, only after a correct password
    - success: session and cookie; `lastSignInAt`
  - `POST /api/v1/auth/google { credential }`:
    - verify through the injectable `GoogleIdTokenVerifier` (real implementation with `google-auth-library`: audience, issuer, expiry, `email_verified`)
    - find by `googleSubject`; otherwise link to the existing user with the same normalized email, applying the D-51 pre-hijacking rule (unverified local account → clear `passwordHash`, revoke sessions, set `emailVerifiedAt`); otherwise create a user
    - role: allowlisted → `BUSINESS_ADMIN`; otherwise `CUSTOMER` with a profile (subject to `PUBLIC_SIGNUP_ENABLED` for new customers)
    - inactive → `403`; unverified Google email → `403`; bad credential → `401 INVALID_GOOGLE_CREDENTIAL`
    - returns `{ data: { user, isNewUser } }`
  - `POST /api/v1/auth/password/forgot { email }`: always `200` with the same message. For an existing, active account (not a demo account while `DEMO_MODE`) it invalidates older tokens, creates a `PasswordResetToken` (D-51) and emails the link `${PUBLIC_WEB_URL}/reset-password?token=…`. In production with no SMTP configured, the response states that reset is unavailable and no token is created.
  - `POST /api/v1/auth/password/reset { token, password, passwordConfirmation }`: an invalid, expired or used token → `400 INVALID_RESET_TOKEN`. Otherwise set the hash, mark the token used, set `emailVerifiedAt`, revoke **all** of the user's sessions, then return `200`; the user signs in again.
  - `POST /api/v1/auth/password/change { currentPassword, newPassword, newPasswordConfirmation }` (authenticated users with a password): verify the current password, apply the policy, and revoke the user's **other** sessions. Demo accounts get `403 DEMO_ACCOUNT_LOCKED` while `DEMO_MODE` is on.
  - `POST /api/v1/auth/logout`: delete the session and clear the cookie (idempotent).
  - `GET /api/v1/auth/me`: `{ user: { id, name, email, avatarUrl, role, hasPassword, hasGoogle }, customer?: { id, phone } }`, or `401`.
- **Session middleware:** read the cookie, then HMAC-SHA-256 hash it, then look up the session and user in one query. Reject expired sessions and inactive users. Rolling renewal: extend `expiresAt` to 7 days when the last renewal was more than 1 h ago. Attach `req.auth = { userId, role, customerId? }`. Expired sessions are deleted opportunistically.
- **Cookie:** `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, `Max-Age` 7 days, no `Domain` attribute (it stays first-party behind the proxy).
- **Guards:** `requireAuth`, `requireCustomer`, `requireAdmin` (role check plus a current allowlist re-check, with no exemptions). Ownership helper `assertCustomerOwns(resourceCustomerId, auth)` throws `NOT_FOUND`.
- **CSRF** middleware (D-11) on all unsafe methods, wired globally. Update the test harness so helpers send `Origin: WEB_ORIGIN`.
- **Rate limits** (named and configurable per T02):
  - `login`: 5 failures per 15 min per (IP + email), plus 20/min per IP
  - `register`: 5/hour per IP
  - `google`: 10/min per IP
  - `forgot`: 3/hour per email and 10/hour per IP
  - `reset`: 10/hour per IP
  - `logout`: 30/min
- **Seed check:** the T03 seed already hashes the demo-account passwords from env. Confirm that the demo passwords satisfy the new policy, and add the demo admin email to the example `ADMIN_EMAILS` in `.env.example`.
- Add the auth error codes to `@fixflow/shared`.

**In scope — Web**
- `src/lib/api`:
  - browser client: fetch to the relative `/api/v1`, JSON, credentials `same-origin`, typed results, `ApiError` with `code`/`fieldErrors`/`requestId`
  - server client: `API_INTERNAL_URL`, forwards the incoming `cookie` header, `cache: "no-store"` for authenticated reads
  - `getCurrentUser()` server helper
- `src/lib/auth`: `sanitizeReturnTo()` (relative paths only; rejects `//`, schemes and backslashes), role home paths, and a route-protection helper.
- **Route protection:** the Next.js middleware/proxy file (named for the installed Next version) redirects requests without the session cookie on `/app/*` and `/portal/*` to `/login?returnTo=…`. Layouts then call `/auth/me`:
  - a customer on `/app/*` sees the `PermissionDenied` page with a link to the portal
  - an admin on `/portal/*` is redirected to `/app/dashboard`
  - a missing or invalid session redirects to login

  The server remains authoritative.
- **`/login`** (AuthLayout):
  - email and password form with labels, show/hide password, inline errors, the generic error message, and a loading state
  - a "Forgot password?" link
  - a divider, then the Google Identity Services button (loaded with `next/script`; Google branding guidance; `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; hidden with an explanation if no client ID is configured)
  - when `NEXT_PUBLIC_DEMO_MODE` is set:
    - a **"Demo accounts"** panel listing the admin and customer credentials, whose "Use this account" buttons **fill the form** (the user then presses Sign in)
    - the notice "Public demo — use fictional details; other visitors can see what you enter"
  - after sign-in, redirect to the sanitized `returnTo` or the role home
- **`/register`:** name, email, password and confirmation (with a strength hint and the policy explained), a required terms/privacy checkbox (link to `/privacy` once T08 creates it; until then show the notice text inline), a create-account button, and "Continue with Google" with the terms notice beside it. `SIGNUP_DISABLED` shows a clear message.
- **`/forgot-password`:** an email form and the same confirmation message for every input ("If an account exists for that email, we've sent a reset link"). In development, note that links are written to `.data/outbox/`.
- **`/reset-password?token=`:** new password and confirmation, invalid/expired-token state with a link to request a new one, success, then a link to sign in.
- **`ChangePasswordForm` component**, mounted at `/app/account` for admins (a small account page with name, email and sign-in methods). T10 mounts the same component in `/portal/profile` for customers. If the user has no password, show "Set a password" linking to the forgot-password flow.
- **Shell wiring:** the user menu (name, avatar or initials, role label, "Account" for admins, "Sign out") calls logout and returns home, with role-aware nav from the T04 config. The public header shows "Sign in" or "Dashboard"/"My account" depending on the session.
- **E2E harness**, the first E2E suite that needs data:
  - add a separate `fixflow_e2e` database to `docker-compose.yml` (init script) and an `E2E_DATABASE_URL`
  - extend the T03 guard so resets are allowed only for `TEST_DATABASE_URL` or `E2E_DATABASE_URL`
  - Playwright global setup migrates, resets and base-seeds the E2E DB (with demo passwords from the E2E env), then starts the API with `DEMO_MODE=true`, `EMAIL_TRANSPORT=log` and relaxed rate limits (T02 overrides), and starts the web app with `NEXT_PUBLIC_DEMO_MODE=true`
  - a `loginAs(page, "admin" | "customer" | "customer-b")` helper that **uses the real login form**
  - an `e2e/fixtures` helper that inserts scenario fixtures directly into the E2E DB (reusing API seed/factory helpers), and a helper that reads the latest outbox email to extract the reset link. **Never** add test-only endpoints to production code.
- **Interim home pages**, which are real and honest:
  - `/app/dashboard`: "Welcome, {name}" with a short description of what the admin area will contain as features ship. No fake metrics; T23 replaces it.
  - `/portal`: a greeting and the account summary; T10/T11 extend it.

**Out of scope**
Profile editing and addresses (T10), notifications and the after-commit email dispatcher (T06), email verification and email change (D-39), technician login (FR-063), admin user management UI, multi-factor authentication.

## E. Implementation instructions

1. Inspect the T02 middleware chain and rate limiter, the T03 schema and seed, and the T04 shells and nav config. Confirm D-08 with the user.
2. Implement the API side first, test-first for the password policy, session middleware and guards. Then implement local register/login, then Google with the fake verifier, then forgot/reset/change, then logout and me.
3. Cover these Google cases with the fake verifier: new customer, existing user by subject, link to a **verified** local account, link to an **unverified** local account (password cleared, sessions revoked), allowlisted admin, unverified Google email (403), verifier failure (401).
4. Never log passwords, the Google credential, reset tokens, session tokens or cookies. Confirm that the T02 redaction covers `password`, `passwordConfirmation`, `currentPassword`, `newPassword`, `token` and `credential`, and add a test.
5. Implement the web clients and helpers, then the middleware/proxy, then the auth pages, then shell wiring, the account page and the interim homes, then the E2E harness and specs.
6. If a Google client ID is available, sign in manually at `http://localhost:3000/login`, and record the outcome.
7. Update `.env.example` in both apps, `docs/API.md` (auth endpoints, cookie, CSRF, rate limits, error codes), `docs/ARCHITECTURE.md` (auth flows: local, Google, linking, reset — with a sequence diagram) and the README (auth setup, Google client ID, demo accounts, the outbox for reset links).

## F. Quality requirements

- Use a cryptographically secure RNG (`crypto.randomBytes(32)`) for session and reset tokens. Store only HMAC hashes.
- Never trust the client for role, user ID or customer ID. FR-014 is enforced by strict schemas and by sourcing identity only from the session.
- No account enumeration through login or forgot-password responses or their timing. Registration may reveal that an email is taken (documented UX trade-off, rate limited).
- An open-redirect attempt (`returnTo=https://evil.test`, `//evil.test`, `/\evil`) falls back to the role home; a unit test covers it.
- Authorization failures leak nothing: other users' resources return `404`, wrong roles return `403`.
- The auth UI is polished (FixFlow brand, clear copy, accessible labels and errors, password managers work via correct `autocomplete` attributes) with no dead buttons. The demo panel appears only in demo mode.

## G. Acceptance criteria

1. **Local auth** (integration):
   - registration creates a customer with a profile and `termsAcceptedAt`, signs them in, and sets a cookie with the required attributes
   - mismatched or weak passwords, `acceptTerms: false` and unknown keys (including `role`) → 422
   - a duplicate email → 409; an allowlisted email → 422 (no admin created); `PUBLIC_SIGNUP_ENABLED=false` → 403
   - login with correct credentials succeeds; a wrong password, unknown email and Google-only account all return the same 401 body
   - no plaintext password is stored (the hash is Argon2id)
2. **Google** (integration): every case in E.3 passes. Normalized-email uniqueness holds: `Alex.Morgan@Example.Test` maps to the same user via both methods.
3. **Password reset and change** (integration):
   - `forgot` returns the identical 200 body for existing and unknown emails and creates a token only for existing accounts
   - the outbox contains the link; the token is single-use and expires after 60 min (clock test)
   - reset revokes all sessions and sets `emailVerifiedAt`
   - change password requires the correct current password and revokes other sessions
   - demo accounts get 403 for change and forgot while `DEMO_MODE` is on
4. **Sessions and guards** (integration):
   - `/auth/me` returns 401 with no cookie, with a tampered cookie and with an expired session
   - logout invalidates the session; rolling renewal extends expiry
   - removing an admin's email from the allowlist makes `requireAdmin` return 403
   - a customer gets 403 on an admin-guarded probe route (test-only router in the test harness)
   - an unsafe request with the wrong `Origin` gets 403
   - login failures and the other auth endpoints return 429 after their limits
5. **Seed:** demo accounts have hashed passwords from env; the seed refuses when the demo password variables are missing; no password literals exist in source (grep).
6. **Web** (E2E):
   - unauthenticated `/app/dashboard` redirects to `/login?returnTo=%2Fapp%2Fdashboard`; signing in with the demo admin via the form lands back there
   - a demo customer accessing `/app/dashboard` sees PermissionDenied; an admin accessing `/portal` is redirected to `/app/dashboard`
   - a new visitor registers locally and lands in the portal
   - forgot → outbox link → reset → sign in with the new password works (for a non-demo test account)
   - the demo panel fills the form; sign-out returns to `/` and protected pages redirect again
7. Customers never see admin nav items; the public header reflects the session state. The Google button renders with a configured client ID; the manual Google sign-in result is recorded, or marked pending.
8. Lint, typecheck, unit, integration, build and E2E pass; axe is clean on `/login`, `/register`, `/forgot-password` and `/reset-password`.

## H. Testing and verification

- Unit: password policy and hashing, `sanitizeReturnTo`, allowlist parsing and normalization, token hashing, role resolution, guard predicates, the reserved-domain check, `escapeHtml` and the reset template.
- Integration (Supertest and test DB): everything in G.1–G.5, plus log redaction.
- E2E (Playwright): everything in G.6, and axe on the four auth pages.
- Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:integration`, `npm run build` and `npm run test:e2e`, and record the results.

## I. Documentation and progress updates

- Progress file: the T05 entry. Add the manual Google check (and real SMTP delivery, if not done) to pending verifications.
- Traceability: FR-010, FR-011, FR-012 (guards), FR-014, FR-015, FR-032, BR-01/03/04/21, SEC-AUTH-01/02/03/06, IA-P04/P05/P07/A01/C01/X01, TS-UNIT-06, TS-INT-01, DD-03, CFG-03.
- Decisions: D-08 → `ACCEPTED` if confirmed; record the Argon2 library actually used.
- `docs/API.md`, `docs/ARCHITECTURE.md`, `.env.example` files, README, and `CLAUDE.md` §6 if commands changed.

## J. Completion report

Report:
- what was implemented and the important files
- each acceptance criterion with pass/fail
- the commands executed and their actual results
- the manual Google sign-in result or pending status
- security notes (cookie attributes observed, CSRF behaviour, enumeration checks)
- dependencies added, with justifications
- limitations
- a suggested commit message
- the next task: **T06 — Activity timeline, notifications and email infrastructure** (`prompts/06-activity-notifications-email.md`)
