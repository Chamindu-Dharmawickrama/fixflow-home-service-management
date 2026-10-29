# FixFlow

FixFlow is a self-initiated portfolio project: a web application that helps **one** small home-service company (the fictional demo business _CoolBreeze Home Services_) run its day-to-day work. Customers request a service and approve a quotation; the business schedules and completes the job, issues an invoice and records the payment. It has a public website, a business admin dashboard (`/app`) and a customer portal (`/portal`). All data in the demo is fictional.

> **Status:** early development. So far there is the repository foundation (tooling, a placeholder home page), the API platform (configuration, logging, error contract, validation, pagination, rate limiting, health endpoints), the database layer (the complete data model with database-enforced invariants, migrations, reference numbers, an activity writer, a test database and a base seed), the design system (tokens, components, application shells and a development-only `/styleguide`) and **authentication** (email/password and Google sign-in, sessions, password reset, role-aware areas). The business features themselves are not built yet. Progress is tracked in [`docs/IMPLEMENTATION_PROGRESS.md`](docs/IMPLEMENTATION_PROGRESS.md).

## Prerequisites

- **Node.js 24 LTS** (`.nvmrc` pins `24`; `engines` requires `>=24 <25`). Check with `node --version`.
- **npm 10 or newer** (ships with Node 24).
- **Docker** (with Compose) for the local PostgreSQL that the integration tests use, and that you can also use for development. Not needed to run the unit tests or the UI alone.

## Setup

```bash
npm install                              # from the repository root; installs every workspace
npx playwright install chromium          # one-time, only needed to run the end-to-end tests
```

Optional: copy `apps/server/.env.example` to `apps/server/.env` and `apps/web/.env.example` to `apps/web/.env.local` to override the defaults. Both apps start without them in local development, but the API needs a database for anything beyond the health check (see the next section).

### API configuration

The API validates its environment when it starts and exits with status `1`, naming each missing or invalid variable (never its value), if anything is wrong. Every variable, with its default and a comment, is in [`apps/server/.env.example`](apps/server/.env.example). Locally nothing is required to start. Production (`NODE_ENV=production`) additionally requires `WEB_ORIGIN`, `DATABASE_URL` and the Upstash Redis credentials (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) used for rate limiting. The API reads `apps/server/.env` in development and test only, never in production.

### Authentication, demo accounts and email

People sign in with an **email and password** or with **Google** (D-07). Customers can register themselves; the business admin is a separate, allowlisted account (D-08). Sessions are server-side, in an HTTP-only cookie.

| Variable (API)                                              | What it does                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                                            | HMAC key for session and reset-link hashes, 32 or more characters. **Required in production.** Locally, leave it out and a random one is made on every start (everyone is signed out whenever the API restarts); `.env.example` sets a throwaway one so sessions survive restarts. |
| `ADMIN_EMAILS`                                              | Comma-separated emails that may be the business admin. **The demo admin `admin@demo.fixflow.test` must be listed**, or the admin area refuses it. Removing an address and restarting revokes that person's admin access.                                                           |
| `GOOGLE_CLIENT_ID`                                          | The OAuth Web client ID for Google sign-in (see below). Blank = Google sign-in is off; email and password still work.                                                                                                                                                              |
| `DEMO_MODE`                                                 | `true` on a public demo: the shared demo accounts cannot change their password or request a reset, so one visitor cannot lock out the others.                                                                                                                                      |
| `PUBLIC_SIGNUP_ENABLED`                                     | `false` closes registration (email and Google) without a code change. Default `true`.                                                                                                                                                                                              |
| `EMAIL_TRANSPORT`, `EMAIL_FROM`, `SMTP_*`, `PUBLIC_WEB_URL` | How the API sends mail. Without SMTP it uses the log transport (below). See `apps/server/.env.example`.                                                                                                                                                                            |

