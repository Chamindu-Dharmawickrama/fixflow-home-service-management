import { randomBytes, randomUUID } from "node:crypto";

import {
  dateOnlyInTimeZone,
  InvoiceStatus,
  QuotationStatus,
  RequestAction,
  Role,
  ServiceRequestStatus,
  WorkOrderAction,
  WorkOrderStatus,
} from "@fixflow/shared";

import { loadConfig } from "../../config/env.js";
import type { AppDeps } from "../../deps.js";
import { Prisma } from "../../generated/prisma/client.js";
import { createBackgroundTasks } from "../../lib/background.js";
import { FakeClock } from "../../lib/clock.js";
import { BUSINESS_SETTINGS_ID, type PrismaClient } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import { hashPassword } from "../../lib/password.js";
import type { AuthContext } from "../../modules/auth/auth.types.js";
import { createEmailDispatcher } from "../../modules/email/email.dispatcher.js";
import { RoutingEmailSender } from "../../modules/email/email-sender.js";
import { LogEmailSender } from "../../modules/email/log-email-sender.js";
import {
  createInvoiceForWorkOrder,
  issueInvoice,
  updateInvoice,
  voidInvoiceByAdmin,
} from "../../modules/invoices/invoices.service.js";
import { syncOverdueInvoices } from "../../modules/invoices/invoices.transitions.js";
import { recordPayment } from "../../modules/invoices/payments.service.js";
import {
  acceptQuotation,
  declineQuotation,
} from "../../modules/quotations/quotations.decision.service.js";
import {
  createQuotation,
  sendQuotation,
  updateQuotation,
} from "../../modules/quotations/quotations.service.js";
import { syncExpiredQuotations } from "../../modules/quotations/quotations.transitions.js";
import {
  addRequestNote,
  changeRequestStatus,
} from "../../modules/requests/requests.admin.service.js";
import { submitRequest } from "../../modules/requests/requests.service.js";
import { transitionWorkOrderStatus } from "../../modules/work-orders/work-orders.lifecycle.service.js";
import {
  convertToWorkOrder,
  scheduleWorkOrder,
} from "../../modules/work-orders/work-orders.service.js";
import { DEMO_ACCOUNTS } from "../seed-data.js";
import {
  DEMO_CUSTOMER_EXTRAS,
  type Line,
  type Plan,
  PLANS,
  SHOWCASE_CUSTOMERS,
  SHOWCASE_TECHNICIAN,
  type ShowcaseAddress,
  TECHNICIAN_NAMES,
  type TechnicianKey,
  type Visit,
} from "./showcase-data.js";
import {
  createCalendar,
  type Moment,
  type ShowcaseCalendar,
  todaysVisit,
} from "./showcase-time.js";

/** Thrown when the showcase cannot be built (a missing base seed, or data that is already there). */
export class ShowcaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ShowcaseError";
  }
}

/** Called after each step, for a progress display. Nothing is printed otherwise. */
export type ShowcaseProgress = (done: number, total: number, label: string) => void;

export interface ShowcaseOptions {
  /** The moment the dates are counted from. Defaults to the real now; tests pin it. */
  now?: Date;
  onProgress?: ShowcaseProgress;
}

export interface ShowcaseSummary {
  steps: number;
  customers: number;
  requests: number;
  quotations: number;
  workOrders: number;
  invoices: number;
  payments: number;
  notifications: number;
  activityEvents: number;
}

const MINUTE = 60_000;
const SEED_SESSION_ID = "00000000-0000-4000-8000-0000000000aa";

type SeedDeps = Pick<AppDeps, "prisma" | "clock" | "config" | "emailDispatcher">;

interface Person {
  key: string;
  userId: string;
  customerId: string;
  auth: AuthContext;
  addressIds: string[];
}

interface Step {
  time: Date;
  order: number;
  label: string;
  run: () => Promise<void>;
}

/** A value one step produces and a later step needs. Reading it before it exists is a bug in a plan. */
class Slot<T> {
  private stored: T | undefined;

  constructor(private readonly label: string) {}

  set(value: T): void {
    this.stored = value;
  }

