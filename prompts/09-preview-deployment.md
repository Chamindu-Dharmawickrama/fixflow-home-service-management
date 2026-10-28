# T09 — Hosted Preview Deployment (Walking Skeleton)

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T09 |
| Title | Hosted preview deployment (walking skeleton) |
| Phase | 2 — Identity, configuration and public experience |
| Objective | Deploy the current application to Vercel (web), Render (API) and Neon (database) early. This proves the riskiest architectural assumptions on real HTTPS infrastructure before most features are built: same-origin proxy, first-party session cookies, CSRF Origin checks, client-IP rate limiting, Google sign-in origins, migrations and cold-start behaviour. |

## B. Context

- Read first: `CLAUDE.md` §4, §9; spec §15.1, §16 (Portability, Observability), §21 (all); `docs/Note.md`.
- Decisions: D-02, **D-06 (verify here)**, D-10, D-11, D-12, D-14, D-15, **D-48 (PROPOSED; confirm)**, D-09; Q-04, Q-06, Q-09.
- Requirements: DEP-01 (preview), DEP-02, AC-UQ-06 (preview), CFG-01, CFG-02, CFG-03, CFG-05, CFG-06, SEC-AUTH-02 (on HTTPS).
- **No later task depends on T09 except T26.** If credentials or accounts are unavailable, mark T09 `BLOCKED` with the missing items listed and continue with T10.

## C. Prerequisites

- T08 `COMPLETED`.
- The owner has, or can create during the session: a Render account, a Vercel account, a Neon project with a `preview` (or `main`) branch, a Google OAuth Web client (to add the preview origin), and an Upstash Redis database. SMTP is optional (use `EMAIL_TRANSPORT=log` for preview).
- Claude Code cannot click through provider dashboards. Prepare configuration and exact step-by-step instructions, let the owner perform the dashboard steps (or use provider CLIs the owner has authenticated), then verify from the terminal.

## D. Scope

**In scope**
- `render.yaml` (Blueprint) for the API web service:
  - root and build settings for the monorepo
  - Node 24 (`NODE_VERSION`/`.node-version`)
  - build command `npm ci && npm run db:generate -w @fixflow/api && npm run db:deploy -w @fixflow/api && npm run build -w @fixflow/api` (adjust to the real scripts)
  - start command
  - health check path `/api/v1/health`
  - every env var key declared, with secrets marked `sync: false`
- Vercel configuration: project root `apps/web`, install and build commands that work with npm workspaces, env vars `API_INTERNAL_URL` (the Render URL, server-only), `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_DEMO_MODE`, `NEXT_PUBLIC_SITE_URL`. Add `vercel.json` only if required.
- API env on Render: `NODE_ENV=production`, `DATABASE_URL` (Neon pooled), `DIRECT_DATABASE_URL` (Neon direct), `WEB_ORIGIN` (the Vercel URL), `PUBLIC_WEB_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `DEMO_MODE=true`, Upstash vars, `EMAIL_TRANSPORT=log`, `TRUST_PROXY`, `LOG_LEVEL`, `PUBLIC_SIGNUP_ENABLED`, and the demo-account passwords for the seed.
- Seed the preview database with the base seed.
- Verification checklist (E.4), executed and recorded.
- `docs/DEPLOYMENT.md`: architecture of the hosted environments, the env var matrix (name, where it is set, example format, secret yes/no), first-time setup steps for each provider, how migrations run, how to seed and reset the preview, how to roll back, cold-start notes, and troubleshooting.
- Fixes required for hosted operation, such as `trust proxy` settings, client-IP key extraction for rate limiting, cookie naming, or proxy header handling. If the rewrite proxy does not forward what is needed, implement the route-handler proxy fallback and record a new decision superseding D-06.

**Out of scope**
Production release hardening, demo reset automation, SMTP delivery (T24/T26), custom domains (Q-06), CI/CD auto-deploy beyond provider defaults.

## E. Implementation instructions

1. Confirm D-48 and the account and credential availability with the owner. If anything essential is missing, write the configuration files and `DEPLOYMENT.md` anyway, mark the task `BLOCKED`, and list exactly what is needed.
2. Write `render.yaml` and any Vercel config. Validate the scripts locally by running the exact build commands in a clean checkout or fresh `npm ci`.
3. Walk the owner through:
   - creating the services and pasting env vars
   - adding `https://<vercel-preview-domain>` to the Google OAuth authorized JavaScript origins
   - the Neon branch connection strings
   - the Upstash credentials
