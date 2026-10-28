# T01 — Repository, Tooling and CI Foundation

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T01 |
| Title | Repository, tooling and CI foundation |
| Phase | 1 — Foundation |
| Objective | Create a runnable, well-tooled npm-workspaces monorepo with a Next.js web app, an Express 5 API, a shared package and an E2E package. Wire them together through the same-origin `/api/v1` proxy and check them in CI. |

## B. Context

- Read first: `CLAUDE.md` (all), `docs/IMPLEMENTATION_PLAN.md` §1–2, spec §13.1–13.4, §21.2–21.3, `docs/Note.md`.
- Decisions: D-03 (stack), D-04 (npm workspaces), D-05 (Node 24 LTS), D-06 (rewrite proxy), D-37 (testing tools).
- Requirements: NFR-06, NFR-10, DEP-02, DEP-03, DEP-04, DEP-06, SEC-AUTH-07, AC-UQ-05 (partially).
- The repository has no commits and contains only `docs/`, `prompts/` and `CLAUDE.md`. Nothing should be overwritten except where this prompt says so.

## C. Prerequisites

- Planning artifacts exist (`CLAUDE.md`, `docs/*`, `prompts/*`).
- **Node.js 24 LTS is active.** Run `node --version`. If the major version is not 24, **stop**: ask the user to install Node 24 LTS (the machine had Node 20.19.4, which is end-of-life). Do not install Node yourself.
- npm ≥ 10 is available.

## D. Scope

**In scope**
- Root `package.json` with npm workspaces `apps/*`, `packages/*`, `e2e`; `engines.node` `>=24 <25`; `packageManager` (npm); `.nvmrc` (`24`).
- `apps/web`: Next.js (App Router, TypeScript, Tailwind CSS, ESLint, `src/` dir, `@/*` alias), created non-interactively. Remove the boilerplate content and leave a minimal neutral page (T04/T08 replace it).
- `apps/api`: Express 5 + TypeScript, with `tsx` watch for dev and a production build (tsc or tsup) that emits runnable JS. `src/app.ts` exports `createApp()`, `src/server.ts` listens on `PORT` (default 4000), and `GET /api/v1/health` returns `{ "data": { "status": "ok" } }`.
- `packages/shared` (`@fixflow/shared`): TypeScript package that builds to `dist` with type declarations and exports `API_PREFIX = "/api/v1"`. Both apps consume it, so verify the build and dev resolution work in both.
- `e2e`: Playwright package with a config that starts web and API (or reuses running servers), plus one smoke test.
- `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (if it causes friction with libraries, record the reason and drop only that flag). Each package extends it.
- ESLint flat config (TypeScript and Next rules, import ordering) and Prettier, with root scripts `lint`, `format`, `format:check`.
- Vitest in `apps/api`, `apps/web` and `packages/shared`, each with at least one real test. API: the health route via Supertest. Shared: a constant export. Web: one small utility test, or a render test if a component exists.
- Root scripts: `dev` (`concurrently` web and API, with coloured prefixes), `build`, `lint`, `typecheck`, `test`, `test:e2e`, `format`, `format:check`. Scripts must run every workspace and return a non-zero exit code on failure.
- Next.js rewrite: `/api/v1/:path*` → `${API_INTERNAL_URL}/api/v1/:path*`. `API_INTERNAL_URL` is server-only and defaults to `http://localhost:4000` in development.
- `.gitignore` (node_modules, build output, `.env*` except `.env.example`, `.data/`, Playwright reports, coverage, `artifacts/`), `.editorconfig`, `.gitattributes` (LF).
- `apps/api/.env.example` and `apps/web/.env.example` listing the variables used so far, with comments. Never put real values in them.
- GitHub Actions `.github/workflows/ci.yml`: Node 24, `npm ci`, then lint, typecheck, test and build. Cache npm. (T03 adds Postgres and integration tests; T25 adds E2E.)
- `README.md` skeleton: one-paragraph summary, prerequisites (Node 24, npm, Docker for tests later), setup and run commands, and a pointer to `docs/`. T27 finalizes it.

