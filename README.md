# FixFlow

FixFlow is a self-initiated portfolio project: a web application that helps **one** small home-service company (the fictional demo business _CoolBreeze Home Services_) run its day-to-day work. Customers request a service and approve a quotation; the business schedules and completes the job, issues an invoice and records the payment. It has a public website, a business admin dashboard (`/app`) and a customer portal (`/portal`). All data in the demo is fictional.

> **Status:** early development. So far there is the repository foundation (tooling, a placeholder home page), the API platform (configuration, logging, error contract, validation, pagination, rate limiting, health endpoints) the database layer (the complete data model with database-enforced invariants, migrations, reference numbers, an activity writer, a test database and a base seed) and the design system (tokens, components, application shells and a development-only `/styleguide`). There are no product features yet. Progress is tracked in [`docs/IMPLEMENTATION_PROGRESS.md`](docs/IMPLEMENTATION_PROGRESS.md).

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

### Database

The API uses PostgreSQL through Prisma 7. Three different databases are involved; never point one variable at another's database.

| Variable              | Used by                                                                                                         | Local value (Docker)                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`        | the running API (Neon: the **pooled** URL, with `?sslmode=require`)                                             | `postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_dev`  |
| `DIRECT_DATABASE_URL` | the Prisma CLI for migrations (Neon: the **direct** URL, with `?sslmode=require`); falls back to `DATABASE_URL` | same as `DATABASE_URL`                                               |
| `TEST_DATABASE_URL`   | the integration tests, which empty it before every test                                                         | `postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_test` |

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
- **Seed:** `npm run db:seed` loads the business settings, five services, three technicians and three demo accounts. It is idempotent: records are looked up by natural key and created only if missing, so running it again changes nothing. It needs `DEMO_ADMIN_PASSWORD` and `DEMO_CUSTOMER_PASSWORD` (10 to 128 characters) and refuses to run without them; no password is stored in the source code. Re-running with different values rotates the demo passwords.
- **Demo accounts** (fictional; the passwords are the **demo-only** values in `.env.example`, public by design, so use different values anywhere the demo is hosted): admin Morgan Reyes `admin@demo.fixflow.test` with `DEMO_ADMIN_PASSWORD`; customers Alex Morgan `alex.morgan@example.test` and Priya Shah `priya.shah@example.test` with `DEMO_CUSTOMER_PASSWORD`. Signing in arrives with T05.
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

## Commands

All commands run from the repository root and cover every workspace.

| Command                           | What it does                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Shared package watcher, API (`:4000`) and web app (`:3000`)                                                     |
| `npm run build`                   | Production build of the shared package, API (generates the Prisma client first) and web app                     |
| `npm run lint`                    | ESLint (TypeScript type-aware rules, Next.js rules for the web)                                                 |
| `npm run typecheck`               | `tsc --noEmit` in each workspace                                                                                |
| `npm run test`                    | Unit tests (Vitest) in each workspace; no database needed                                                       |
| `npm run test:integration`        | API integration tests (`*.int.test.ts`) against `TEST_DATABASE_URL`; applies the migrations first               |
| `npm run test:e2e`                | Playwright tests in Chromium: smoke, styleguide layout and accessibility, keyboard (starts or reuses both apps) |
| `npm run db:test:up` / `down`     | Start / stop the local PostgreSQL (`docker-compose.yml`, port 5433)                                             |
| `npm run db:generate`             | Generate the Prisma client into `apps/server/src/generated/prisma` (git-ignored)                                |
| `npm run db:migrate -- --name x`  | `prisma migrate dev`: create and apply a migration to the **development** database                              |
| `npm run db:deploy`               | `prisma migrate deploy`: apply existing migrations (the way schema changes reach shared databases)              |
| `npm run db:seed`                 | Load the idempotent base demo data into the database named by `DATABASE_URL`                                    |
| `npm run db:studio`               | Open Prisma Studio on the database named by `DIRECT_DATABASE_URL`                                               |
| `npm run format` / `format:check` | Prettier write / check                                                                                          |

`@fixflow/shared` compiles to `dist/`, and both apps import that output. The Prisma client is generated code and is not committed. The root scripts build and generate what they need first (`lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `dev`); `npm run build` relies on `packages/*` being listed first in the root `workspaces`, so keep that order.

## Repository layout

```text
apps/web/          Next.js app (App Router, Tailwind CSS)
apps/server/       Express 5 API (the backend); prisma/ holds the schema, migrations and seed
packages/shared/   @fixflow/shared — enums, error codes, limits, constants and types used by both apps
e2e/               Playwright end-to-end tests
docker-compose.yml Local PostgreSQL for the integration tests
docs/              Specification, plan, decisions and progress
prompts/           Task prompts used to build the project step by step
```

## Conventions

- **TypeScript everywhere**, strict, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **ES modules** in the API and the shared package (`"type": "module"`, `NodeNext` resolution), so relative imports there end in `.js`. See decision D-54.
- Tests sit next to the code: `*.test.ts` for unit tests and `*.int.test.ts` for API integration tests.

## Documentation

The visual identity, tokens, status vocabulary, patterns and screen blueprints are in [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md). How the system fits together is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the HTTP conventions (response envelope, errors, pagination, rate limits) and the endpoint reference are in [`docs/API.md`](docs/API.md).

Start with [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md). The canonical specification is [`docs/FixFlow_Project_Documentation.docx`](docs/FixFlow_Project_Documentation.docx) (searchable copy: [`docs/FixFlow_Project_Documentation.md`](docs/FixFlow_Project_Documentation.md)); resolved decisions and open questions are in [`docs/DECISIONS_AND_OPEN_QUESTIONS.md`](docs/DECISIONS_AND_OPEN_QUESTIONS.md). Contributor and AI-assistant instructions are in [`CLAUDE.md`](CLAUDE.md).
