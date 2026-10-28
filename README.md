# FixFlow

FixFlow is a self-initiated portfolio project: a web application that helps **one** small home-service company (the fictional demo business _CoolBreeze Home Services_) run its day-to-day work. Customers request a service and approve a quotation; the business schedules and completes the job, issues an invoice and records the payment. It has a public website, a business admin dashboard (`/app`) and a customer portal (`/portal`). All data in the demo is fictional.

> **Status:** early development. So far there is the repository foundation (tooling, a placeholder home page) and the API platform (configuration, logging, error contract, validation, pagination, rate limiting, and a health endpoint). There are no product features yet. Progress is tracked in [`docs/IMPLEMENTATION_PROGRESS.md`](docs/IMPLEMENTATION_PROGRESS.md).

## Prerequisites

- **Node.js 24 LTS** (`.nvmrc` pins `24`; `engines` requires `>=24 <25`). Check with `node --version`.
- **npm 10 or newer** (ships with Node 24).
- **Docker** — not needed yet. A later task uses it for a local PostgreSQL test database.

## Setup

```bash
npm install                              # from the repository root; installs every workspace
npx playwright install chromium          # one-time, only needed to run the end-to-end tests
```

Optional: copy `apps/server/.env.example` to `apps/server/.env` and `apps/web/.env.example` to `apps/web/.env.local` to override the defaults. Both apps run without them in local development.

### API configuration

The API validates its environment when it starts and exits with status `1`, naming each missing or invalid variable (never its value), if anything is wrong. Every variable, with its default and a comment, is in [`apps/server/.env.example`](apps/server/.env.example). Locally nothing is required. Production (`NODE_ENV=production`) additionally requires `WEB_ORIGIN` and the Upstash Redis credentials (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) used for rate limiting. The API reads `apps/server/.env` in development and test only, never in production.

## Run

```bash
npm run dev
```

| Service | URL                                 | Notes                                                                     |
| ------- | ----------------------------------- | ------------------------------------------------------------------------- |
| Web     | http://localhost:3000               | Next.js                                                                   |
| API     | http://localhost:4000/api/v1/health | Express                                                                   |
| Proxy   | http://localhost:3000/api/v1/health | The web app forwards `/api/v1/*` to the API (same origin for the browser) |

The browser only ever talks to the web origin. Next.js rewrites `/api/v1/*` to `${API_INTERNAL_URL}/api/v1/*` (`API_INTERNAL_URL` is server-only and defaults to `http://localhost:4000`), which keeps the session cookie first-party.

## Commands

All commands run from the repository root and cover every workspace.

| Command                                       | What it does                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`                                 | Shared package watcher, API (`:4000`) and web app (`:3000`)                                  |
| `npm run build`                               | Production build of the shared package, API and web app                                      |
| `npm run lint`                                | ESLint (TypeScript type-aware rules, Next.js rules for the web)                              |
| `npm run typecheck`                           | `tsc --noEmit` in each workspace                                                             |
| `npm run test`                                | Unit tests (Vitest) in each workspace                                                        |
| `npm run test:integration -w @fixflow/server` | API integration tests (`*.int.test.ts`); none yet, they arrive with the test database in T03 |
| `npm run test:e2e`                            | Playwright smoke test in Chromium (starts or reuses both apps)                               |
| `npm run format` / `format:check`             | Prettier write / check                                                                       |

`@fixflow/shared` compiles to `dist/`, and both apps import that output. The root scripts build it first when they need it (`lint`, `typecheck`, `test`, `test:e2e`, `dev`); `npm run build` relies on `packages/*` being listed first in the root `workspaces`, so keep that order.

## Repository layout

```text
apps/web/          Next.js app (App Router, Tailwind CSS)
apps/server/       Express 5 API (the backend)
packages/shared/   @fixflow/shared — error codes, limits, constants and types used by both apps
e2e/               Playwright end-to-end tests
docs/              Specification, plan, decisions and progress
prompts/           Task prompts used to build the project step by step
```

## Conventions

- **TypeScript everywhere**, strict, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **ES modules** in the API and the shared package (`"type": "module"`, `NodeNext` resolution), so relative imports there end in `.js`. See decision D-54.
- Tests sit next to the code: `*.test.ts` for unit tests, later `*.int.test.ts` for API integration tests.

## Documentation

How the system fits together is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the HTTP conventions (response envelope, errors, pagination, rate limits) and the endpoint reference are in [`docs/API.md`](docs/API.md).

Start with [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md). The canonical specification is [`docs/FixFlow_Project_Documentation.docx`](docs/FixFlow_Project_Documentation.docx) (searchable copy: [`docs/FixFlow_Project_Documentation.md`](docs/FixFlow_Project_Documentation.md)); resolved decisions and open questions are in [`docs/DECISIONS_AND_OPEN_QUESTIONS.md`](docs/DECISIONS_AND_OPEN_QUESTIONS.md). Contributor and AI-assistant instructions are in [`CLAUDE.md`](CLAUDE.md).