  get value(): T {
    if (this.stored === undefined) {
      throw new ShowcaseError(
        `${this.label} has not been created yet; check the order of the plan.`,
      );
    }
    return this.stored;
  }
}

function toLines(lines: readonly Line[]): Line[] {
  return lines.map((entry) => ({ ...entry }));
}

/**
 * Builds the showcase dataset (T24, spec §19.3) on top of the base seed. Every record is made by the
 * services the application itself uses, called with a clock that moves from the oldest story to the
 * present, so the totals, statuses, references, history and notifications hold by construction. The
 * clock only decides **when** things happened: the rows the database stamps itself (`created_at`)
 * are moved to the same instants afterwards, in one statement per table, so the history reads as if
 * the business had been using the app for six weeks.
 *
 * It refuses to run if requests already exist: use `db:reset-demo` to start again. Email is written to
 * the log only (every address here is a reserved `.test` address, D-52), never sent.
 */
export async function seedShowcase(
  prisma: PrismaClient,
  options: ShowcaseOptions = {},
): Promise<ShowcaseSummary> {
  if ((await prisma.serviceRequest.count()) > 0) {
    throw new ShowcaseError(
      "The database already has service requests. The showcase is loaded into an empty business: run db:reset-demo to start again.",
    );
  }

  const settings = await prisma.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
  });
  if (settings === null) {
    throw new ShowcaseError(
      "The business settings are missing. Run the base seed first (npm run db:seed).",
    );
  }

  const now = options.now ?? new Date();
  const calendar = createCalendar(now, settings.timeZone);
  const clock = new FakeClock(now);
  const logger = createLogger({ level: "warn", pretty: false });
  const background = createBackgroundTasks(logger);
  // Every address in the showcase is reserved (.test), and the log transport is all that is given
  // here, so nothing can be delivered even if a real address were ever added.
  const emailSender = new RoutingEmailSender(
    new LogEmailSender({ logger, clock, outboxDir: undefined }),
    undefined,
  );
  const deps: SeedDeps = {
    prisma,
    clock,
    config: loadConfig({ NODE_ENV: "development" }),
    emailDispatcher: createEmailDispatcher({ prisma, emailSender, clock, logger, background }),
  };

  const admin = await loadAdmin(prisma);
  const services = await loadServices(prisma);
  const technicians = await ensureTechnicians(prisma);
  const people = await createCustomers(prisma, calendar);

  const steps: Step[] = [];
  let order = 0;
  const step = (time: Date, label: string, run: () => Promise<void>): void => {
    steps.push({ time, order: (order += 1), label, run });
  };

  const context: PlanContext = {
    deps,
    calendar,
    admin,
    services,
    technicians,
    people,
    settings: {
      timeZone: settings.timeZone,
      quotationValidityDays: settings.quotationValidityDays,
      invoiceDueDays: settings.invoiceDueDays,
    },
    todays: todaysVisit(calendar),
    step,
  };
  for (const plan of PLANS) {
    registerPlan(plan, context);
  }

  steps.sort((a, b) => a.time.getTime() - b.time.getTime() || a.order - b.order);
  const windows = await runSteps(deps, steps, options.onProgress);
  await stampTimes(prisma, windows);
  await markOlderNotificationsRead(prisma, calendar);

  return summarize(prisma, steps.length);
}

// ---- The people and things the stories need --------------------------------------------------

async function loadAdmin(prisma: PrismaClient): Promise<AuthContext> {
  const email = DEMO_ACCOUNTS.find((account) => account.role === Role.BUSINESS_ADMIN)?.email;
  const user = email === undefined ? null : await prisma.user.findUnique({ where: { email } });
  if (user === null) {
    throw new ShowcaseError(
      "The demo admin account is missing. Run the base seed first (npm run db:seed).",
    );
  }
  return {
    userId: user.id,
    role: Role.BUSINESS_ADMIN,
    email: user.email,
    sessionId: SEED_SESSION_ID,
  };
}

async function loadServices(prisma: PrismaClient): Promise<Map<string, string>> {
  const rows = await prisma.service.findMany({ select: { id: true, slug: true } });
  if (rows.length === 0) {
    throw new ShowcaseError("The services are missing. Run the base seed first (npm run db:seed).");
  }
  return new Map(rows.map((row) => [row.slug, row.id]));
}

