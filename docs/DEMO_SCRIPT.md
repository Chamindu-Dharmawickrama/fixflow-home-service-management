# FixFlow — Demo script (2 to 3 minutes)

A walk-through for a video or a live demonstration. It follows the primary journey end to end on the real running application, with fictional data, and shows the result a buyer cares about rather than the code. The clicks below are the ones the project's hosted journey test drives, so each screen and label exists as written.

**Total: about 2 minutes 50 seconds.** If you need under 2 minutes, drop scenes 1's service page and 8's PDF, and say less in 6.

## Before you record

1. **Start from clean data.** Reset the demo so the dashboard, the calendar and Alex's portal are in their showcase state:
   - local: `DEMO_MODE=true CONFIRM_DEMO_RESET=fixflow_dev npm run db:reset-demo` (the value must be the name of the database in `DATABASE_URL`; the command refuses otherwise);
   - hosted: run the **reset-demo** GitHub Actions workflow, or the command from [DEPLOYMENT.md](DEPLOYMENT.md#6a-the-demos-data-showcase-reset-and-safeguards).
2. **Two browser windows**, one normal and one private, side by side or switched with a keyboard shortcut, so you can be the customer and the admin without signing out. Window size about 1440 × 900; browser zoom 100%; hide bookmarks and extensions.
3. **Sign in beforehand** (off camera): the customer window as **Alex Morgan** `alex.morgan@example.test`, the admin window as **Morgan Reyes** `admin@demo.fixflow.test`. The sign-in page's "Demo accounts" panel prints the published demo passwords, so do not record that page. The passwords are in the [README](../README.md#demo-accounts) for a local run; a hosted demo uses its own.
4. **Close the demo banner's distraction** only if you like: it says the business is fictional, which is true and worth leaving in the first shot.
5. **Check Jordan Lee is free** on the day you will book (the demo data keeps three free days this week). The scheduling dialog tells you.
6. Notifications are real. Alex has three unread and the admin has eight; that is fine, and it shows the bell.

## The walk-through

### 1. The public website (0:00 – 0:20)

**Window:** a signed-out view of the site. Use a third private window, or sign Alex out for this shot and back in after.

| Click | You see |
| --- | --- |
| Open the home page `/` | CoolBreeze Home Services: a headline that says what the business does, the four steps of how it works, the services, the contact details |
| Click **Services** in the header | Five services with prices or "Request a quote", and a category filter |
| Click **AC Diagnostic Visit** | The service page: what is included, how long it takes, the pricing note, **Request this service** |

**Say:** "This is the public website of a small home-service business. It reads its name, contact details and services from the same system the owner runs the business with. A customer starts here."

### 2. A customer sends a request (0:20 – 0:40)

**Window:** customer (Alex).

| Click | You see |
| --- | --- |
| **Request this service** (or **Request a service**) | The request form, one page of five numbered sections, with the service already chosen |
| Describe the problem: "The upstairs air conditioner runs but blows warm air, and the outdoor unit hums without the fan turning." | A character counter |
| Leave Alex's saved address selected; pick a preferred date a few days ahead and **Morning** | The review section fills in as you choose |
| **Send request** | "Your request has been sent", with a reference like `FF-2026-00021` and the request's page, status **Submitted** |

**Say:** "The customer describes the problem, picks an address and a preferred time. That is a preference, not a booking. The server gives it a reference and tells the business."

### 3. The admin sees it (0:40 – 0:55)

**Window:** admin (Morgan).

| Click | You see |
| --- | --- |
| **Dashboard** (reload if it is already open) | **New requests** and **Requests needing action** have each gone up by one; the **Needs attention** queue lists the new request as a **New request** with a **Review request** button (that queue is oldest first, so you may need to scroll) |
| Click **Requests** in the sidebar | The queue, newest first: the new request is the top row, status **Submitted**. Click its reference |
| (You are on the request page) | What the customer wrote, their contact details, their other requests and the history |

**Say:** "The dashboard is read from the database, not made up: the figures went up the moment the customer sent the request. In the queue, the new request is the top row."

### 4. The admin creates and sends a quotation (0:55 – 1:20)

**Window:** admin.

| Click | You see |
| --- | --- |
| **Start review** | Status moves to **Under review** |
| **Create quotation** | The editor, with a first line for the service. The totals beside it are labelled a preview |
| Edit line 1 to "AC diagnostic visit (1 hour)", quantity 1, price 89.00. **Add line**: "Run capacitor", 1, 45.50, tick **Taxable**. Check **Tax rate (%)** reads 8.00 (the business default) | Subtotal 134.50, tax 3.64, total **138.14**, updating as you type |
| **Save draft** | "Draft saved" |
| **Send to customer…**, then **Send to customer** in the dialog | The dialog says a sent quotation cannot be edited; afterwards the page is read-only with status **Sent** |

**Say:** "The totals shown while typing are a preview. When I save, the server works every figure out again from the lines. A figure sent from the browser would be refused. Once it is sent, it cannot be edited; I can only replace or void it."

### 5. The customer accepts (1:20 – 1:35)

**Window:** customer.

| Click | You see |
| --- | --- |
| Reload the overview `/portal` | **Action required: Awaiting your decision** lists two quotations: an older one from the demo data (Electrical Safety Inspection) and yours (AC Diagnostic Visit, $138.14) |
| **Review quotation** on yours | The quotation as a document, with **Accept quotation** and **Decline** below it |
| **Accept quotation**, then **Accept quotation** in the dialog | The dialog says it "records your acceptance; it is not a contract signature". Afterwards the page says who answered and when |

**Say:** "The customer reads exactly what was sent and answers once. Pressing twice, or from two tabs, can only ever record one answer."

### 6. The admin schedules and completes the job (1:35 – 2:05)

**Window:** admin.

| Click | You see |
| --- | --- |
| Open the request's page again (or **Requests** and the request) | Status **Accepted** and a **Create job** button |
| **Create job** | A job such as `JOB-2026-00014`, status **Pending scheduling**, and the scheduling dialog already open |
| **Date**: tomorrow or the next free day (the dialog lists Jordan's other jobs that day and checks the exact time; the demo data books Jordan on one of the next working days); **Start time** 10:00; leave **How long**; **Technician** Jordan Lee | "Times in America/New_York (EST)" and the check "Jordan Lee is free at that time." |
| **Schedule visit** | "JOB-… is scheduled"; status **Scheduled**; the appointment card names Jordan Lee |
| **Start job**, then **Start job** in the dialog | The dialog notes the booked time is later than now (it warns, it does not block); status **In progress** |
| **Complete job**, write "Replaced the failed run capacitor on the outdoor unit and checked the refrigerant pressure. The system now cools normally.", then **Complete job** | "JOB-… is complete"; status **Completed**; the page shows **Create invoice** |

**Say:** "The business creates one job from the accepted quotation and books it with a technician. The system refuses to double-book that technician. The summary I just wrote is what the customer will read; internal notes never go to the customer."

### 7. The admin issues the invoice and records payment (2:05 – 2:30)

**Window:** admin.

| Click | You see |
| --- | --- |
| **Create invoice** | **Draft invoice**, filled from the accepted quotation: the same $138.14 |
| **Issue invoice…**, then **Issue invoice** | The number `INV-2026-0000N` is assigned and the invoice is locked; the print-ready document with a status banner |
| In **Payments received**, **Record payment**: amount 100.00, **Bank transfer**, then **Record payment** | Status **Partially paid**; balance due 38.14 |
| **Record payment** again: 38.14, **Cash** | Status **Paid**; balance due $0.00 |

**Say:** "FixFlow takes no money. A payment here is a record of money the business already received. It records the amount, the date and how, and the status follows from the numbers. If I made a mistake I would void the payment with a reason and the history keeps both."

### 8. The customer sees the final state (2:30 – 2:50)

**Window:** customer.

| Click | You see |
| --- | --- |
| **Jobs**, open the job | **Completed**, the plain-words explanation, what was done (the summary), the technician as "Jordan" (first name only), links to the request and the invoice |
| Click the invoice | **Paid in full**, the document, the payments received (100.00 bank transfer, 38.14 cash) |
| **Download PDF** | `INV-2026-0000N.pdf`, built on the server from the invoice as it was issued |

**Say:** "The customer sees the finished job and a paid invoice with its payments, and can download the PDF. They only ever see their own records, and nothing internal."

## Closing line (about 10 seconds)

"That is FixFlow: a request, a quotation, a booked job, an invoice and a payment, in one connected application for a small service business. It is a portfolio project with fictional data. The code, the tests and the architecture notes are in the repository."

## Optional extras (if you have time)

- **Phone view:** resize to 390 px wide and show Alex's portal overview; "Action required" comes first.
- **The calendar:** `/app/calendar`, the week view with Jordan Lee's visit in their colour.
- **Another customer:** sign in as Priya Shah `priya.shah@example.test` and show that Alex's request is nowhere in her portal.

## After recording

Reset the demo again, the same way as before, so the next visitor finds the showcase state and not the journey you just made. Do not leave the finished request, job, invoice and payments in a public demo.

## Notes

- If a screen differs from this script (a status, a label), the application is right: update this document.
- Email: the demo accounts' addresses are on reserved domains, so the emails the journey sends (request received, quotation sent, job scheduled, invoice issued, payment recorded) are logged, not delivered, and the application says so.
- All names, addresses and amounts are fictional. Say so at least once.
