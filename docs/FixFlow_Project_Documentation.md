# FixFlow — Project Documentation

**Product:** FixFlow — Home Service Business Management Platform  
**Document type:** Product Requirements + Functional Specification + Technical Blueprint  
**Version:** 1.0  
**Status:** Baseline specification for portfolio implementation  
**Intended audience:** Product owner, developer, UI/UX designer, AI coding assistant, portfolio reviewers

> **Project premise:** FixFlow is a self-initiated portfolio product. It is designed to demonstrate the ability to turn a recognizable business problem into a polished, end-to-end web application. It must not be represented as a paid client implementation or as a production-ready commercial system unless it has actually been commissioned, reviewed and operated as one.

---

## Contents

1. Executive summary  
2. Problem statement and opportunity  
3. Product vision, goals and non-goals  
4. Target users and roles  
5. Scope, assumptions and product boundaries  
6. Product concepts and status models  
7. End-to-end workflows  
8. Functional requirements  
9. Information architecture and screen inventory  
10. UI/UX and visual design requirements  
11. Business rules and validation  
12. Data model  
13. Technical architecture and stack  
14. API design outline  
15. Security, privacy and reliability  
16. Non-functional requirements  
17. Acceptance criteria  
18. Testing strategy  
19. Demo data and showcase scenario  
20. Implementation roadmap  
21. Deployment and repository standards  
22. Fiverr portfolio presentation plan  
23. Risks and mitigations  
24. Future enhancements  
25. Glossary

---

## 1. Executive summary

FixFlow is a web-based operations platform for a small home-service company, such as an air-conditioning maintenance provider, appliance repair company, cleaning service, electrician, or general home-maintenance business. It connects the public service website with an internal management dashboard and a customer portal.

The central workflow is:

**Customer submits a service request → business reviews the request → business sends a quotation → customer accepts or declines → business schedules the job → work is completed → invoice is issued → payment status is recorded.**

The product addresses the operational friction that occurs when a small business manages enquiries, customer details, appointment schedules, quotations, job updates and invoices across phone calls, messaging apps, spreadsheets and separate documents.

FixFlow is not intended to replace a full enterprise field-service suite in its first release. Its goal is to implement one coherent, believable workflow extremely well. The UI quality, realistic data, responsive layout, clear status transitions, proper validation and dependable end-to-end behaviour are as important as the technology stack.

### Product summary

| Item | Decision |
|---|---|
| Product type | Responsive web application with public website, business dashboard and customer portal |
| Primary business | Small home-service / repair / maintenance company |
| Main users | Business administrator/staff and customers |
| Core value | One place to manage a request from initial enquiry through completed work and invoicing |
| Portfolio objective | Demonstrate professional UI/UX, full-stack engineering, API design, data modelling, authorization and business workflow implementation |
| MVP deployment | One configured demo business; not multi-tenant SaaS |
| Payments | Record payment status manually; no live payment gateway in MVP |
| AI | Not required for MVP; considered as a later optional feature |

## 2. Problem statement and opportunity

### 2.1 The problem

Small service businesses often use several disconnected tools to operate. A new request may arrive by phone, a social message or a website form. Customer details are manually copied into a spreadsheet. The owner sends a price estimate as a document or message, tracks acceptance in a chat, schedules the technician in a calendar and creates an invoice separately after the job.

This fragmented approach can create avoidable problems:

- **Scattered customer information:** contact details, addresses and previous jobs are stored in different places.
- **Unclear request status:** staff can lose track of which enquiries need a response, which quotations are waiting for approval and which jobs are ready to schedule.
- **Scheduling mistakes:** appointments can overlap, change without a clear record or be forgotten.
- **Manual quotation work:** pricing and line items may be recreated each time, making mistakes more likely.
- **Limited customer visibility:** customers repeatedly contact the business to ask whether a quotation was accepted or when a technician will arrive.
- **Slow invoicing:** invoice creation is disconnected from the completed job.
- **Little operational visibility:** owners cannot quickly see pending requests, upcoming jobs, outstanding invoices or the current workload.

FixFlow does not assume every small business has all these problems. It provides a focused digital workflow that makes these activities easier to manage and easier to understand.

### 2.2 Example scenario

A customer notices that an air conditioner is not cooling and requests a repair through the service website. The business receives the request in FixFlow, reviews the description and customer details, and prepares a quotation with labour and parts. The customer signs in to the portal, reviews the quotation and accepts it. The business schedules the job and assigns a technician resource. Staff update the job to in progress and then completed. FixFlow generates an invoice from the agreed work and the business records the payment once it has actually been received.

At each step, the customer and business see the appropriate status without relying on an unstructured message history.

### 2.3 Opportunity

The project demonstrates capabilities that are relevant to many freelance software-development engagements:

- marketing and service websites;
- admin dashboards and internal tools;
- customer portals;
- booking and scheduling interfaces;
- REST API and database integration;
- forms, validation and role-based access;
- document/PDF generation;
- workflow automation and status tracking.

The intended portfolio signal is not that FixFlow has already achieved commercial results. It is that the developer can reason about a real business workflow and implement a polished, verifiable example of one.

## 3. Product vision, goals and non-goals

### 3.1 Product vision

Make it easy for a small service business to manage a customer's journey from the first service request to the final invoice, while giving customers a clear and professional way to request work and track progress.

### 3.2 Goals

1. Deliver one end-to-end service-request-to-invoice workflow that works against a real database.
2. Provide a visually polished public website and an equally professional business dashboard.
3. Provide a customer portal in which customers can review their own requests, quotations, jobs and invoices.
4. Give business staff clear queues, filters and status indicators so they can identify the next action.
5. Model the main business entities and state transitions cleanly.
6. Demonstrate secure authentication, server-side authorization, input validation and reliable error handling.
7. Deploy a usable demo and provide a README, seeded demo data, screenshots and a short walkthrough.

### 3.3 Success criteria for the portfolio version

The project is successful when:

- a reviewer can understand the product within 30 seconds of opening the website;
- the public website, dashboard and customer portal share one consistent design system;
- the complete primary workflow can be demonstrated without manually editing database records;
- the UI works at common desktop, tablet and mobile widths;
- no key button is decorative or non-functional;
- status changes are validated on the server and reflected in connected screens;
- the demo includes realistic but fictional data;
- setup and demo instructions are clear enough for another developer to run the project;
- the project is honest about its portfolio status and does not claim fabricated client outcomes.

### 3.4 Non-goals for the MVP

The first release will not include:

- a multi-tenant SaaS architecture where many unrelated businesses sign up and manage isolated accounts;
- subscriptions, plans or billing for using FixFlow;
- a real payment gateway or storage of card details;
- route optimization, GPS tracking or live technician location;
- a native iOS/Android app;
- full accounting, tax filing or compliance-grade financial reporting;
- payroll, inventory procurement or supplier management;
- automated WhatsApp/SMS messaging;
- customer reviews, marketing campaigns or loyalty points;
- complex approval chains or a configurable workflow builder;
- an AI chatbot as a substitute for the core product.

These features may be future enhancements, but they must not delay a complete and polished MVP.

## 4. Target users and roles

### 4.1 Primary customer profile

A small business owner or office administrator who coordinates incoming service enquiries, prices work, books appointments, communicates with customers and issues invoices. The product should be understandable to a non-technical operator who does not want to learn a complicated enterprise system.

### 4.2 User roles

| Role | Description | MVP permissions |
|---|---|---|
| Business Admin | Owner or authorized staff member managing the service operation | View/manage all business records, services, customers, quotations, jobs, invoices and settings |
| Customer | Person or household requesting service | Manage own profile; create and view own requests; view and respond to own quotations; view own jobs and invoices |
| Technician resource | Person assigned to a job | Represented as an assignable staff/resource record in MVP; no separate login required |
| Visitor | Person viewing the public website | Browse public pages and services; must sign in or register before submitting a request |

The MVP deliberately uses two authenticated roles: **Business Admin** and **Customer**. A technician is a record assigned by staff, not a separate login role in the first release. This keeps authorization and scope manageable while still demonstrating scheduling and assignment.

### 4.3 Key user needs

**Business Admin** needs to:
- know what needs attention today;
- review requests and respond consistently;
- generate a clear quotation without recalculating totals manually;
- schedule a job and avoid accidental double booking of the same technician/time slot;
- find customer history quickly;
- see completed work that still needs invoicing or payment follow-up;
- correct mistakes through deliberate, auditable actions.