/** The base seed's three technicians plus the showcase's fourth. */
async function ensureTechnicians(prisma: PrismaClient): Promise<Map<TechnicianKey, string>> {
  const found = new Map<TechnicianKey, string>();
  for (const [key, name] of Object.entries(TECHNICIAN_NAMES) as [TechnicianKey, string][]) {
    let row = await prisma.technician.findFirst({ where: { name }, select: { id: true } });
    if (row === null && name === SHOWCASE_TECHNICIAN.name) {
      row = await prisma.technician.create({
        data: { ...SHOWCASE_TECHNICIAN, specialties: [...SHOWCASE_TECHNICIAN.specialties] },
        select: { id: true },
      });
    }
    if (row === null) {
      throw new ShowcaseError(
        `The technician ${name} is missing. Run the base seed first (npm run db:seed).`,
      );
    }
    found.set(key, row.id);
  }
  return found;
}

function addressData(address: ShowcaseAddress, isDefault: boolean) {
  return {
    label: address.label,
    line1: address.line1,
    ...(address.line2 !== undefined && { line2: address.line2 }),
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    ...(address.accessNotes !== undefined && { accessNotes: address.accessNotes }),
    isDefault,
  };
}

/**
 * The eight customers. The two seeded demo customers already exist (with the base seed's password and
 * first address): they gain a second address and an older "joined" date. The six others are created
 * here. They cannot sign in: their password is a random value that is hashed and then forgotten, and
 * they have no Google link, so nobody knows a credential for them. They exist to make the business
 * look used, and the admin sees them like any other customer.
 */
async function createCustomers(
  prisma: PrismaClient,
  calendar: ShowcaseCalendar,
): Promise<Map<string, Person>> {
  const people = new Map<string, Person>();
  const asPerson = (
    key: string,
    user: { id: string; email: string },
    customerId: string,
    addressIds: string[],
  ): Person => ({
    key,
    userId: user.id,
    customerId,
    addressIds,
    auth: {
      userId: user.id,
      role: Role.CUSTOMER,
      email: user.email,
      customerId,
      sessionId: SEED_SESSION_ID,
    },
  });

  for (const account of DEMO_ACCOUNTS.filter((candidate) => candidate.role === Role.CUSTOMER)) {
    const key = account.name.split(" ")[0]?.toLowerCase() ?? account.email;
    const extras = DEMO_CUSTOMER_EXTRAS[key];
    const user = await prisma.user.findUnique({
      where: { email: account.email },
      include: { customerProfile: { include: { addresses: { orderBy: { createdAt: "asc" } } } } },
    });
    if (user?.customerProfile == null || extras === undefined) {
      throw new ShowcaseError(
        `The demo customer ${account.email} is missing. Run the base seed first (npm run db:seed).`,
      );
    }
    const joined = calendar.past(extras.joined);
    await prisma.user.update({
      where: { id: user.id },
      data: { createdAt: joined, updatedAt: joined },
    });
    await prisma.customerProfile.update({
      where: { id: user.customerProfile.id },
      data: { createdAt: joined, updatedAt: joined },
    });
    await prisma.serviceAddress.updateMany({
      where: { customerId: user.customerProfile.id },
      data: { createdAt: joined, updatedAt: joined },
    });
    const addressIds = user.customerProfile.addresses.map((address) => address.id);
    for (const address of extras.addresses) {
      const created = await prisma.serviceAddress.create({
        data: {
          customerId: user.customerProfile.id,
          ...addressData(address, false),
          createdAt: joined,
          updatedAt: joined,
        },
        select: { id: true },
      });
      addressIds.push(created.id);
    }
    people.set(key, asPerson(key, user, user.customerProfile.id, addressIds));
  }

  for (const customer of SHOWCASE_CUSTOMERS) {
    const joined = calendar.past(customer.joined);
    // Random and discarded: see the note above.
    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
    const user = await prisma.user.create({
      data: {
        email: customer.email,
        name: customer.name,
        role: Role.CUSTOMER,
        passwordHash,
        termsAcceptedAt: joined,
        createdAt: joined,
        updatedAt: joined,
        customerProfile: {
          create: { phone: customer.phone, createdAt: joined, updatedAt: joined },
        },
      },
      include: { customerProfile: true },
    });
    const profile = user.customerProfile;
    if (profile === null) {
      throw new ShowcaseError(`The profile of ${customer.email} was not created.`);
    }
    const addressIds: string[] = [];
    for (const [index, address] of customer.addresses.entries()) {
      const created = await prisma.serviceAddress.create({
        data: {
          customerId: profile.id,
          ...addressData(address, index === 0),
          createdAt: joined,
          updatedAt: joined,
        },
        select: { id: true },
      });
      addressIds.push(created.id);
    }
    people.set(customer.key, asPerson(customer.key, user, profile.id, addressIds));
  }
  return people;
}

