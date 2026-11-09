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

**Email: two modes (D-13, D-52).** The API sends password-reset links and, since T11, a confirmation to a customer who sends a service request plus an alert to the business's contact address; since T12, a customer whose request the business cancelled gets an email with the message the business wrote for them (never the internal reason). Later tasks add an email beside each customer notification (quotation sent, job scheduled, invoice issued, …).

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

- **Imagery.** Royalty-free Pexels photographs (the hero and one per service picture), shipped in `apps/web/public/images` and credited in `CREDITS.md` (D-90). They are stock images, and the privacy and demo notice says so. To use your own, replace the files and keep the names.
- **Request a service** and **Request this service** lead to the request form, `/request-service` (T11, D-98). A visitor without an account is sent to sign-in or registration and returned to the form with the service still chosen.
- **Demo mode** (`NEXT_PUBLIC_DEMO_MODE=true`) adds a dismissible banner ("FixFlow portfolio demo — …") and tells search engines not to index the pages (D-89). Set `SITE_URL` to the site's public address so canonical links and `/sitemap.xml` are right.
- The content (hero, how it works, trust points, FAQ, privacy notice) is plain data in `apps/web/src/features/marketing/content/site-content.ts`.

## Service requests (customers)

A signed-in customer sends a request at `/request-service` (five numbered sections: service, problem, address, preferred day and time window, review) and follows it under **Requests** in the portal (`/portal/requests`, `/portal/requests/<id>`). The server creates the request with a reference such as `FF-2026-00012`, a copy of the service name and address, the history entry and a notification for every admin, then emails the customer and the business after the transaction commits. Sending the same form twice, or retrying after a lost connection, never creates a second request. The preferred time is a preference in the business's time zone, not a booking. See `docs/API.md` (Service requests) and `docs/ARCHITECTURE.md` §18.

## Service requests (business admin)

The business team works the requests at **Requests** in the admin area (`/app/requests`, T12). The queue has status chips with counts (several can be combined), a search by reference, customer name or email, filters for the service and the day the request was submitted, sortable columns and pages of twenty; every search and filter is kept in the address, so a view can be bookmarked or shared. A request (`/app/requests/<id>`) shows what the customer sent, their contact details and other requests, the history, and **Notes**: each note is either _internal_ (only the team) or _shared with the customer_, and the form starts at internal. The team can **start the review**, **cancel** (an internal reason is required; an optional message goes to the customer by email and in their portal) or **reopen** a declined request. Only the actions the server allows are offered, and a request that someone else changed meanwhile is refused and reloaded. See `docs/API.md` (Admin service requests) and `docs/ARCHITECTURE.md` §19.

## Customers (business admin)

**Customers** in the admin area (`/app/customers`, T13) is the directory of everyone with an account: search by name, email or phone (punctuation in a phone number does not matter), sort by name, last activity or when they signed up, pages of twenty, all kept in the address. Each row shows the contact details, the default address's city, how many requests and open jobs the customer has and what they still owe. A customer's page (`/app/customers/<id>`) has their contact links, every saved address with its access notes, three headline figures, and a **History** of requests, quotations, jobs and invoices, one kind at a time, a page at a time, each row with its status and a link to its request. **Internal notes** about a customer are for the team only: the panel says so in words, a note cannot be edited afterwards, and nothing a customer can open ever carries one. The request page links to the customer's page. Editing a customer and exporting the list are not part of this task. See `docs/API.md` (Admin customers) and `docs/ARCHITECTURE.md` §20.

## Technicians (business admin)

**Technicians** in the admin area (`/app/technicians`, T16) are the people the business schedules for jobs. They are **records, not accounts**: a technician has no login (that is explicitly out of scope). The list has _Active_, _Inactive_ and _All_ tabs with counts, a search that finds a name, email address, specialty or phone number (punctuation in a number does not matter), and pages of twenty, all kept in the address. **Add technician** opens a side sheet (name, optional phone and email, up to eight specialty tags, a calendar colour from a fixed palette, and private notes); a technician's page (`/app/technicians/<id>`) shows their details, the **jobs they have coming up in the next 14 days** and how much of each of the **next 7 days is already booked**, and has **Edit**, **Deactivate** and **Reactivate**. Deactivating asks first and says what happens: the jobs already assigned **stay assigned** (you can reassign each one from the job, T17) and the technician stops being offered for new ones. The jobs and hours come from the real work orders. Working hours are not tracked, so "Free" means nothing is booked. Internal notes are for the team only. See `docs/API.md` (Technician resources), `docs/ARCHITECTURE.md` §23 and decision D-103.