**Out of scope**
Prisma and database (T03), env validation, logging and error model (T02), design tokens and UI components (T04), auth (T05), deployment config (T09). Turborepo, pnpm, Husky and commit hooks — do not add them.

## E. Implementation instructions

1. Verify the prerequisites. Check `git status` and confirm that no application files exist yet.
2. Create the root workspace files first, then scaffold `apps/web` with `create-next-app` using explicit non-interactive flags. Do not let it create a nested git repo or its own lockfile; the root lockfile is authoritative. Use npm for every install.
3. Scaffold `apps/api` by hand: `package.json` (`"type": "module"` or CJS; choose one, be consistent, and record the choice in the README), `src/app.ts`, `src/server.ts` and `src/app.test.ts`.
4. Create `packages/shared`. Make `apps/web` transpile or consume it (for example `transpilePackages`), and make the API build resolve it in both dev and production builds. Confirm with a real import in both apps.
5. Add the rewrite in `next.config.*`. The browser must never need the API's URL.
6. Configure ESLint and Prettier at the root so that `npm run lint` covers every package. Fix all lint errors and do not disable rules globally to get a pass.
7. Add `concurrently` and the root scripts. `npm run dev` must start both servers and stop both on Ctrl+C.
8. Set up Playwright in `e2e/`. Install the Chromium browser for the local run. The smoke test opens `/`, asserts the page title is not empty, and requests `/api/v1/health` **through the web origin**, asserting `status: ok`.
9. Write the CI workflow. You cannot run it locally; validate the YAML syntax and keep the steps identical to the local scripts.
10. Update `CLAUDE.md` §6 if any command name differs from what is listed there.

## F. Quality requirements

- Pin nothing to outdated majors; use current stable versions and commit `package-lock.json`.
- Keep the dependency list minimal, and justify every added runtime dependency in the completion report.
- TypeScript is strict and there is no `any` in authored code.
- No secrets appear anywhere. `.env.example` files contain names and comments only.
- Scripts are cross-platform: they work in Windows PowerShell, Git Bash and Linux CI. Avoid shell-specific syntax in npm scripts; use `cross-env` only if needed.

## G. Acceptance criteria

1. After `node --version` reports v24.x, `npm install` from the repository root completes with no errors and produces a single root lockfile.
2. `npm run dev` serves the web app on :3000 and the API on :4000. `curl http://localhost:3000/api/v1/health` returns `{"data":{"status":"ok"}}` served by the API through the proxy.
3. `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` and `npm run format:check` all exit 0.
4. `npm run test:e2e` passes the smoke test in Chromium.
5. `@fixflow/shared` is imported by both apps, and both dev and production builds resolve it.
6. `.gitignore` excludes `.env` files, build output, `.data/`, test reports and `artifacts/`. `git status` shows no generated junk.
7. The CI workflow exists and mirrors the local checks.
8. `README.md` documents prerequisites and the setup/run/test commands accurately.

## H. Testing and verification

Run and record the actual output summaries:
- `node --version`, `npm --version`
- `npm install`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run format:check`
- `npm run dev`, then `curl` the health endpoint on both ports, then stop the servers
- `npm run test:e2e`

## I. Documentation and progress updates

- `docs/IMPLEMENTATION_PROGRESS.md`: T01 entry (status, work, commands and results, issues, date) and the summary row.
- `docs/REQUIREMENTS_TRACEABILITY.md`: update the DEP-02, DEP-03, DEP-04 (partial), DEP-06 and SEC-AUTH-07 rows.
- `prompts/README.md`: set the T01 status.
- `CLAUDE.md` §6: correct the command names if they changed.
- `docs/DECISIONS_AND_OPEN_QUESTIONS.md`: record any deviation, for example the module-format choice or a dropped TS flag.

## J. Completion report

Report:
- what was implemented
- key files created or modified
- each acceptance criterion with pass/fail
- the commands executed and their actual results
- dependencies added, with a one-line justification each
- known limitations or blockers
- a suggested commit message (do not commit unless asked)
- the next task: **T02 — API platform foundation** (`prompts/02-api-platform.md`)