**Customer** needs to:
- understand what services are available;
- request a service without confusion;
- receive a clear request reference and status;
- understand the quotation and accept or decline it;
- see the scheduled time and current job status;
- open an invoice and understand what is owed;
- know when an action succeeds or fails.

## 5. Scope, assumptions and product boundaries

### 5.1 MVP scope

The MVP includes:

1. Public marketing website and service catalogue.
2. Customer registration, login and profile.
3. Business admin login and protected dashboard.
4. Service request submission and request management.
5. Customer records and service history.
6. Quotations with multiple line items, tax/discount fields and explicit approval/decline.
7. Work orders created from accepted quotations.
8. Calendar/list scheduling and technician resource assignment.
9. Work order status updates and an activity timeline.
10. Invoice creation from an approved work order/quotation.
11. Manual payment recording and invoice status tracking.
12. In-app notifications and configurable transactional email integration.
13. Dashboard metrics, searchable lists, filters and pagination.
14. Responsive UI, seed data, test coverage and deployment documentation.

### 5.2 Assumptions

- FixFlow is configured for one fictional service business in the demo environment.
- The business can configure its display name, logo, contact details, currency, timezone and basic tax rate.
- Prices are represented using a decimal-safe money type; use the currency configured by the business. Demo content can use USD for international portfolio readability.
- The application is not a certified accounting system. Tax values and invoices are demonstration/operational records, not legal or tax advice.
- A customer account is required before creating a service request. This simplifies secure customer self-service for the portfolio MVP.
- Customers can only access records associated with their own account; business admins can access all records in the configured demo business.
- Email delivery depends on an external provider being configured. In local development, the app should log or preview outgoing messages safely rather than silently pretending they were delivered.
- Payment status is entered by authorized business staff after receiving payment outside the application.
- No confidential or real customer data will be used in the public demo.

### 5.3 Product boundary

FixFlow coordinates service work; it does not perform the physical service, guarantee technician arrival, collect payment electronically or automatically verify that a customer has paid. The UI must not imply those actions occurred unless the relevant record is explicitly updated.

## 6. Product concepts and status models

### 6.1 Core domain concepts

- **Service:** A type of work the business offers, such as AC maintenance or appliance repair.
- **Service Request:** A customer's initial request describing the problem and preferred appointment window.
- **Quotation:** A priced proposal for work. A quotation can contain several line items.
- **Work Order / Job:** The operational record for work the business has agreed to perform.
- **Technician Resource:** A person the business can assign to a job.
- **Invoice:** A bill issued for completed/agreed work.
- **Payment Record:** A manual record of an amount received, including method, date and reference if supplied.
- **Activity Event:** A timestamped description of an important action for the record history.
- **Notification:** An in-app or email message about an important event.

### 6.2 Service request statuses

| Status | Meaning | Allowed next actions |
|---|---|---|
| SUBMITTED | Customer submitted the request | Business may start review or cancel |
| UNDER_REVIEW | Business is assessing the request | Business may prepare/send a quote or cancel with a reason |
| QUOTED | At least one current quotation was sent to the customer | Customer may accept or decline; business may revise by creating a new version/quotation according to implementation rules |
| ACCEPTED | Customer accepted the quotation | Business schedules/creates the work order |
| DECLINED | Customer declined the quotation | Business may close the request; reopening requires an explicit admin action if supported |
| CONVERTED_TO_JOB | A work order was created from the accepted request | Follow work-order status instead of editing request state |
| CANCELLED | Request cancelled before job execution | Terminal state for MVP |

The request status is a summary of the enquiry. Quotation and work-order statuses are separate records and remain the authoritative state for those parts of the workflow.

### 6.3 Quotation statuses

| Status | Meaning |
|---|---|
| DRAFT | Internal draft; not visible as an offer to the customer |
| SENT | Published to the customer portal; awaiting response |
| ACCEPTED | Customer explicitly accepted this quotation |
| DECLINED | Customer explicitly declined this quotation |
| EXPIRED | No longer available for acceptance after the configured validity date |
| VOID | Withdrawn by business staff before acceptance, with an audit reason |

For the MVP, do not edit a SENT quotation in place. If the business must change an offer, create a replacement quotation and clearly mark the previous one as VOID or EXPIRED as appropriate. This avoids changing a price after the customer has reviewed it.

### 6.4 Work-order statuses

| Status | Meaning |
|---|---|
| PENDING_SCHEDULING | Quotation accepted; date/time not yet confirmed |
| SCHEDULED | Appointment date/time and required assignment recorded |
| IN_PROGRESS | Business staff marked work as started |
| COMPLETED | Work is finished; eligible for invoicing |
| CANCELLED | Work will not proceed; reason required |
| NEEDS_RESCHEDULING | Existing schedule needs a new time; business must follow up |

The MVP must enforce sensible transitions. For example, a job cannot be marked COMPLETED directly from PENDING_SCHEDULING without first being scheduled and started, unless an explicitly documented admin correction flow is introduced.

### 6.5 Invoice statuses

| Status | Meaning |
|---|---|
| DRAFT | Editable invoice not yet issued |
| ISSUED | Invoice has been issued; balance is outstanding |
| PARTIALLY_PAID | Recorded payments are greater than zero but below the amount due |
| PAID | Recorded payment total equals or exceeds the amount due |
| OVERDUE | Issued invoice has passed its due date and has an outstanding balance |
| VOID | Invoice was cancelled with a reason; it must not be deleted from history |

Invoice status should be calculated/updated consistently from issue state, due date, total and payment records. Staff should not be able to set an inconsistent status that conflicts with the recorded balance.

## 7. End-to-end workflows

### 7.1 Customer requests a service

1. Visitor browses the public homepage or service catalogue.
2. Visitor opens a service detail page and selects **Request this service**.
3. If unauthenticated, the user is asked to register or sign in and is returned to the request flow afterward.
4. Customer chooses a service, enters a concise problem description, service address and preferred date/time window, and submits the form.
5. Server validates the data, creates a Service Request linked to the customer and generates a readable unique reference (for example `FF-2026-00125`).
6. Customer sees a confirmation screen with the reference and current status `SUBMITTED`.
7. The request appears at the top of the business dashboard's request queue and an in-app notification is created. If email is configured, a confirmation email may also be sent.

**Important:** the reference number is not an authorization secret. Access to detailed request information still requires authentication and ownership/role checks.

### 7.2 Business reviews and prepares a quotation

1. Admin opens the request queue and filters by status/date/service.
2. Admin opens the request details to review contact information, address, description, preferred time and previous customer jobs.
3. Admin sets the request to `UNDER_REVIEW` and records an internal note if necessary.
4. Admin creates a quotation and adds one or more line items. Each line item has a description, quantity, unit price and optional taxable flag/category.
5. Server calculates line totals, subtotal, discount, tax and grand total. Client-calculated values are never trusted.
6. Admin sets a valid-until date and previews the customer-facing quotation.
7. Admin sends the quotation. The quotation moves to `SENT`, and the request summary becomes `QUOTED`.
8. Customer receives an in-app notification and, when configured, an email notification.

### 7.3 Customer accepts or declines a quotation

1. Customer opens the quotation from the portal.
2. The screen displays line items, subtotal, discount/tax, total, validity date, service description and the business's terms/notes.
3. Customer chooses **Accept quotation** or **Decline quotation**. A confirmation step prevents accidental submission.
4. The server verifies that the quotation belongs to the authenticated customer, is still `SENT`, and has not expired.
5. If accepted, status becomes `ACCEPTED`; the acceptance timestamp and actor are stored. The request becomes `ACCEPTED` and an activity event is added.
6. If declined, the status becomes `DECLINED`; an optional reason may be captured. The request status is updated accordingly.
7. Business staff see the decision in their dashboard.

Acceptance is a recorded business decision, not an electronic signature or a legally certified contract feature.

### 7.4 Business schedules a job

1. Admin opens accepted quotations or the `PENDING_SCHEDULING` queue.
2. Admin creates the work order from the accepted quotation. The work order inherits the customer, address, service and agreed commercial details.
3. Admin selects appointment start/end time and a technician resource.
4. The server checks that end time is after start time and warns/blocks if the same technician has an overlapping active appointment. For this portfolio MVP, the scheduling policy should be documented and deterministic.
5. When the work order is created, request status becomes `CONVERTED_TO_JOB` and the work order starts at `PENDING_SCHEDULING`. After the appointment and resource are confirmed, the work-order status becomes `SCHEDULED`.
6. Customer portal shows the scheduled time, service address and job reference. Notifications are generated.
7. Staff can mark the job `IN_PROGRESS` when work begins.