**The calendar** in the admin area (`/app/calendar`, T19) shows the scheduled visits as a **week** (Monday to Sunday, an hour grid in the business's time zone), a **day** (optionally one column per technician) or an **agenda** list (the default on a phone), for everyone or one technician; the view, date and technician are in the address. A visit is a block in its technician's colour with its status as an icon and in words; visits at the same time sit side by side. Opening a visit shows a drawer with **Reschedule** (the same dialog as on the job page, which now says "Move JOB-… from … to …?" and shows a server conflict clearly) and a link to the job. A **Needs scheduling** panel lists new jobs and those that need a new time, each with **Schedule**. Dragging, a month view and working hours are not built. See `docs/API.md` (Scheduling calendar), `docs/ARCHITECTURE.md` §26 and decision D-107.

## Quotations (the business)

Once a request is under review, **Create quotation** on its page (`/app/requests/<id>`, T14) starts a draft that the server fills in: the currency and tax rate from the business settings, a valid-until date a few days ahead, the default terms and one starter line for the service. The editor (`/app/quotations/<id>`) holds several line items (description, quantity, unit price, a taxable box), one fixed discount and the tax rate; the totals beside it are a **preview** from the same calculation the server runs, and **Save draft** stores the lines while the server works every total out again (a total sent from the browser is refused). **Preview** shows the customer's view of the saved draft; **Send to customer…** asks first, says the quotation cannot be edited afterwards, then notifies the customer in their portal and by email. A sent quotation is never edited: **Replace** starts a new draft from it, and sending that voids the old one with "Replaced by QT-…"; **Void** (a reason is required, and a sent quotation's customer is told, without the reason) withdraws one. A sent quotation that its last day passes without an answer becomes **Expired** and the request goes back under review; cancelling a request voids its open quotations. A quotation prints as the document alone. See `docs/API.md` (Quotations) and `docs/ARCHITECTURE.md` §21.

## Jobs and scheduling (business admin)

When a customer accepts a quotation, **Create job** (T17) appears as the main button on the accepted request and on the quotation. It makes **one** job from it (pressing it twice, or from two tabs, opens the same job), copies the customer, service and address, and opens the job with the scheduling dialog ready. **Jobs** in the admin navigation (`/app/jobs`) has the tabs _Needs scheduling_, _Upcoming_, _In progress_, _Ready to invoice_, _Completed_ and _All_ (with counts), a search, a technician filter and a date range, all kept in the address. A job's page (`/app/jobs/<id>`) shows when it happens and with whom, the scope and the accepted quotation's lines, the address with its access notes, the customer, and the history. **Schedule** (or **Reschedule**) asks for a day, a start time, how long and a technician. The times are **the business's clocks** (the dialog says "Times in America/New_York (EST)" whatever time zone the device is set to), only active technicians are offered, and while you choose, the dialog shows the technician's other jobs that day and checks the exact time. **The server refuses overlapping visits for one technician** (back-to-back is fine), even when two admins save at the same moment. Moving a scheduled job needs a reason (kept for your team only); the customer is told the new date and time by notification and email, never the technician or the reason. See `docs/API.md` (Work orders and scheduling), `docs/ARCHITECTURE.md` §24 and decisions D-24, D-25, D-104 and D-105.

**The job's life (T18).** A job's page shows a progress line (Pending scheduling → Scheduled → In progress → Completed, with "needs a new time" and "cancelled" shown as ways off the path) and the buttons the server allows. **Start job** asks first and warns when the booked time has not come (you can still start it). **Complete job** asks for a **summary for the customer** (10 to 2000 characters: what was done, parts replaced, any advice) and an optional **internal note**; each note is labelled on the page with who can read it. **Needs rescheduling** and **Cancel job** ask for an internal reason and an optional message to the customer, and say what will happen. A job that needs a new time keeps its old appointment as "Previously scheduled" but no longer holds the technician's time; book it again with **Schedule**. A completed job appears under **Ready to invoice** until it has an invoice (the invoice itself arrives with T20). The customer is told in their portal and by email when a job needs a new time, is complete or is cancelled, and **never** receives an internal note or a reason. The server refuses a status change that D-24 does not allow (a pending job cannot be completed, a job in progress cannot be cancelled) and leaves the job unchanged; two admins acting at once get one change and one "someone else changed this job".