// ---- One plan becomes a list of timed steps -------------------------------------------------------

interface PlanContext {
  deps: SeedDeps;
  calendar: ShowcaseCalendar;
  admin: AuthContext;
  services: Map<string, string>;
  technicians: Map<TechnicianKey, string>;
  people: Map<string, Person>;
  settings: { timeZone: string; quotationValidityDays: number; invoiceDueDays: number };
  todays: ReturnType<typeof todaysVisit>;
  step: (time: Date, label: string, run: () => Promise<void>) => void;
}

interface VisitTimes {
  start: Date;
  end: Date;
}

function resolveVisit(visit: Visit, c: PlanContext): VisitTimes {
  if (visit === "TODAY") {
    return { start: c.todays.start, end: c.todays.end };
  }
  if ("workday" in visit) {
    const offset = c.calendar.workday(visit.workday);
    return {
      start: c.calendar.instant([offset, visit.from]),
      end: c.calendar.instant([offset, visit.to]),
    };
  }
  return { start: c.calendar.instant(visit.start), end: c.calendar.instant(visit.end) };
}

const before = (instant: Date, minutes: number): Date =>
  new Date(instant.getTime() - minutes * MINUTE);
const after = (instant: Date, minutes: number): Date =>
  new Date(instant.getTime() + minutes * MINUTE);