### 7.5 Job completion

1. Staff opens the work order and reviews its scope, customer information, appointment and assigned resource.
2. When work is finished, staff records a completion note and optionally records work performed/parts used as descriptive line items.
3. Staff marks the job `COMPLETED`. The server validates the transition and writes an activity event.
4. The job appears in the dashboard's **Ready to invoice** list until an invoice is issued.
5. Customer can see that the job was completed and any completion note intended for customers. Internal notes must remain private.

### 7.6 Invoice issuance and manual payment tracking

1. Admin chooses **Create invoice** from a completed work order.
2. The app copies agreed billable line items into a draft invoice and calculates totals server-side. Staff reviews and adjusts only fields the business rules permit.
3. Admin sets the issue date, due date and customer-facing note, previews the printable invoice and issues it.
4. Invoice status becomes `ISSUED`, a unique invoice number is assigned and a PDF is generated or made available for download.
5. Customer opens the invoice in the portal and views/downloads the PDF.
6. When payment is received outside FixFlow, authorized staff records the amount, date, method and optional transaction/reference note.
7. The system recalculates the outstanding balance and invoice status (`PARTIALLY_PAID`, `PAID` or `OVERDUE` as applicable).
8. All payment corrections or removals must be controlled and audit logged. Do not silently delete payment history.

No card data, bank login information or payment gateway credentials are handled by the MVP.

### 7.7 Customer returns to view progress

The customer portal shows a clear chronological list of requests and associated records. The customer can open a record, understand its current status, review the next known step and see customer-facing history. Private internal notes, other customers' data and staff-only metadata are never displayed.

## 8. Functional requirements

Requirements marked **MUST** are necessary for the portfolio MVP. **SHOULD** indicates valuable if time allows. **FUTURE** is outside initial delivery.

### 8.1 Public website and service catalogue

- **FR-001 — MUST:** Provide a branded public homepage with a clear headline, service summary, primary call to action, trust elements, service highlights and contact information.
- **FR-002 — MUST:** Display active services with name, category, short description, image/icon, and starting price or “Request a quote” label.
- **FR-003 — MUST:** Provide a service detail page with fuller description, what is included, expected duration where applicable, and a request-service action.
- **FR-004 — MUST:** Make the public site responsive and accessible using semantic HTML, keyboard navigation, readable contrast and visible focus states.
- **FR-005 — SHOULD:** Include FAQs, service-area information and a small “How it works” section using fictional business content.
- **FR-006 — MUST:** Hide unpublished/inactive services from public browsing and prevent a customer from requesting an inactive service through a direct API call.

### 8.2 Authentication and user profile

- **FR-010 — MUST:** Support customer registration, login, logout and password reset if email delivery is configured; otherwise document a safe development fallback.
- **FR-011 — MUST:** Provide a protected business-admin area. Admin credentials must be seeded/managed securely and must not be hard-coded as production credentials in public source code.
- **FR-012 — MUST:** Enforce role and resource ownership on the server for every protected endpoint.
- **FR-013 — MUST:** Customers can view/update permitted profile fields and service addresses.
- **FR-014 — MUST:** Customers must not be able to change their role or access business-admin settings through request payload manipulation.
- **FR-015 — SHOULD:** Use secure HTTP-only cookies for session/refresh credentials if implementing cookie-based authentication; apply CSRF protections appropriate to the chosen auth design.

### 8.3 Service request management

- **FR-020 — MUST:** Authenticated customers can create a request for an active service with problem description, service address and preferred time window.
- **FR-021 — MUST:** The system assigns a unique human-readable request reference on the server.
- **FR-022 — MUST:** Customers can view only their own requests and customer-visible status/history.
- **FR-023 — MUST:** Admin can search, filter, sort and paginate requests by status, service, customer and submitted date.
- **FR-024 — MUST:** Admin can open a request, update its permitted status, add private internal notes and review relevant customer history.
- **FR-025 — MUST:** Status changes require valid transitions and create an activity event.
- **FR-026 — SHOULD:** Admin can cancel a request and must supply a reason; the reason may be internal or customer-visible depending on the field used.

### 8.4 Customer management

- **FR-030 — MUST:** Customer records include name, email, phone where provided, and one or more service addresses.
- **FR-031 — MUST:** Admin can search customers and view their request, job and invoice history.
- **FR-032 — MUST:** The system avoids accidental duplicate accounts through unique normalized email addresses for login identities.
- **FR-033 — SHOULD:** Admin can add internal customer notes, clearly separated from customer-visible notes.

### 8.5 Quotation management

- **FR-040 — MUST:** Admin can create a draft quotation linked to a service request and customer.
- **FR-041 — MUST:** A quotation supports multiple line items with description, quantity, unit price and line amount.
- **FR-042 — MUST:** Server calculates subtotal, discount, tax and total using decimal-safe arithmetic and the configured currency/tax rules.
- **FR-043 — MUST:** Admin can preview and send the quotation to the customer portal.
- **FR-044 — MUST:** Customer can accept or decline only a quotation belonging to their account and currently available for response.
- **FR-045 — MUST:** Acceptance/decline stores actor and timestamp and creates an activity event.
- **FR-046 — MUST:** A sent quotation cannot be silently edited. Changes require a replacement/withdrawal workflow.
- **FR-047 — SHOULD:** Quotation supports a valid-until date and customer-facing terms/notes.

### 8.6 Work orders and scheduling

- **FR-050 — MUST:** An accepted quotation can be converted to a work order without re-entering customer and service data.
- **FR-051 — MUST:** Work order includes reference, customer, service address, description/scope, scheduled start/end, assigned technician resource and status.
- **FR-052 — MUST:** Admin can view jobs in a list and calendar/schedule view.
- **FR-053 — MUST:** Admin can assign or change the technician resource and appointment time with valid permission.
- **FR-054 — MUST:** Validate scheduling timestamps and prevent or explicitly warn about overlapping appointments for the same technician. The chosen policy must be implemented consistently.
- **FR-055 — MUST:** Admin can transition a job through permitted statuses and record completion notes.
- **FR-056 — MUST:** Customer sees scheduled time, job status and customer-visible completion details for their own work orders.
- **FR-057 — SHOULD:** Provide a rescheduling action that records the old and new time and notifies the customer.

### 8.7 Technician resources

- **FR-060 — MUST:** Admin can create, update, deactivate and list technician resources with name, contact details and active status.
- **FR-061 — MUST:** Inactive technician resources cannot be assigned to new jobs.
- **FR-062 — SHOULD:** Display each technician's upcoming assigned jobs and provide an availability summary.
- **FR-063 — FUTURE:** Give technicians a dedicated login and mobile-friendly assigned-job interface.

### 8.8 Invoices and payment records

- **FR-070 — MUST:** Admin can create a draft invoice from a completed job and/or agreed billable items.
- **FR-071 — MUST:** Issuing an invoice generates a unique invoice number and records issue date and due date.
- **FR-072 — MUST:** An issued invoice can be viewed by the owning customer and downloaded/printed as a PDF.
- **FR-073 — MUST:** Admin can record a manual payment with amount, date, method and optional reference.
- **FR-074 — MUST:** The system calculates the remaining balance and invoice payment status consistently.
- **FR-075 — MUST:** Prevent overpayment unless the project explicitly chooses to record credit/refund handling; for MVP, a payment greater than the remaining balance should be rejected with a helpful error.
- **FR-076 — MUST:** Issued invoices and payment history cannot be silently deleted. Voids/corrections require a reason and audit event.
- **FR-077 — SHOULD:** Provide invoice filters by status, due date and customer.

### 8.9 Dashboard, search and reporting

- **FR-080 — MUST:** Display meaningful summary metrics: new requests, requests requiring action, jobs scheduled today/upcoming, completed jobs awaiting invoice and unpaid invoice balance.
- **FR-081 — MUST:** KPI values must be derived from database records and respect the selected period/business timezone; they must not be hard-coded.
- **FR-082 — MUST:** Provide a “Needs attention” section with direct links to actionable records.
- **FR-083 — MUST:** Use empty states with guidance when a list has no records.
- **FR-084 — SHOULD:** Provide CSV export for selected administrative lists, excluding unnecessary personal data.
- **FR-085 — SHOULD:** Allow date-range selection for dashboard metrics and explain what each metric counts.

### 8.10 Notifications and activity history