**Jobs (the customer).** **Jobs** in the portal (`/portal/jobs`, T18) lists upcoming jobs and past ones as cards with the date and time (on the business's clocks), the service, the status and the technician's first name. A job's page says, in plain words, where things stand, then what, when, where and who, what was done once it is complete, the history, and links back to the request and the quotation. The overview has **Upcoming visits**, and a request's page links to its job. A customer can only open their own jobs, and never sees an internal note, a cancellation reason or a technician's phone or email. See `docs/API.md` (Work orders and scheduling), `docs/ARCHITECTURE.md` §25 and decision D-106.

## Invoices (the business)

**Invoices** in the admin area (`/app/invoices`, T20) are made from completed jobs. On a completed job, **Create invoice** starts a draft filled in from the quotation the customer accepted (its lines, discount, tax rate and currency, and a due date of today plus the usual number of days); the same button is in each row of the **Ready to invoice** tab on the jobs list. The draft is edited on its own page: change or add lines (extra parts or labour), set the discount, tax rate, dates and a note for the customer, **Save draft** (the server works the totals out again; the totals beside the form are only a preview), **Preview** it, and **Issue invoice** after a confirmation that says this assigns the number and locks it. Issuing takes the next `INV-YYYY-NNNNN`, freezes the business, customer, payment instructions and footer on the invoice (a later change of settings, name or price does not alter it), tells the customer in the portal and by email, and shows the print-ready document with its status banner (for example "Overdue by 4 days"), a **Payments received** panel kept apart from the invoice (see below), the details and the history. An issued invoice cannot be edited: to correct it, **Void** it with a reason (not possible once a payment is recorded against it) and start a new one; the voided invoice stays in the history with its number. An invoice becomes overdue after the end of its due date in the business's time zone. The list has status chips with counts (Draft, Issued, Partially paid, Overdue, Paid, Void), a search by number, customer or job, a due-date range and sorting. See `docs/API.md` (Invoices), `docs/ARCHITECTURE.md` §27 and decision D-108.

**Payments (T21).** FixFlow takes no money: on an issued invoice the panel's **Record payment** is for money you already received outside FixFlow. It asks for the amount (starting as the balance), the date received (today on the business's clock), how it was received (cash, bank transfer, card terminal, cheque or other), and an optional reference and notes (never card numbers or bank logins). The balance and status follow: a part payment makes the invoice **Partially paid** (still **Overdue** if it is past due), the exact balance makes it **Paid**, and the server refuses more than is owed ("This payment exceeds the remaining balance of …"), even when two admins record at the same moment. The customer is told in their portal and by email that it was **recorded**. Nothing can be edited or deleted: a mistake is corrected with **Void…** (a reason is required; the payment stays in the list as Voided and the balance goes back up) and a new record. An invoice with a payment on it cannot be voided until its payments are. See `docs/API.md` (Payments), `docs/ARCHITECTURE.md` §28 and decision D-109.

## Quotations (the customer)

A customer is told in their portal and by email when a quotation is sent (T15). The overview (`/portal`) leads with **Awaiting your decision**: each quotation still open, with its total and how long is left ("Valid until Nov 17, 2026 — 5 days left"). A request's page carries a **Quotation** card with the current one and, below it, the earlier versions, each pointing to the one that replaced it. The quotation itself (`/portal/quotations/<id>`) reads as a document and prints as the document alone (A4 and Letter). While it is open the customer can **Accept quotation** or **Decline** (with an optional "why"); each asks first, accepting says that it "records your acceptance; it is not a contract signature", and a second click cannot send a second answer. The business is told in its dashboard (a notification for every admin) and by one email to its contact address, the request becomes Accepted or Declined, and the quotation page shows who answered and when. A quotation that has expired or been withdrawn shows a banner with how to reach the business and no buttons; an answer to one is refused in words that say what happened. Only the quotation's owner can open or answer it, and accepting and declining together are limited to 20 an hour per customer. See `docs/API.md` (Customer quotation decisions) and `docs/ARCHITECTURE.md` §22.

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

The visual identity, tokens, status vocabulary, patterns and screen blueprints are in [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md). How the public website reads and caches its data is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §16. How the system fits together is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the HTTP conventions (response envelope, errors, pagination, rate limits, sessions and CSRF) and the endpoint reference are in [`docs/API.md`](docs/API.md). The sign-in, Google, account-linking and password-reset flows are drawn in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §13. Deploying the hosted preview (Vercel, Render, Neon, Upstash): the environment variables, first-time setup, migrations, seeding, rollback and troubleshooting are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md); the Render Blueprint is [`render.yaml`](render.yaml).

Start with [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md). The canonical specification is [`docs/FixFlow_Project_Documentation.docx`](docs/FixFlow_Project_Documentation.docx) (searchable copy: [`docs/FixFlow_Project_Documentation.md`](docs/FixFlow_Project_Documentation.md)); resolved decisions and open questions are in [`docs/DECISIONS_AND_OPEN_QUESTIONS.md`](docs/DECISIONS_AND_OPEN_QUESTIONS.md). Contributor and AI-assistant instructions are in [`CLAUDE.md`](CLAUDE.md).