| Variable (web, `apps/web/.env.local`)                                   | What it does                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`                                          | The same client ID as `GOOGLE_CLIENT_ID`. A client ID is public, not a secret.                                                                                                     |
| `NEXT_PUBLIC_DEMO_MODE`                                                 | `true` shows the **Demo accounts** panel on the sign-in page (its buttons fill in the real form) and the public-demo privacy notice.                                               |
| `NEXT_PUBLIC_DEMO_ADMIN_PASSWORD`, `NEXT_PUBLIC_DEMO_CUSTOMER_PASSWORD` | The demo accounts' **published** passwords, shown in that panel. Public by design: they must match the API's `DEMO_*_PASSWORD`, and must be different wherever the demo is hosted. |

**Sign in locally.** With the database set up and seeded (next section) and `npm run dev` running, open http://localhost:3000/login. Set `NEXT_PUBLIC_DEMO_MODE=true` in `apps/web/.env.local` to get the demo-accounts panel; otherwise type a demo account's email and password yourself.

**Google sign-in.** Create an OAuth 2.0 **Web application** client in the Google Cloud Console (APIs & Services, Credentials), add `http://localhost:3000` as an **Authorized JavaScript origin**, and put the client ID in `GOOGLE_CLIENT_ID` (API) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web). Restart both. The sign-in and register pages then show Google's button. A Google account whose email is in `ADMIN_EMAILS` becomes the business admin the first time it signs in; anyone else becomes a customer.

**Email: two modes (D-13, D-52).** The API sends password-reset links now and, from T11 on, an email beside each customer notification (quotation sent, job scheduled, invoice issued, …).

- **`log` (the default).** Nothing is delivered. Each email is written to **`.data/outbox/`** at the repository root, a `.txt` and a `.html` file named `<timestamp>-<template>`, for example `20261029T153012345Z-quotation-sent.html`. Open the `.txt` file to read it or follow its link, or the `.html` file in a browser to see how it looks. The delivery record says **"logged"**, never "sent". The folder is git-ignored and is not written in production.
- **`smtp`.** Set `EMAIL_TRANSPORT=smtp` with `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `EMAIL_FROM` (the first five are optional outside production). In **production** every one of them is required, and the API refuses to start without them. `EMAIL_TRANSPORT=log` is allowed in production but the server warns that no email will be delivered, and password reset is then unavailable.
- Addresses on reserved domains (`.test`, `example.com`, …), which includes every demo account, always use the log transport, even when SMTP is configured, so a demo can never send mail to a stranger (D-52).
- `PUBLIC_WEB_URL` is the web app's address used for the links inside emails (it defaults to `WEB_ORIGIN`).

**Try SMTP.** With SMTP configured in `apps/server/.env`, `npm run email:test -w @fixflow/server -- --to you@your-own-domain.com` sends one real message and says whether the server accepted it (it refuses reserved addresses and never runs in production). Check the inbox and the spam folder to confirm it arrived.

**See the notification bell before any workflow creates notifications.** After `npm run db:seed`, run `npm run demo:notifications -w @fixflow/server`. It gives the seeded demo customer (Alex Morgan) three notifications and the demo admin two, each ending "Demo data.", so the bell, the unread badge and "Mark all as read" can be tried at http://localhost:3000. It is safe to repeat and refuses to run in production.

### Database

The API uses PostgreSQL through Prisma 7. Four different databases are involved; never point one variable at another's database. The test utilities refuse to empty anything except `TEST_DATABASE_URL` and `E2E_DATABASE_URL`.

| Variable              | Used by                                                                                                         | Local value (Docker)                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`        | the running API (Neon: the **pooled** URL, with `?sslmode=require`)                                             | `postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_dev`  |
| `DIRECT_DATABASE_URL` | the Prisma CLI for migrations (Neon: the **direct** URL, with `?sslmode=require`); falls back to `DATABASE_URL` | same as `DATABASE_URL`                                               |
| `TEST_DATABASE_URL`   | the integration tests, which empty it before every test                                                         | `postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_test` |
| `E2E_DATABASE_URL`    | the Playwright suite, which empties and re-seeds it on every run (its name must contain `e2e`)                  | `postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_e2e`  |

The Docker credentials are throwaway values for a database that listens only on localhost.

```bash
cp apps/server/.env.example apps/server/.env                 # already has the Docker values above
npm run db:test:up                                           # PostgreSQL 18 on localhost:5433 (waits until healthy)
docker compose exec postgres createdb -U fixflow_test fixflow_dev   # once: the development database
npm run db:deploy                                            # apply the migrations to the development database
npm run db:seed                                              # load the demo base data (safe to repeat)
npm run db:test:down                                         # stop PostgreSQL later (the data survives in a volume)
```