- **FR-090 — MUST:** Generate an in-app notification for key events: request received, quotation sent, quotation decision, job scheduled/rescheduled/completed and invoice issued/payment recorded.
- **FR-091 — SHOULD:** Send transactional email through a provider adapter when credentials and verified sender configuration are available.
- **FR-092 — MUST:** Distinguish notification creation from successful email delivery; failures must be logged and must not reverse the underlying business action.
- **FR-093 — MUST:** Record important state changes with actor, timestamp, entity, action and relevant non-sensitive summary.
- **FR-094 — MUST:** Keep internal notes and internal activity metadata hidden from customers.

### 8.11 Settings

- **FR-100 — MUST:** Provide editable business display name, logo/image, phone/email/address, currency, timezone and basic tax setting.
- **FR-101 — MUST:** Provide service management for creating, editing, publishing/unpublishing and archiving services.
- **FR-102 — SHOULD:** Allow configurable invoice footer/payment instructions and default quotation validity period.

## 9. Information architecture and screen inventory

### 9.1 Public routes

| Route | Purpose | Key elements |
|---|---|---|
| `/` | Public homepage | Hero, service highlights, process explanation, trust indicators, CTA, contact/footer |
| `/services` | Service listing | Search/category filters if needed, service cards, starting price/quote label |
| `/services/[slug]` | Service details | Service overview, inclusions, duration/notes, CTA |
| `/login` | Sign in | Validated form, error/help states |
| `/register` | Customer account creation | Name, email, password, confirmation and terms/privacy notice |
| `/request-service` | Request creation | Service, problem description, address, preferred time window |

### 9.2 Business application routes

| Route | Purpose | Required interaction |
|---|---|---|
| `/app/dashboard` | Operational overview | KPI cards, needs-attention queue, upcoming jobs, recent activity |
| `/app/requests` | Request queue | Search, filters, sorting, pagination, status badges |
| `/app/requests/[id]` | Request detail | Customer/request context, internal notes, status changes, quote creation |
| `/app/quotations/[id]` | Quotation editor/detail | Line items, calculated totals, expiry, preview, send/void actions |
| `/app/jobs` | Work-order list | Filters, status controls, customer/service details |
| `/app/calendar` | Scheduling | Day/week/month view or a focused week view, job detail drawer, conflict feedback |
| `/app/jobs/[id]` | Work-order detail | Schedule, assignment, status timeline, notes, invoice action |
| `/app/customers` | Customer list | Search, contact details, outstanding balance where appropriate |
| `/app/customers/[id]` | Customer detail | Profile, addresses, history tabs for requests/jobs/quotations/invoices |
| `/app/technicians` | Resource management | Resource list, create/edit/deactivate, upcoming assignments |
| `/app/invoices` | Invoice list | Status/due filters, balance, PDF/open action |
| `/app/invoices/[id]` | Invoice detail | Line items, totals, payments, issue/void and record-payment actions |
| `/app/settings/business` | Business configuration | Brand/contact/currency/timezone/tax settings |
| `/app/settings/services` | Service catalogue management | Add/edit/publish/unpublish services |

### 9.3 Customer portal routes

| Route | Purpose |
|---|---|
| `/portal` | Overview of current requests, upcoming jobs and outstanding invoices |
| `/portal/requests` and `/portal/requests/[id]` | Customer's requests and status history |
| `/portal/quotations/[id]` | Review, accept or decline quotation |
| `/portal/jobs` and `/portal/jobs/[id]` | View scheduled/active/completed work |
| `/portal/invoices` and `/portal/invoices/[id]` | View/download invoices and show recorded payment status |
| `/portal/profile` | Update permitted profile/contact fields |

Navigation should be role-aware. Customers must never see admin navigation links. Hiding a link is not a security control; the server must also enforce permissions.

## 10. UI/UX and visual design requirements

### 10.1 Design principles

1. **Professional before decorative:** use a coherent grid, typography, spacing and visual hierarchy rather than excessive gradients, glows or animations.
2. **One product identity:** the public website, admin area and portal share logo, colors, type system, radii, icon style and tone.
3. **Action-oriented dashboard:** emphasize what needs action now, not vanity metrics.
4. **Clear status language:** use text labels and consistent colors; never rely on color alone.
5. **Realistic content:** populate the UI with believable service names, addresses, dates, monetary values and useful job descriptions.
6. **Complete interaction states:** design loading, empty, success, validation-error, server-error, disabled, destructive-confirmation and permission-denied states.
7. **Responsive by design:** public pages should work on mobile; administrative tables should collapse into readable cards or provide an intentional horizontal-scroll strategy where needed.
8. **Accessible controls:** labels, semantic headings, keyboard support, focus visibility, sufficient contrast and meaningful accessible names.

### 10.2 Suggested visual direction

- **Brand personality:** dependable, modern, calm, precise and service-oriented.
- **Primary color:** deep navy/blue-green for navigation and primary actions.
- **Accent:** restrained teal for positive/active emphasis.
- **Neutrals:** warm or cool off-white page background, white surfaces, dark readable text and subtle borders.
- **Status colors:** consistent semantic colors for success, warning, danger and neutral states, always accompanied by text.
- **Typography:** a modern, highly readable sans-serif; use a clear scale for page title, section title, body, supporting text and metadata.
- **Layout:** compact left navigation on desktop, clear page title/breadcrumb/actions, aligned content grid, consistent card paddings and table row heights.
- **Images:** use authentic service imagery only on marketing pages; keep admin screens focused on information and work tasks.

Avoid copying another SaaS product's exact branding, illustrations or page design. Competitive products may be used for workflow inspiration, but the FixFlow design should be original.

### 10.3 Key screen quality bars

**Dashboard:**
- A clear page heading and date range/context.
- Four or five meaningful KPI cards, not an overwhelming wall of metrics.
- Needs-attention queue with direct actions.
- Upcoming schedule and recent activity.
- Loading skeleton and useful empty state.

**Request detail:**
- Clear status and reference at the top.
- Customer/problem/address/time context in a readable hierarchy.
- Prominent next action (for example, “Create quotation”).
- Timeline separated from private internal notes.

**Quotation editor:**
- Editable line-item rows with clear quantity and unit price.
- Live preview of totals, recalculated authoritatively on the server when saved.
- Errors shown beside the relevant fields.
- Explicit preview/send action; sending is not confused with saving a draft.

**Calendar:**
- Clear date navigation and readable appointment blocks.
- Obvious conflict feedback and safe rescheduling controls.
- A list view alternative for usability and smaller screens.

**Invoice:**
- Print-ready layout with business and customer details, invoice number, dates, line items, totals, payment instructions and balance.
- Clear distinction between invoice issuance and payment received.

### 10.4 Interaction requirements

- All forms show validation feedback and preserve user-entered values after recoverable errors.
- Destructive or irreversible actions require confirmation and explain the consequence.
- Use optimistic UI only when failure can be rolled back reliably; otherwise update after server confirmation.
- Disable duplicate submissions while a request is processing.
- Use skeletons or loading indicators for non-trivial requests and explain empty states.
- Never show fake success, fake email delivery or fake payment confirmation.

## 11. Business rules and validation

1. Customer email used for login must be normalized and unique.
2. Every service request belongs to one customer and one active service at the time of submission.
3. Customer access is restricted by authenticated customer ID, not by IDs supplied from the browser.
4. Only an authorized business admin can manage catalogue/settings and all business records.
5. Quotation totals and invoice totals must be computed on the server using decimal-safe arithmetic; client totals are display hints only.
6. Quantity must be greater than zero. Unit prices, discounts, taxes and payment amounts must be within configured allowed ranges.
7. A SENT quotation is immutable. Replacement offers must preserve a record of the previous offer.
8. A customer can accept/decline only a SENT, unexpired quotation that belongs to them.
9. A job cannot be scheduled without an accepted quotation, customer, address, valid start/end times and any required service details.
10. Appointment end time must be later than start time. Technician overlap handling must be enforced server-side, not just shown in the UI.
11. Inactive technicians cannot receive new assignments.
12. Job state transitions must be validated by the API.
13. An invoice can be issued only from an eligible job/approved billable scope. Drafts may be editable; issued invoices require a void/correction workflow rather than silent edits.
14. A payment amount must be positive and cannot exceed the invoice's remaining balance in the MVP.
15. Invoice payment state derives from the recorded invoice total, payment total, due date and issue/void status.
16. Voided/cancelled records remain in history with actor, date and reason.
17. Timestamps are stored in UTC where appropriate and displayed using the configured business timezone.
18. Monetary values use an explicit currency code. Currency must not be inferred from a user's browser locale.
19. Internal notes must never be included in customer-facing API payloads by default.
20. Activity logs must not store passwords, tokens, payment card data or unnecessary sensitive information.
21. A request or invoice reference is a human-friendly identifier, not a replacement for authentication or authorization.
22. Email delivery errors must not undo the underlying request, quote, job or invoice transaction.