function registerPlan(plan: Plan, c: PlanContext): void {
  const { deps, calendar, admin } = c;
  const person = c.people.get(plan.customer);
  const serviceId = c.services.get(plan.service);
  if (person === undefined || serviceId === undefined) {
    throw new ShowcaseError(`${plan.label}: the customer or the service does not exist.`);
  }
  const addressId = person.addressIds[plan.address];
  if (addressId === undefined) {
    throw new ShowcaseError(`${plan.label}: the customer has no address number ${plan.address}.`);
  }
  const tz = c.settings.timeZone;
  /** Never later than a minute before the seed started: nothing in the history is in the future. */
  const latest = calendar.now.getTime() - MINUTE;
  const notFuture = (instant: Date): Date => new Date(Math.min(instant.getTime(), latest));

  const request = new Slot<{ id: string }>(`${plan.label}: the request`);
  /** The quotation that is currently the one the customer is asked about. */
  const quotation = new Slot<{ id: string }>(`${plan.label}: the quotation`);
  const firstQuotation = new Slot<{ id: string }>(`${plan.label}: the first quotation`);
  const job = new Slot<{ id: string }>(`${plan.label}: the job`);
  const invoice = new Slot<{ id: string }>(`${plan.label}: the invoice`);

  const visit = plan.schedule === undefined ? undefined : resolveVisit(plan.schedule.visit, c);
  const submittedAt = calendar.past(plan.submitted);
  const preferredDate =
    visit !== undefined
      ? dateOnlyInTimeZone(visit.start, tz)
      : dateOnlyInTimeZone(after(submittedAt, (plan.preferredAfterDays ?? 3) * 24 * 60), tz);

  // 1. The customer sends the request.
  c.step(submittedAt, `${plan.label}: the customer sends the request`, async () => {
    const { request: made } = await submitRequest(deps, person.auth, {
      serviceId,
      description: plan.description,
      serviceAddressId: addressId,
      preferredDate,
      preferredWindow: plan.window,
      submissionKey: randomUUID(),
    });
    request.set({ id: made.id });
  });

  // 2. Notes the team wrote.
  for (const note of plan.notes ?? []) {
    c.step(calendar.past(note.at), `${plan.label}: a note`, async () => {
      await addRequestNote(deps, admin, request.value.id, {
        body: note.body,
        visibility: note.visibility,
      });
    });
  }

  // 3. The team starts the review.
  if (plan.review !== undefined) {
    c.step(calendar.past(plan.review), `${plan.label}: review starts`, async () => {
      await changeRequestStatus(deps, admin, request.value.id, {
        action: RequestAction.START_REVIEW,
        expectedStatus: ServiceRequestStatus.SUBMITTED,
      });
    });
  }

  // 4. The quotation: prepared, sent, maybe replaced or left to expire.
  if (plan.quote !== undefined) {
    const { quote } = plan;
    const sentAt = calendar.past(quote.sent);
    const lines = toLines(quote.lines);

    c.step(before(sentAt, 40), `${plan.label}: the quotation is prepared`, async () => {
      const draft = await createQuotation(deps, admin, request.value.id, {});
      const saved = await updateQuotation(deps, draft.id, {
        lines,
        discountAmount: quote.discount ?? "0.00",
        taxRate: draft.taxRate,
        validUntil: draft.validUntil,
        terms: draft.terms,
        customerNote: quote.customerNote ?? null,
        expectedUpdatedAt: draft.updatedAt,
      });
      quotation.set({ id: saved.id });
      firstQuotation.set({ id: saved.id });
    });
    c.step(sentAt, `${plan.label}: the quotation is sent`, async () => {
      await sendQuotation(deps, admin, quotation.value.id, {
        expectedStatus: QuotationStatus.DRAFT,
      });
    });

    if (quote.replacement !== undefined) {
      const { replacement } = quote;
      const replacedAt = calendar.past(replacement.sent);
      c.step(before(replacedAt, 40), `${plan.label}: a replacement is prepared`, async () => {
        const draft = await createQuotation(deps, admin, request.value.id, {
          replacesQuotationId: firstQuotation.value.id,
        });
        const saved = await updateQuotation(deps, draft.id, {
          lines: [...toLines(quote.lines), ...toLines(replacement.extraLines)],
          discountAmount: draft.discountAmount,
          taxRate: draft.taxRate,
          validUntil: draft.validUntil,
          terms: draft.terms,
          customerNote: replacement.customerNote ?? draft.customerNote,
          expectedUpdatedAt: draft.updatedAt,
        });
        quotation.set({ id: saved.id });
      });
      c.step(replacedAt, `${plan.label}: the replacement is sent`, async () => {
        await sendQuotation(deps, admin, quotation.value.id, {
          expectedStatus: QuotationStatus.DRAFT,
        });
      });
    }

    if (quote.expires !== undefined) {
      const { expires } = quote;
      // It lapses at the start of the day after its last valid day; the check runs early that morning.
      const lapse: Moment = [quote.sent[0] + c.settings.quotationValidityDays + 1, "06:00"];
      c.step(calendar.past(lapse), `${plan.label}: the quotation expires`, async () => {
        await deps.prisma.$transaction((tx) => syncExpiredQuotations(tx, deps.clock.now()));
      });
      c.step(
        calendar.past(expires.draft),
        `${plan.label}: a new quotation is drafted`,
        async () => {
          const draft = await createQuotation(deps, admin, request.value.id, {});
          await updateQuotation(deps, draft.id, {
            lines: toLines(expires.lines),
            discountAmount: "0.00",
            taxRate: draft.taxRate,
            validUntil: draft.validUntil,
            terms: draft.terms,
            customerNote: null,
            expectedUpdatedAt: draft.updatedAt,
          });
        },
      );
    }
  }

  // 5. The customer answers.
  if (plan.decision !== undefined) {
    const { decision } = plan;
    c.step(
      calendar.past(decision.at),
      `${plan.label}: the customer ${decision.kind}s`,
      async () => {
        if (decision.kind === "accept") {
          await acceptQuotation(deps, person.auth, quotation.value.id);
        } else {
          await declineQuotation(deps, person.auth, quotation.value.id, {
            reason: decision.reason ?? null,
          });
        }
      },
    );
  }

  // 6. The accepted quotation becomes a job.
  if (plan.convert !== undefined) {
    c.step(calendar.past(plan.convert), `${plan.label}: the job is created`, async () => {
      const { workOrder } = await convertToWorkOrder(deps, admin, quotation.value.id);
      job.set({ id: workOrder.id });
    });
  }

  // 7. The visit is booked, then happens (or does not).
  let jobStatus: WorkOrderStatus = WorkOrderStatus.PENDING_SCHEDULING;
  if (plan.schedule !== undefined && visit !== undefined) {
    const technicianId = c.technicians.get(plan.schedule.technician);
    if (technicianId === undefined) {
      throw new ShowcaseError(`${plan.label}: unknown technician ${plan.schedule.technician}.`);
    }
    c.step(calendar.past(plan.schedule.at), `${plan.label}: the visit is booked`, async () => {
      await scheduleWorkOrder(deps, admin, job.value.id, {
        scheduledStart: visit.start,
        scheduledEnd: visit.end,
        technicianId,
        expectedStatus: WorkOrderStatus.PENDING_SCHEDULING,
      });
    });
    jobStatus = WorkOrderStatus.SCHEDULED;

    if (plan.started === true) {
      c.step(notFuture(after(visit.start, 5)), `${plan.label}: the technician starts`, async () => {
        await transitionWorkOrderStatus(deps, admin, job.value.id, {
          action: WorkOrderAction.START,
          expectedStatus: WorkOrderStatus.SCHEDULED,
        });
      });
      jobStatus = WorkOrderStatus.IN_PROGRESS;
    }
    if (plan.completed !== undefined) {
      const { completed } = plan;
      c.step(notFuture(after(visit.end, 10)), `${plan.label}: the job is completed`, async () => {
        await transitionWorkOrderStatus(deps, admin, job.value.id, {
          action: WorkOrderAction.COMPLETE,
          expectedStatus: WorkOrderStatus.IN_PROGRESS,
          completionNote: completed.note,
          ...(completed.internalNote !== undefined && { internalNote: completed.internalNote }),
        });
      });
      jobStatus = WorkOrderStatus.COMPLETED;
    }
    if (plan.needsRescheduling !== undefined) {
      const { needsRescheduling } = plan;
      c.step(
        calendar.past(needsRescheduling.at),
        `${plan.label}: the job needs a new time`,
        async () => {
          await transitionWorkOrderStatus(deps, admin, job.value.id, {
            action: WorkOrderAction.MARK_NEEDS_RESCHEDULING,
            expectedStatus: WorkOrderStatus.SCHEDULED,
            reason: needsRescheduling.reason,
            ...(needsRescheduling.message !== undefined && {
              customerMessage: needsRescheduling.message,
            }),
          });
        },
      );
      jobStatus = WorkOrderStatus.NEEDS_RESCHEDULING;
    }
    if (plan.cancelJob !== undefined) {
      const { cancelJob } = plan;
      c.step(calendar.past(cancelJob.at), `${plan.label}: the job is cancelled`, async () => {
        await transitionWorkOrderStatus(deps, admin, job.value.id, {
          action: WorkOrderAction.CANCEL,
          expectedStatus: WorkOrderStatus.SCHEDULED,
          reason: cancelJob.reason,
          ...(cancelJob.message !== undefined && { customerMessage: cancelJob.message }),
        });
      });
      jobStatus = WorkOrderStatus.CANCELLED;
    }
  }

  // 8. A cancelled request.
  if (plan.cancelRequest !== undefined) {
    const { cancelRequest } = plan;
    c.step(calendar.past(cancelRequest.at), `${plan.label}: the request is cancelled`, async () => {
      await changeRequestStatus(deps, admin, request.value.id, {
        action: RequestAction.CANCEL,
        expectedStatus: ServiceRequestStatus.UNDER_REVIEW,
        reason: cancelRequest.reason,
        ...(cancelRequest.message !== undefined && { customerMessage: cancelRequest.message }),
      });
    });
  }

  // 9. The invoice and its payments.
  if (plan.invoice !== undefined) {
    if (jobStatus !== WorkOrderStatus.COMPLETED) {
      throw new ShowcaseError(`${plan.label}: only a completed job can be invoiced.`);
    }
    const plannedInvoice = plan.invoice;
    c.step(
      calendar.past(plannedInvoice.draft),
      `${plan.label}: the invoice is drafted`,
      async () => {
        const draft = await createInvoiceForWorkOrder(deps, admin, job.value.id);
        const saved = await updateInvoice(deps, draft.id, {
          lines: [
            ...draft.lines.map(({ description, quantity, unitPrice, taxable }) => ({
              description,
              quantity,
              unitPrice,
              taxable,
            })),
            ...toLines(plannedInvoice.extraLines ?? []),
          ],
          discountAmount: draft.discountAmount,
          taxRate: draft.taxRate,
          issueDate: null,
          dueDate:
            draft.dueDate ?? calendar.dateOf(plannedInvoice.draft[0] + c.settings.invoiceDueDays),
          customerNote: plannedInvoice.customerNote ?? null,
          expectedUpdatedAt: draft.updatedAt,
        });
        invoice.set({ id: saved.id });
      },
    );

    if (plannedInvoice.issue !== undefined) {
      c.step(
        calendar.past(plannedInvoice.issue),
        `${plan.label}: the invoice is issued`,
        async () => {
          await issueInvoice(deps, admin, invoice.value.id, {
            expectedStatus: InvoiceStatus.DRAFT,
          });
        },
      );

      // The status a payment or a read would have saved the morning after the due date.
      const dueOffset = plannedInvoice.draft[0] + c.settings.invoiceDueDays;
      const overdueFrom = calendar.instant([dueOffset + 1, "06:00"]);
      if (overdueFrom.getTime() <= latest) {
        c.step(overdueFrom, `${plan.label}: overdue invoices are marked`, async () => {
          await deps.prisma.$transaction((tx) => syncOverdueInvoices(tx, deps.clock.now()));
        });
      }
    }

    for (const payment of plannedInvoice.payments ?? []) {
      c.step(calendar.past(payment.at), `${plan.label}: a payment is recorded`, async () => {
        const amount =
          payment.amount === "REMAINDER"
            ? await balanceOf(deps.prisma, invoice.value.id)
            : payment.amount;
        await recordPayment(deps, admin, invoice.value.id, {
          amount,
          paymentDate: dateOnlyInTimeZone(deps.clock.now(), tz),
          method: payment.method,
          ...(payment.reference !== undefined && { reference: payment.reference }),
          ...(payment.notes !== undefined && { notes: payment.notes }),
        });
      });
    }

    if (plannedInvoice.void !== undefined) {
      const { void: voided } = plannedInvoice;
      c.step(calendar.past(voided.at), `${plan.label}: the invoice is voided`, async () => {
        await voidInvoiceByAdmin(deps, admin, invoice.value.id, {
          reason: voided.reason,
          expectedStatus: InvoiceStatus.ISSUED,
        });
      });
    }
  }
}