4. Verify on the deployed preview, recording the evidence (command output, response headers with secrets redacted, screenshots):
   - `GET https://<api>/api/v1/health` returns 200; `/health/ready` returns 200 (the DB is reachable).
   - `GET https://<web>/api/v1/health` is proxied correctly.
   - Sign-in with a seeded demo account through the real `/login` form (`POST https://<web>/api/v1/auth/login`): the `Set-Cookie` arrives on the **web** origin with `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`. A subsequent `/api/v1/auth/me` from the browser succeeds.
   - Safari/WebKit behaviour: run the Playwright login smoke against the preview URL with the `webkit` project.
   - Google sign-in on the preview succeeds for an allowlisted admin account (lands in `/app`) and for a non-allowlisted account (becomes a customer, lands in `/portal`).
   - Password reset on the preview: request a reset for a non-demo test account and confirm the link is produced (outbox/log with `EMAIL_TRANSPORT=log`, or a real email if SMTP is configured).
   - CSRF: a POST without or with a wrong `Origin` is rejected (403), and a normal UI POST succeeds, which proves `Origin` survives the rewrite.
   - Rate-limit keying: log or inspect the client IP the API derives behind Vercel and Render (temporary debug output, removed afterwards) and confirm it is the real client, not the Vercel egress IP. Adjust `TRUST_PROXY` or the key extraction as needed. Upstash counters increment.
   - Cold start: after the API idles, the public site still renders (graceful fallback) and recovers.
   - Migrations ran in the build, and the seed applied.
5. Remove any temporary debug code and update `DEPLOYMENT.md` with the actual findings.

## F. Quality requirements

- No secret values are committed or printed in logs, reports or `DEPLOYMENT.md`; use placeholders.
- Production config fails fast on missing required env, as built in T02.
- The preview database is separate from development and from any future production branch (DEP-01).

## G. Acceptance criteria

1. The web and API are deployed on HTTPS, and both health endpoints and the proxied health check return 200.
2. Demo-account sign-in through the login form works in Chromium **and** WebKit against the preview. The session cookie is first-party to the web origin with the required attributes.
3. Google sign-in works on the preview for an allowlisted admin and for a regular customer.
4. CSRF Origin enforcement works through the proxy, and rate limiting keys on the real client IP using Upstash.
5. `docs/DEPLOYMENT.md` and `render.yaml` are committed-ready, accurate and free of secrets.
6. If any item cannot be verified, the task is `BLOCKED` (or `IN_PROGRESS`) with exact reasons, not `COMPLETED`.

## H. Testing and verification

- Local: run the exact provider build commands from a clean install.
- Remote: the curl checks (headers redacted), the Playwright smoke against the preview URL (`BASE_URL=… npm run test:e2e -- --project=webkit --grep @smoke`; add a `@smoke` tag if needed), and the manual Google sign-in.
- Record every result in the progress file.

## I. Documentation and progress updates

- Progress (including pending verifications if blocked), traceability (DEP-01, DEP-02, AC-UQ-06 preview, CFG-01/02/03/05/06), `prompts/README.md`, decisions (D-06 and D-48 → `ACCEPTED`, or superseded, with findings), README deployment pointer, `.env.example` accuracy.

## J. Completion report

Report:
- what was deployed (URLs can be shared; secrets cannot)
- configuration files created
- each verification item with evidence
- any architecture adjustments made
- blockers and the exact missing items
- a suggested commit message
- the next task: **T10 — Customer profile and service addresses** (`prompts/10-customer-profile-addresses.md`)