## 12. Data model

The following is the recommended conceptual model. Exact field names may change during implementation, but relationships and business invariants must be preserved.

### 12.1 Entities

| Entity | Important fields | Relationships / notes |
|---|---|---|
| `User` | id, name, normalizedEmail, passwordHash or auth provider ID, role, isActive, createdAt, updatedAt | Authenticated identity. Roles: BUSINESS_ADMIN or CUSTOMER. Do not store plaintext passwords. |
| `CustomerProfile` | id, userId, phone, createdAt, updatedAt | One customer profile per customer user in MVP. |
| `ServiceAddress` | id, customerId, label, addressLine1, addressLine2, city, postalCode, accessNotes, isDefault | Customer can have multiple addresses. Access notes are private and should be limited. |
| `BusinessSettings` | id, businessName, logoUrl, contactEmail, phone, address, currencyCode, timeZone, defaultTaxRate, quotationValidityDays, invoiceFooter | One settings record for the demo business. |
| `Service` | id, name, slug, category, shortDescription, fullDescription, active, pricingMode, startingPrice, estimatedDurationMinutes, imageUrl | Publicly visible if active. PricingMode can be FIXED or QUOTE_REQUIRED. |
| `ServiceRequest` | id, reference, customerId, serviceId, serviceAddressId or address snapshot, description, preferredStart, preferredEnd, status, submittedAt, updatedAt | Originates a quotation workflow. Store a service/address snapshot if historical consistency is important. |
| `RequestNote` | id, requestId, authorUserId, body, visibility, createdAt | Visibility INTERNAL or CUSTOMER_VISIBLE; enforce filtering server-side. |
| `Quotation` | id, reference, requestId, customerId, status, currencyCode, subtotal, discountAmount, taxAmount, totalAmount, validUntil, terms, sentAt, respondedAt, respondedByUserId, createdByUserId | May have replacement quotations; retain previous offers. |
| `QuotationLineItem` | id, quotationId, description, quantity, unitPrice, taxable, lineSubtotal | Snapshot description and price to preserve the offer that was sent. |
| `Technician` | id, name, phone, email, active, notes | Resource record only in MVP; no login required. |
| `WorkOrder` | id, reference, requestId, quotationId, customerId, serviceId, serviceAddress snapshot/reference, description, status, scheduledStart, scheduledEnd, technicianId, startedAt, completedAt, completionNote, createdAt | Created after quotation acceptance; one source quotation per work order in MVP. |
| `WorkOrderEvent` | id, workOrderId, actorUserId, eventType, oldStatus, newStatus, publicSummary, internalDetails, createdAt | Timeline and audit support. Separate internal and customer-visible detail. |
| `Invoice` | id, invoiceNumber, workOrderId, customerId, status, currencyCode, subtotal, discountAmount, taxAmount, totalAmount, issuedAt, dueAt, voidedAt, voidReason, createdByUserId | Issued invoice should preserve historical billing snapshot. |
| `InvoiceLineItem` | id, invoiceId, description, quantity, unitPrice, lineSubtotal, taxable | Snapshot line items at invoice draft creation. |
| `PaymentRecord` | id, invoiceId, amount, paymentDate, method, reference, notes, recordedByUserId, createdAt, voidedAt, voidReason | Manual records only; no sensitive card/bank credentials. |
| `Notification` | id, recipientUserId, type, title, message, link, readAt, createdAt | In-app notification. Must not expose another customer's data. |
| `EmailDeliveryLog` | id, notificationId or relatedEntity, provider, status, attemptedAt, deliveredAt, errorCodeSafe | Optional email status tracking; redact provider secrets and sensitive payloads. |
| `ActivityLog` | id, actorUserId, entityType, entityId, action, summary, metadataSafe, createdAt | Important business events; append-only for normal application use. |

### 12.2 Relationship summary

- One User with role CUSTOMER has one CustomerProfile.
- One CustomerProfile has many ServiceAddresses and ServiceRequests.
- One Service has many ServiceRequests and WorkOrders.
- One ServiceRequest can have multiple Quotation records across revisions.
- One Quotation has many QuotationLineItems.
- An accepted Quotation can produce one WorkOrder in the MVP.
- One Technician can be assigned to many WorkOrders, subject to scheduling conflict rules.
- One WorkOrder can have zero or one issued Invoice in the MVP. If multiple invoices are later needed, revise this relationship explicitly.
- One Invoice has many InvoiceLineItems and PaymentRecords.
- Notifications belong to a recipient user; activity records link to an actor and a business entity.

### 12.3 Data modelling guidance

- Use database foreign keys and unique constraints for important invariants.
- Use enums or validated domain constants for roles and statuses rather than arbitrary strings.
- Use decimal/numeric types for money and define the rounding policy. Do not use binary floating-point values as the source of truth for monetary calculations.
- Store sent quotation and issued invoice line-item snapshots. Do not recalculate historical invoices using current service prices.
- Use transactions for operations that change multiple related records, such as accepting a quotation and creating its associated event/notification, or recording a payment and recalculating invoice status.
- Consider optimistic concurrency/version fields where two admins may edit the same record. For a single-user demo this is not critical, but API logic should avoid duplicate conversion/issuance on double-click.
- Use soft-deactivation or status-based voiding for important financial/business records instead of deleting history.

## 13. Technical architecture and stack

### 13.1 Recommended stack

| Layer | Recommendation | Reason |
|---|---|---|
| Web application | Next.js + TypeScript | Strong React ecosystem, route structure, SSR/SEO for public service pages and shared UI |
| UI styling/components | Tailwind CSS + shadcn/ui + Lucide | Fast, consistent component implementation while allowing a custom visual identity |
| Forms and validation | React Hook Form + Zod | Good form ergonomics and shared schema patterns; server must still validate independently |
| API | Node.js + Express + TypeScript | Familiar modular REST backend and clear boundary between UI and business rules |
| Database | PostgreSQL | Relational data and transactional workflows suit requests, quotations, jobs and invoices |
| ORM | Prisma | Typed data access, schema migrations and relation management |
| Charts | Recharts or a similarly restrained chart library | Dashboard metrics where a chart adds useful information |
| PDF | Server-side HTML-to-PDF or a stable PDF-generation library | Consistent printable invoices and quotations |
| Email | Provider adapter (for example Resend or SMTP) | Notifications can be configured without coupling core business logic to one provider |
| Testing | Vitest/Jest, Supertest and Playwright | Unit, API integration and end-to-end workflow coverage |
| Frontend hosting | Vercel or equivalent | Straightforward deployment for the web app |
| API/database hosting | Railway or another managed host | Simple public demo deployment; configure secrets and persistence correctly |

Use current stable versions at implementation time and commit the lockfiles. Do not select packages solely because they are fashionable; keep the dependency list small and maintained.

### 13.2 Architecture overview

1. **Browser layer:** Customers and Business Admins use the same Next.js application, with separate public, customer-portal and admin experiences.
2. **Web application:** The Next.js app renders pages, manages UI state and calls the backend through a typed REST API client. It must not connect directly to PostgreSQL.
3. **API layer:** The Express API authenticates each request, checks roles and record ownership, validates payloads, and routes work into domain modules.
4. **Domain layer:** Modules handle requests, quotations, work orders, customers, technicians, invoices, payments, settings, notifications and activity history.
5. **Persistence layer:** Prisma provides typed database access to PostgreSQL. Multi-record business operations use database transactions.
6. **External notification adapter:** The API can send email through a configured provider. Email delivery is tracked separately and must not compromise the underlying business transaction.

Business rules and authorization belong on the server, not only in UI components.

### 13.3 Backend module boundaries

A practical modular-monolith structure:

- `auth`: registration, login, logout, password reset/session support, role checks.
- `users`: customer profile and business user administration where required.
- `services`: public catalogue and admin catalogue management.
- `customers`: customer search, profile and service history.
- `service-requests`: create/review/update requests and notes.
- `quotations`: draft line items, totals, send, accept, decline, replace/void.
- `work-orders`: conversion, scheduling, assignment, transitions and completion.
- `technicians`: resource management and availability checks.
- `invoices`: draft, issue, PDF, payment records and invoice status.
- `dashboard`: aggregation/query endpoints for operational metrics.
- `notifications`: in-app notification creation and email provider adapter.
- `activity`: audit/activity logging.
- `settings`: business profile and configuration.

Each module should own its validation schemas, controller/route layer, service/business logic, repository/data access patterns and tests. Avoid controllers containing all business logic or a single huge service file.

### 13.4 Frontend module boundaries

- `marketing`: homepage, services and public content.
- `auth`: login, registration and session handling.
- `admin`: dashboard, request queues, quote editor, calendar, customers, technicians and invoices.
- `portal`: customer overview, records and profile.
- `components/ui`: reusable primitives and layout components.
- `components/forms`: validated reusable fields and form patterns.
- `lib/api`: typed API client, error mapping and request utilities.
- `lib/auth`: role-aware route protection helpers; server-side protection remains authoritative.
- `lib/formatting`: currency, date/time and status formatting.

Keep shared components consistent without forcing every page into the same layout. Marketing pages, data tables and invoice print views have different layout needs.

## 14. API design outline

Prefix all API routes with `/api/v1`. Use JSON for standard request/response bodies, consistent error formats, pagination for list endpoints and appropriate HTTP status codes. Exact route naming can change, but authorization and business semantics must remain consistent.

### 14.1 Authentication and profile

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| POST | `/api/v1/auth/register` | Register customer | Public with validation/rate limit |
| POST | `/api/v1/auth/login` | Authenticate | Public with rate limit |
| POST | `/api/v1/auth/logout` | End session | Authenticated |
| GET | `/api/v1/auth/me` | Current user and permitted profile | Authenticated |
| PATCH | `/api/v1/customers/me` | Update own profile | Customer |

### 14.2 Services and requests

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| GET | `/api/v1/services` | List active public services | Public |
| GET | `/api/v1/services/:id` | Service detail | Public if active; admin can view inactive |
| POST | `/api/v1/admin/services` | Create service | Admin |
| PATCH | `/api/v1/admin/services/:id` | Update/publish service | Admin |
| POST | `/api/v1/requests` | Create service request | Customer |
| GET | `/api/v1/requests/me` | List own requests | Customer |
| GET | `/api/v1/requests/:id` | Request details | Owner customer or admin |
| GET | `/api/v1/admin/requests` | Search/filter request queue | Admin |
| PATCH | `/api/v1/admin/requests/:id/status` | Update valid request status | Admin |
| POST | `/api/v1/admin/requests/:id/notes` | Add internal/customer-visible note | Admin with visibility validation |

### 14.3 Quotations and work orders

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| POST | `/api/v1/admin/requests/:id/quotations` | Create quote draft | Admin |
| PATCH | `/api/v1/admin/quotations/:id` | Update draft line items/details | Admin; draft only |
| POST | `/api/v1/admin/quotations/:id/send` | Send/publish quotation | Admin |
| POST | `/api/v1/quotations/:id/accept` | Accept quotation | Owning customer |
| POST | `/api/v1/quotations/:id/decline` | Decline quotation | Owning customer |
| GET | `/api/v1/quotations/me` | Own quotations | Customer |
| POST | `/api/v1/admin/quotations/:id/void` | Void an offer with reason | Admin; allowed states only |
| POST | `/api/v1/admin/quotations/:id/work-order` | Create work order from accepted quote | Admin; idempotent/duplicate-safe |
| GET | `/api/v1/admin/work-orders` | Search/filter work orders | Admin |
| GET | `/api/v1/work-orders/me` | Own work orders | Customer |
| PATCH | `/api/v1/admin/work-orders/:id/schedule` | Set schedule/resource | Admin |
| POST | `/api/v1/admin/work-orders/:id/transitions` | Apply valid status transition | Admin |

### 14.4 Invoices, dashboard and notifications

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| POST | `/api/v1/admin/work-orders/:id/invoice` | Create invoice draft | Admin; eligible work order only |
| POST | `/api/v1/admin/invoices/:id/issue` | Issue invoice | Admin |
| GET | `/api/v1/invoices/me` | Own invoices | Customer |
| GET | `/api/v1/invoices/:id` | Invoice detail | Owner customer or admin |
| GET | `/api/v1/invoices/:id/pdf` | Download/print PDF | Owner customer or admin |
| POST | `/api/v1/admin/invoices/:id/payments` | Record manual payment | Admin |
| POST | `/api/v1/admin/invoices/:id/void` | Void invoice with reason | Admin; allowed states only |
| GET | `/api/v1/admin/dashboard/summary` | KPI and queue summary | Admin |
| GET | `/api/v1/notifications/me` | Own notifications | Authenticated |
| PATCH | `/api/v1/notifications/:id/read` | Mark own notification as read | Recipient |

### 14.5 API conventions

- Validate route parameters, query parameters and request bodies.
- Use `401` for unauthenticated requests, `403` for authenticated users without permission, `404` for missing/not-accessible resources where appropriate, `409` for state conflicts, and `422` or `400` for invalid input consistently.
- Return a consistent error format, such as `{ "error": { "code": "INVALID_STATE_TRANSITION", "message": "This quotation can no longer be accepted." } }`.
- List endpoints should support `page`, `pageSize`, `sort`, and appropriate filters; enforce a maximum page size.
- Calculate totals, roles, ownership and status transitions server-side.
- Protect write actions from duplicate submission. Use database transactions and, where suitable, idempotency keys or uniqueness constraints for quote conversion and invoice issuance.
- Do not expose password hashes, secrets, internal notes or private metadata in API serializers.

## 15. Security, privacy and reliability

### 15.1 Authentication and authorization

- Hash passwords with a modern password-hashing algorithm through a well-maintained library if local passwords are used.
- Prefer secure, HTTP-only, same-site cookies for browser sessions or follow a clearly designed token architecture; do not store long-lived sensitive tokens in `localStorage` without a deliberate risk assessment.
- Protect every admin endpoint on the server.
- Enforce customer ownership for requests, quotations, jobs, invoices, notifications and PDFs.
- Validate uploaded images/files if uploads are introduced; avoid uploads in MVP unless necessary.
- Use rate limiting on login, registration and other abuse-prone endpoints.
- Do not hard-code production secrets or commit `.env` files.

### 15.2 Data protection

- Use fictional demo identities and addresses.
- Collect only data required for the workflow.
- Keep private notes separate from customer-visible notes.
- Avoid placing full request descriptions, emails or addresses in broad application logs.
- Add a clear demo privacy notice and explain that the site is a portfolio demonstration.
- Restrict admin demo credentials and rotate them if public access creates abuse risk.

### 15.3 Business transaction integrity

- Use database transactions when multiple records must change together.
- Prevent double acceptance of quotations, duplicate work-order creation and duplicate invoice issuance.
- Validate balances when recording payments and prevent negative totals.
- Preserve audit history for quotations, job status changes, invoice voids and payment corrections.
- Ensure notification or PDF generation failure does not leave the user with a misleading success message or corrupt the core business record. Where asynchronous work is used, represent processing/failure status explicitly.

### 15.4 File and email handling

- Invoice PDFs must be generated from persisted invoice data, not unvalidated browser values.
- PDF download endpoints must authorize the invoice owner/admin before returning the file.
- Email templates must escape untrusted customer-provided text to avoid HTML injection.
- Do not include internal notes in customer emails.
- Record email provider failures safely without exposing API keys or unnecessary message contents.

## 16. Non-functional requirements

| Area | Requirement |
|---|---|
| Usability | A first-time user can request a service and a business admin can find a new request without training. |
| Responsiveness | Public and customer-facing experiences work on mobile, tablet and desktop; admin tables remain usable at narrow widths. |
| Accessibility | Aim for WCAG 2.2 AA practices for key workflows: keyboard access, clear focus, labels, contrast and semantic structure. |
| Performance | Common list and detail views should feel responsive on typical broadband; use pagination and avoid loading unbounded record sets. |
| Reliability | Errors are visible and actionable; successful actions are confirmed only after server success. |
| Maintainability | TypeScript, modular boundaries, consistent formatting, linting, migrations and documented setup. |
| Security | Server-side validation, role/ownership checks, secrets management and safe session handling. |
| Data integrity | Foreign keys, unique references, transactions for multi-record updates and persisted status history. |
| Observability | Structured server logs without secrets, a health endpoint and safe error reporting. |
| Portability | Environment-specific configuration; local development should not require production credentials. |
| SEO | Public service pages have meaningful titles, descriptions, semantic content and shareable URLs. |
| Browser support | Test current major Chrome, Edge, Firefox and Safari where practical, plus mobile responsive emulation. |