/** What is still owed on an invoice, as a two-place decimal string (Decimal arithmetic, never floats). */
async function balanceOf(prisma: PrismaClient, invoiceId: string): Promise<string> {
  const row = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { totalAmount: true, amountPaid: true },
  });
  return new Prisma.Decimal(row.totalAmount).minus(row.amountPaid).toFixed(2);
}

// ---- Running the steps, and moving the database's own timestamps ------------------------------------

interface StepWindow {
  /** The database's clock just before the step ran. */
  dbStart: Date;
  /** This process's clock just before the step ran. */
  jsStart: Date;
  /** The business time the step stands for. */
  time: Date;
}

async function runSteps(
  deps: SeedDeps,
  steps: readonly Step[],
  onProgress: ShowcaseOptions["onProgress"],
): Promise<StepWindow[]> {
  const windows: StepWindow[] = [];
  const clock = deps.clock as FakeClock;
  let done = 0;
  for (const step of steps) {
    clock.set(step.time);
    const [row] = await deps.prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    windows.push({ dbStart: row?.now ?? new Date(), jsStart: new Date(), time: step.time });
    try {
      await step.run();
      // The emails are written to the log while the clock still says when they were sent.
      await deps.emailDispatcher.idle();
    } catch (error) {
      const detail =
        error instanceof AppError
          ? `${error.status} ${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new ShowcaseError(`${step.label} failed: ${detail}`, { cause: error });
    }
    done += 1;
    onProgress?.(done, steps.length, step.label);
  }
  return windows;
}

/** Tables whose `created_at` the database fills with its own clock, and tables whose `updated_at` Prisma fills with this process's. */
const CREATED_AT_TABLES = [
  "activity_events",
  "notifications",
  "email_delivery_logs",
  "quotations",
  "work_orders",
  "invoices",
  "payment_records",
  "request_notes",
] as const;
const UPDATED_AT_TABLES = ["service_requests", "quotations", "work_orders", "invoices"] as const;

/**
 * Moves what the clock could not set. A row made during step *n* has a `created_at` (the database's
 * time) between the start of step *n* and the start of step *n + 1`, so one statement per table maps
 * every such window to the business time of its step. The same is done for `updated_at`, which Prisma
 * sets from this process's clock. The windows do not overlap, so every row has exactly one answer.
 */
async function stampTimes(prisma: PrismaClient, windows: readonly StepWindow[]): Promise<void> {
  if (windows.length === 0) {
    return;
  }
  const FAR_FUTURE = "9999-12-31T00:00:00.000Z";
  // Rounding to milliseconds can put a row's own `created_at` a fraction before the instant measured
  // just ahead of the step, so each window opens two milliseconds early.
  const GRACE_MS = 2;

  const build = (starts: readonly Date[], grace: number) => {
    const params: string[] = [];
    const rows = starts.map((start, index) => {
      const next = starts[index + 1];
      const base = params.length;
      params.push(
        new Date(start.getTime() - grace).toISOString(),
        next === undefined ? FAR_FUTURE : new Date(next.getTime() - grace).toISOString(),
        windows[index]?.time.toISOString() ?? FAR_FUTURE,
      );
      return `($${base + 1}::timestamptz, $${base + 2}::timestamptz, $${base + 3}::timestamptz)`;
    });
    return { values: rows.join(", "), params };
  };

  const created = build(
    windows.map((window) => window.dbStart),
    GRACE_MS,
  );
  for (const table of CREATED_AT_TABLES) {
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}" AS t SET "created_at" = w.stamp FROM (VALUES ${created.values}) AS w(opens, closes, stamp) WHERE t."created_at" >= w.opens AND t."created_at" < w.closes`,
      ...created.params,
    );
  }
  const updated = build(
    windows.map((window) => window.jsStart),
    0,
  );
  for (const table of UPDATED_AT_TABLES) {
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}" AS t SET "updated_at" = w.stamp FROM (VALUES ${updated.values}) AS w(opens, closes, stamp) WHERE t."updated_at" >= w.opens AND t."updated_at" < w.closes`,
      ...updated.params,
    );
  }
}