- **Schema changes:** edit `apps/server/prisma/schema.prisma`, then `npm run db:migrate -- --name <change>` (development database only). `npm run db:deploy` (`prisma migrate deploy`) is the only way schema changes reach a shared environment such as Neon. Never edit a migration that has been applied; add a new one. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §11 for the data model, the database-enforced invariants and the raw-SQL migration workflow.
- **Seed:** `npm run db:seed` loads the business settings (with a bundled logo), five services (each with a bundled picture), three technicians and three demo accounts. It is idempotent: records are looked up by natural key and created only if missing, so running it again changes nothing. It needs `DEMO_ADMIN_PASSWORD` and `DEMO_CUSTOMER_PASSWORD` (10 to 128 characters) and refuses to run without them; no password is stored in the source code. Re-running with different values rotates the demo passwords. The passwords must follow the password policy (10 to 128 characters, not a common password).
- **Demo accounts** (fictional; the passwords are the **demo-only** values in `.env.example`, public by design, so use different values anywhere the demo is hosted): admin Morgan Reyes `admin@demo.fixflow.test` with `DEMO_ADMIN_PASSWORD`; customers Alex Morgan `alex.morgan@example.test` and Priya Shah `priya.shah@example.test` with `DEMO_CUSTOMER_PASSWORD`. They are ordinary accounts with local passwords; there is no special demo login. In demo mode (`DEMO_MODE=true`) their passwords cannot be changed or reset. To use the admin account, its email must be in `ADMIN_EMAILS` (the example file already lists it).
- **Integration tests:** `npm run test:integration` applies every migration to `TEST_DATABASE_URL` and runs the `*.int.test.ts` files. The test utilities refuse to run unless `NODE_ENV` is `test` and `TEST_DATABASE_URL` is a different database from `DATABASE_URL`.
- **Neon:** create a Neon project with a `dev` branch, put its pooled URL in `DATABASE_URL` and its direct URL in `DIRECT_DATABASE_URL` (both with `?sslmode=require`), then run `npm run db:deploy` and `npm run db:seed`. Without a database the API still starts, and `GET /api/v1/health/ready` returns `503`.

## Run

```bash
npm run dev
```

| Service | URL                                 | Notes                                                                     |
| ------- | ----------------------------------- | ------------------------------------------------------------------------- |
| Web     | http://localhost:3000               | Next.js                                                                   |
| API     | http://localhost:4000/api/v1/health | Express                                                                   |
| Proxy   | http://localhost:3000/api/v1/health | The web app forwards `/api/v1/*` to the API (same origin for the browser) |

In development only, `http://localhost:3000/styleguide` renders every design-system component and state, with example public, sign-in, dashboard and portal screens under `/styleguide/shells/*`. A production build answers 404 for all of it.

The browser only ever talks to the web origin. Next.js rewrites `/api/v1/*` to `${API_INTERNAL_URL}/api/v1/*` (`API_INTERNAL_URL` is server-only and defaults to `http://localhost:4000`), which keeps the session cookie first-party.

## The public website

`/`, `/services`, `/services/<slug>` and `/privacy` are the business's public site (T08), in the business's own name and logo from the settings, with "Powered by FixFlow" in the footer. They read the business and the active services from the API and hold what they read for `PUBLIC_REVALIDATE_SECONDS` (60 by default), so a change made in the admin area shows within about a minute. If the API cannot be reached (a cold start, an outage) the pages still render: the parts that need it say so and offer "Try again". `npm run build` does not need the API to be running.

- **Imagery.** No photographs: the hero shows the product's own statuses and the service pictures are the bundled tinted tiles (D-90).
- **Request a service** leads to sign-in and then the portal until the request form arrives (T11, D-88).
- **Demo mode** (`NEXT_PUBLIC_DEMO_MODE=true`) adds a dismissible banner ("FixFlow portfolio demo — …") and tells search engines not to index the pages (D-89). Set `SITE_URL` to the site's public address so canonical links and `/sitemap.xml` are right.
- The content (hero, how it works, trust points, FAQ, privacy notice) is plain data in `apps/web/src/features/marketing/content/site-content.ts`.