## 17. Acceptance criteria

The MVP is not complete until all critical criteria below are demonstrated from the UI and the API/database behaviour has been verified.

### 17.1 Request and quotation workflow

- A customer can register/sign in, select an active service and submit valid request details.
- Invalid/missing fields display clear errors and do not create a partial request.
- A unique request reference is generated by the server.
- The request appears in the admin queue and is accessible to the owning customer only.
- Admin can move the request to review and create a quotation with multiple line items.
- Server-calculated quotation totals match the line items, discount and configured tax rules.
- Customer can accept or decline a sent, unexpired quotation.
- A different customer cannot accept or view the quotation by guessing its ID.
- A quotation cannot be accepted twice or accepted after expiry/voiding.

### 17.2 Scheduling and job completion

- An accepted quotation can create exactly one work order through the normal flow.
- Admin can schedule the job and assign an active technician resource.
- Invalid times and conflicting assignments are handled according to the documented scheduling rule.
- Customer portal reflects the job's schedule and current customer-visible status.
- Admin can move a job through the allowed lifecycle and record a completion note.
- Unauthorized status transitions are rejected by the server and leave the record unchanged.

### 17.3 Invoice and payment workflow

- An eligible completed work order can generate an invoice draft with the agreed billable items.
- Issuing the invoice assigns a unique invoice number and locks the issued financial snapshot from silent editing.
- The customer can access and download only their invoice PDF.
- A valid manual payment reduces the outstanding balance and updates the invoice status.
- An invalid, negative or greater-than-balance payment is rejected with a useful message.
- Voiding an invoice/payment is controlled, requires a reason and leaves an audit record.

### 17.4 UI, quality and deployment

- Public website, admin dashboard and customer portal use consistent branding and typography.
- Every primary CTA has a real action and appropriate loading/error/success states.
- Key screens render correctly at 360px, 768px, 1024px and 1440px viewport widths.
- The app includes seeded fictional records for the complete demonstration scenario.
- A fresh clone can be configured and started using the README without undocumented manual database edits.
- Production-like deployment uses environment variables and HTTPS; secrets are not committed.
- Critical automated tests pass and the documented end-to-end scenario is repeatable.

## 18. Testing strategy

### 18.1 Unit tests

Cover pure/domain logic, including:
- quotation subtotal, discount, tax and total calculations;
- invoice balance and status derivation;
- allowed request/quotation/work-order/invoice transitions;
- scheduling overlap detection;
- reference generation rules;
- permission predicates and ownership checks;
- validation for quantities, prices, date ranges and payment amounts.

### 18.2 API integration tests

Test routes against a test database or isolated fixtures:
- unauthenticated and wrong-role requests are rejected;
- customer A cannot read customer B's requests, quotes, work orders, invoices, notifications or PDFs;
- quotation acceptance is atomic and duplicate-safe;
- accepted quote conversion cannot create two work orders;
- invoice issuance/payment recording are transactionally consistent;
- invalid state changes return stable error responses;
- pagination and filters behave as expected.

### 18.3 End-to-end tests

At minimum, automate or carefully script the complete main journey:

1. Sign in as demo customer.
2. Submit an AC repair request.
3. Sign in as admin and open the request.
4. Create and send a quotation.
5. Return as customer and accept it.
6. Return as admin and create/schedule the job.
7. Mark the job in progress and completed.
8. Create and issue the invoice.
9. Record a manual payment.
10. Return as customer and verify the job/invoice/payment view.

Also test responsive layouts, empty states, network errors, form validation, expired quote behaviour and unauthorized access.

### 18.4 Manual visual QA checklist

- No clipped text, overlapping cards, broken tables or inconsistent spacing.
- Buttons, dropdowns, dialogs and date controls work via mouse and keyboard.
- Tables have clear headings and usable filters.
- Status is readable without depending on color alone.
- Loading, empty and error states use the same visual language.
- Customer pages never reveal internal notes.
- Invoice PDF is aligned and printable on A4/Letter without cropped totals or footers.
- The page title, favicon, metadata and app logo use FixFlow branding.

## 19. Demo data and showcase scenario

Use one fictional business such as **CoolBreeze Home Services** to keep the demo coherent. Do not use real individuals' personal information.

### 19.1 Suggested services

- AC Diagnostic Visit — quote required.
- AC Routine Maintenance — fixed starting price or quote required.
- Washing Machine Repair — quote required.
- Electrical Safety Inspection — quote required.
- Home Deep Cleaning — fixed starting price or quote required.

### 19.2 Suggested demo accounts

Use environment-controlled demo accounts or seeded accounts with clearly documented credentials. Do not reuse personal passwords. For a public portfolio, consider restricting demo writes or running a resettable seed process to prevent malicious or accidental changes.

Example fictional identities:
- Business admin: `admin@demo.fixflow.local` (development-only example; do not assume this domain receives email).
- Customer: `alex.morgan@example.test`.
- Technician resource: Jordan Lee.

The `.test` domain is intended for examples/testing, not real message delivery.

### 19.3 Seeded records

The initial demo should contain enough data to make the interface look and feel used:
- 8–12 service requests across several statuses;
- 5–8 customer records and a mixture of service addresses;
- 3–5 technicians/resources;
- 4–6 quotations, including one awaiting a customer decision;
- 5–8 work orders across scheduled, in-progress and completed states;
- 4–6 invoices, including issued, partially paid, paid and overdue examples;
- a small amount of notification/activity history.

Any internally inconsistent sample data should be avoided. For example, a PAID invoice must have payment records matching the total; a completed job should have a plausible timeline; a quote marked accepted must not also be declined.

### 19.4 Portfolio demonstration script

A 2–3 minute video can show:

1. The polished public homepage and service detail page.
2. A customer submitting a service request.
3. The admin dashboard surfacing the new request.
4. Admin creating and sending a quote.
5. Customer accepting the quote.
6. Admin scheduling and completing the job.
7. Admin issuing an invoice and recording payment.
8. Customer viewing the final job/invoice state.

The video should use the real running application, real screens and fictional data. Avoid a long narration of code; the buyer-facing result should be easy to understand.

## 20. Implementation roadmap

Build in vertical slices. Each phase should leave the application in a runnable state. Do not attempt to generate every screen, API and database model in one giant AI prompt.

### Phase 0 — Product definition and design

- Finalize user journeys, statuses, data model and MVP scope.
- Create a small design system: colors, type scale, spacing, button variants, inputs, cards, tables, badges, dialogs and responsive navigation.
- Design the homepage, dashboard, request detail, quotation editor, calendar, invoice and customer portal in Figma.
- Define demo data and the end-to-end showcase script.

**Exit gate:** principal screens are visually coherent and the workflow contains no unresolved business-rule ambiguity.

### Phase 1 — Project foundation

- Set up repository, lint/format, TypeScript, environment configuration and CI checks.
- Create Next.js frontend and Express API modules.
- Configure PostgreSQL/Prisma migrations and seed process.
- Create shared design primitives and app layouts.
- Add API error handling, logging and health endpoint.

**Exit gate:** a fresh clone can start locally and access the database without manual schema edits.

### Phase 2 — Authentication, roles and catalogue

- Implement admin/customer login and customer registration.
- Add role-aware layouts and server-side authorization.
- Implement business settings and service catalogue.
- Build public pages and admin service management.

**Exit gate:** customers can browse active services; admin can manage catalogue; unauthorized access is rejected.

### Phase 3 — Requests and customer management

- Implement customer profiles/addresses and request creation.
- Build request queue, filters and details.
- Implement valid status transitions, notes and activity events.
- Add customer portal request history.

**Exit gate:** a complete request can be submitted and reviewed with correct ownership restrictions.

### Phase 4 — Quotations

- Build line-item editor and customer-facing preview.
- Implement server-side money calculations and quote validity.
- Add send, accept, decline and void/replacement behaviours.
- Add notifications and relevant tests.

**Exit gate:** an accepted quote can be proven through the UI and API, and cannot be accepted twice or after expiry.

### Phase 5 — Scheduling and work orders

- Implement conversion to work order.
- Build job list, calendar/schedule and technician resource management.
- Add assignment conflict checks and status transitions.
- Add customer schedule/job views.