/**
 * Notifications older than three days are marked read (a few minutes after they arrived), so the bell
 * of the demo admin and of the demo customers shows a mix of read and unread, as a used account does.
 */
async function markOlderNotificationsRead(
  prisma: PrismaClient,
  calendar: ShowcaseCalendar,
): Promise<void> {
  const cutoff = calendar.instant([-3, "00:00"]);
  await prisma.$executeRawUnsafe(
    `UPDATE "notifications" SET "read_at" = "created_at" + interval '25 minutes' WHERE "read_at" IS NULL AND "created_at" < $1::timestamptz`,
    cutoff.toISOString(),
  );
}

async function summarize(prisma: PrismaClient, steps: number): Promise<ShowcaseSummary> {
  const [
    customers,
    requests,
    quotations,
    workOrders,
    invoices,
    payments,
    notifications,
    activityEvents,
  ] = await Promise.all([
    prisma.customerProfile.count(),
    prisma.serviceRequest.count(),
    prisma.quotation.count(),
    prisma.workOrder.count(),
    prisma.invoice.count(),
    prisma.paymentRecord.count(),
    prisma.notification.count(),
    prisma.activityEvent.count(),
  ]);
  return {
    steps,
    customers,
    requests,
    quotations,
    workOrders,
    invoices,
    payments,
    notifications,
    activityEvents,
  };
}