## Commands

All commands run from the repository root and cover every workspace.

| Command                           | What it does                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Shared package watcher, API (`:4000`) and web app (`:3000`)                                                                                                                                                                           |
| `npm run build`                   | Production build of the shared package, API (generates the Prisma client first) and web app                                                                                                                                           |
| `npm run lint`                    | ESLint (TypeScript type-aware rules, Next.js rules for the web)                                                                                                                                                                       |
| `npm run typecheck`               | `tsc --noEmit` in each workspace                                                                                                                                                                                                      |
| `npm run test`                    | Unit tests (Vitest) in each workspace; no database needed                                                                                                                                                                             |
| `npm run test:integration`        | API integration tests (`*.int.test.ts`) against `TEST_DATABASE_URL`; applies the migrations first                                                                                                                                     |
| `npm run test:e2e`                | Playwright tests in Chromium: smoke, styleguide, keyboard, sign-in/sign-up/recovery journeys, accessibility. Starts its own API and web app against the `fixflow_e2e` database (needs `npm run db:test:up`; stop `npm run dev` first) |
| `npm run db:test:up` / `down`     | Start / stop the local PostgreSQL (`docker-compose.yml`, port 5433)                                                                                                                                                                   |
| `npm run db:generate`             | Generate the Prisma client into `apps/server/src/generated/prisma` (git-ignored)                                                                                                                                                      |
| `npm run db:migrate -- --name x`  | `prisma migrate dev`: create and apply a migration to the **development** database                                                                                                                                                    |
| `npm run db:deploy`               | `prisma migrate deploy`: apply existing migrations (the way schema changes reach shared databases)                                                                                                                                    |
| `npm run db:seed`                 | Load the idempotent base demo data into the database named by `DATABASE_URL`                                                                                                                                                          |
| `npm run db:studio`               | Open Prisma Studio on the database named by `DIRECT_DATABASE_URL`                                                                                                                                                                     |
| `npm run format` / `format:check` | Prettier write / check                                                                                                                                                                                                                |

`@fixflow/shared` compiles to `dist/`, and both apps import that output. The Prisma client is generated code and is not committed. The root scripts build and generate what they need first (`lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `dev`); `npm run build` relies on `packages/*` being listed first in the root `workspaces`, so keep that order.

## Repository layout

```text
apps/web/          Next.js app (App Router, Tailwind CSS)
apps/server/       Express 5 API (the backend); prisma/ holds the schema, migrations and seed
packages/shared/   @fixflow/shared — enums, error codes, limits, constants and types used by both apps
e2e/               Playwright end-to-end tests (tests/, support/ helpers, fixtures/ scenario data)
docker-compose.yml Local PostgreSQL for the integration and end-to-end tests
docs/              Specification, plan, decisions and progress
prompts/           Task prompts used to build the project step by step
```

## Conventions

- **TypeScript everywhere**, strict, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **ES modules** in the API and the shared package (`"type": "module"`, `NodeNext` resolution), so relative imports there end in `.js`. See decision D-54.
- Tests sit next to the code: `*.test.ts` for unit tests and `*.int.test.ts` for API integration tests.

## Documentation

The visual identity, tokens, status vocabulary, patterns and screen blueprints are in [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md). How the public website reads and caches its data is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §16. How the system fits together is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the HTTP conventions (response envelope, errors, pagination, rate limits, sessions and CSRF) and the endpoint reference are in [`docs/API.md`](docs/API.md). The sign-in, Google, account-linking and password-reset flows are drawn in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §13.

Start with [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md). The canonical specification is [`docs/FixFlow_Project_Documentation.docx`](docs/FixFlow_Project_Documentation.docx) (searchable copy: [`docs/FixFlow_Project_Documentation.md`](docs/FixFlow_Project_Documentation.md)); resolved decisions and open questions are in [`docs/DECISIONS_AND_OPEN_QUESTIONS.md`](docs/DECISIONS_AND_OPEN_QUESTIONS.md). Contributor and AI-assistant instructions are in [`CLAUDE.md`](CLAUDE.md).