**Exit gate:** accepted quote → scheduled work order → completed job works end to end.

### Phase 6 — Invoices and payments

- Create invoice drafts from eligible jobs.
- Generate invoice numbers and PDFs.
- Implement issue, manual payment, balance calculation, status derivation and void/correction handling.
- Add customer invoice views and authorization tests.

**Exit gate:** completed job → issued invoice → payment recorded works end to end.

### Phase 7 — Polish, testing and deployment

- Seed realistic demo content.
- Complete responsive and accessibility passes.
- Add end-to-end tests and fix defects.
- Configure production environment, database migrations, email provider and safe demo credentials.
- Write README, architecture note, screenshots and walkthrough recording.

**Exit gate:** the deployed demo can be navigated and the full primary journey can be repeated without developer intervention.

### Prioritization rule

When short on time, protect the following order: core workflow correctness → UI quality on primary screens → authorization/data integrity → responsive behaviour → secondary dashboards/charts → optional enhancements. Do not sacrifice core reliability to add more screens.

## 21. Deployment and repository standards

### 21.1 Environments

Maintain at least:
- **Local:** local database, `.env` ignored by Git, seeded data and email preview/log mode.
- **Preview/staging:** safe test data, isolated database and test credentials.
- **Production demo:** hosted app, managed database, HTTPS, restricted secrets and non-sensitive fictional data.

Do not point local testing at the production demo database. Run migrations deliberately and keep a documented backup/reset approach for the hosted demo.

### 21.2 Environment configuration

Document variable names without committing actual secrets. Likely variables include:

```text
# API
NODE_ENV=
PORT=
DATABASE_URL=
SESSION_SECRET=
APP_ORIGIN=
WEB_ORIGIN=
EMAIL_PROVIDER_API_KEY=
EMAIL_FROM=

# Web
NEXT_PUBLIC_API_BASE_URL=
```

Use only variables required by the chosen implementation. Never expose database credentials, session secrets or email provider keys through a `NEXT_PUBLIC_` variable.

### 21.3 Repository expectations

Recommended repository layout:

```text
fixflow/
  apps/
    web/                 # Next.js application
    api/                 # Express REST API
  packages/
    shared/              # Shared safe types/constants if useful
  docs/
    product-spec.md
    architecture.md
    api-notes.md
  prisma/                # Or apps/api/prisma, depending on chosen setup
  .github/workflows/     # lint, typecheck, tests
  .env.example
  README.md
```

A monorepo is optional; a separate frontend and backend repository is also acceptable. Choose the simplest structure you can maintain. Avoid duplicating server validation logic only to share a schema file; the server remains authoritative.

### 21.4 README minimum content

- Product summary and problem solved.
- Screenshots and demo URL.
- Features and explicit out-of-scope items.
- Architecture diagram and key technology choices.
- Local setup commands and environment variables.
- Database migration and seed commands.
- Test commands.
- Demo accounts or safe demo access instructions.
- Known limitations.
- Portfolio-project disclaimer and contribution scope.

## 22. Fiverr portfolio presentation plan

The purpose of this project is to help a prospective client quickly understand the type of work that can be delivered. Present it as a **self-initiated portfolio product**, not as a commissioned client system.

### 22.1 Case study structure

1. **Title:** FixFlow — Home Service Business Management Platform.
2. **Problem:** service requests, quotations, schedules and invoices were fragmented across separate tools.
3. **Solution:** a connected public website, business dashboard and customer portal.
4. **My contribution:** accurately describe the design, frontend, API, database, testing and deployment work actually completed.
5. **Highlighted capabilities:** request workflow, quotation approvals, scheduling, customer records, invoice PDF and manual payment tracking.
6. **Engineering decisions:** role-based access, server-side money calculations, state transitions, transaction safety and responsive design.
7. **Evidence:** deployed demo, authentic screenshots, short walkthrough and public repository where appropriate.
8. **Honest status:** self-initiated/portfolio project; no invented client, testimonial or business outcome.

### 22.2 Screenshot selection

Use real application captures in this order:
1. Business dashboard with realistic data.
2. Public services or request-service screen.
3. Quotation preview/approval workflow.
4. Job calendar or work-order detail.
5. Printable invoice.
6. Responsive customer portal on mobile.

Use consistent browser/device frames only if they do not distract from the actual UI. Do not use stock images as if they were screenshots of your product. Protect demo accounts from showing passwords or private configuration.

### 22.3 Service positioning supported by this project

The project may support focused Gigs such as:
- build a custom business dashboard or admin panel;
- develop a booking or work-order management web app;
- build a full-stack React/Next.js application with a REST API;
- implement API integration or business workflow features;
- design and develop a customer portal.

Do not launch every offer at once. Start with one service whose scope you can deliver reliably and use FixFlow as evidence of the relevant capability.

## 23. Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Scope creep | A small portfolio project can turn into an unfinished enterprise system | Treat MVP/non-goals as constraints; defer AI, payments, multi-tenancy and mobile apps |
| Generic UI | The project will fail to solve the user's original portfolio concern | Design principal screens first; use realistic data and a custom visual system; conduct visual QA after every major batch |
| AI-generated code inconsistency | Large one-shot prompts can generate disconnected pages and incompatible models | Build vertical slices, specify contracts, review generated code and run tests after each phase |
| Weak business rules | A UI may appear complete but permit invalid quote/job/invoice states | Centralize domain transitions and money calculations on the server and test them |
| Authorization bug | Customer could see another customer's record | Enforce ownership checks in every endpoint and test with two separate customers |
| Email provider setup | Emails may fail on an unverified domain or missing key | Use an adapter, local preview mode and explicit delivery status; core workflow must continue safely |
| Demo abuse | Public demo data may be edited or spammed | Use fictional data, rate limiting, restricted demo accounts and a reseed/reset process |
| Tax/accounting complexity | Real tax rules vary and exceed portfolio scope | Keep tax configurable and basic; clearly state that FixFlow is not accounting/compliance software |
| Scheduling complexity | Calendar and recurring availability can grow quickly | Use straightforward appointment ranges and a single, documented overlap rule for MVP |
| Unclear ownership of prior work | Employer/client material may be confidential | Build FixFlow independently and never include confidential code, screenshots or data from prior employment |

## 24. Future enhancements

Only consider these after the MVP is complete and polished:

1. **Technician portal:** technicians sign in to see their assigned jobs, update progress and attach completion photos.
2. **AI-assisted request summarization:** produce a draft summary of the customer's issue for staff review; never let AI silently create a binding quote or diagnose safety-critical problems.
3. **Email delivery improvements:** branded templates, delivery retries and clearer delivery status.
4. **Customer reminders:** scheduled email reminders for appointments or overdue invoices.
5. **Availability improvements:** technician working hours, service-area constraints and more robust conflict detection.
6. **File attachments:** customer photos and work completion images with size/type checks and private access controls.
7. **Reporting/export:** revenue by service, job completion time, request conversion and unpaid balance reports.
8. **Multi-tenancy:** separate businesses, tenant-level authorization, onboarding and configuration; this requires explicit architecture and security work, not just a business ID column.
9. **Online payments:** integrate a reputable payment provider without handling raw card data.
10. **Localization:** multiple languages, currencies and regional date/address formats.

Future ideas must not be described as implemented until they exist in the running demo.

## 25. Glossary

| Term | Meaning |
|---|---|
| Service request | A customer's initial description of work they want the business to consider |
| Quotation | A priced proposal describing expected work and amount before it is accepted |
| Work order / job | The operational record for agreed work, including schedule, assignment and completion status |
| Technician resource | A person the business can assign to a work order; no login in MVP |
| Invoice | A formal record of an amount the business is requesting for completed/agreed work |
| Payment record | A manual entry documenting money received outside FixFlow |
| Customer-visible note | Text intentionally shown to the customer |
| Internal note | Staff-only information that must never be returned in customer-facing payloads |
| Activity log | A history of important events and state changes |
| MVP | Minimum viable product: the smallest coherent release that meets the project's core objective |
| Portfolio project | A self-initiated work sample used to demonstrate capability, not a claim of paid client delivery |

---

## Final product principle

**FixFlow is complete when the primary customer-to-invoice journey works reliably and the application feels professionally designed—not when it has the largest number of features.**

Use this document as the source of truth during implementation. If a new idea conflicts with the scope, business rules or acceptance criteria, update the specification deliberately before adding it to the build.
