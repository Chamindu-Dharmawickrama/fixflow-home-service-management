import {
  balanceDue,
  EmailDeliveryStatus,
  InvoiceStatus,
  QuotationStatus,
  ServiceRequestStatus,
  sumAmounts,
  WorkOrderStatus,
} from "@fixflow/shared";

import { toDateOnly } from "../lib/date-only.js";
import type { PrismaClient } from "../lib/db.js";
import { BUSINESS_SETTINGS_ID } from "../lib/db.js";
import { deriveInvoiceStatus } from "../modules/invoices/invoices.domain.js";
import { effectiveQuotationStatus } from "../modules/quotations/quotations.domain.js";
import { DEMO_ACCOUNTS } from "./seed-data.js";
import { createCalendar, dayOfWeek } from "./showcase/showcase-time.js";

/**
 * The invariant checker for the showcase data (T24, spec §19.3). `npm run db:verify-demo` runs it
 * against the database named by DATABASE_URL and exits non-zero on any violation, listing each one.
 * If it fails, fix the seed: a check is never loosened to make data pass.
 *
 * The checks are plain functions over a {@link DemoSnapshot}, so each rule can be tested with a
 * hand-made snapshot that breaks it. {@link loadDemoSnapshot} reads the snapshot from the database.
 */

/**
 * What the showcase contains. The ranges are spec §19.3's, widened where §19.3 contradicts itself:
 * every job needs its own accepted quotation and every live invoice status needs its own completed
 * job, so 5 to 8 jobs and 4 to 6 quotations cannot hold every status (D-112).
 */
export const SHOWCASE_VOLUMES = {
  customers: { min: 6, max: 8 },
  technicians: { min: 4, max: 4 },
  requests: { min: 18, max: 22 },
  quotations: { min: 17, max: 21 },
  workOrders: { min: 12, max: 14 },
  invoices: { min: 5, max: 7 },
  payments: { min: 3, max: 8 },
} as const;

export interface SnapshotRequest {
  id: string;
  reference: string;
  status: ServiceRequestStatus;
  customerId: string;
  submittedAt: Date;
}
export interface SnapshotQuotation {
  id: string;
  reference: string;
  requestId: string;
  customerId: string;
  status: QuotationStatus;
  /** `YYYY-MM-DD`. */
  validUntil: string;
  declineReason: string | null;
  respondedAt: Date | null;
  sentAt: Date | null;
  voidReason: string | null;
  replacesQuotationId: string | null;
}
export interface SnapshotWorkOrder {
  id: string;
  reference: string;
  requestId: string;
  quotationId: string;
  customerId: string;
  status: WorkOrderStatus;
  technicianId: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelReason: string | null;
}
export interface SnapshotInvoice {
  id: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  workOrderId: string;
  /** Two-place decimal strings. */
  totalAmount: string;
  amountPaid: string;
  issuedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
}
export interface SnapshotPayment {
  id: string;
  invoiceId: string;
  amount: string;
  voidedAt: Date | null;
}
export interface SnapshotPerson {
  email: string;
  phone: string | null;
}

export interface DemoSnapshot {
  timeZone: string;
  customerCount: number;
  technicians: { id: string; name: string; email: string | null; phone: string | null }[];
  people: SnapshotPerson[];
  businessEmail: string;
  requests: SnapshotRequest[];
  quotations: SnapshotQuotation[];
  workOrders: SnapshotWorkOrder[];
  invoices: SnapshotInvoice[];
  payments: SnapshotPayment[];
  /** Email delivery attempts by status. */
  emailStatuses: Record<string, number>;
  /** Events recorded for a request that are older than the request itself. */
  eventsBeforeSubmission: number;
  /** Events and notifications dated after `now`. */
  futureRows: number;
  /** Notifications per recipient email: how many are read and how many are not. */
  notifications: Record<string, { read: number; unread: number }>;
  /** The names of services that can take new requests (published, not archived). */
  activeServiceSlugs: string[];
  /** How many saved addresses each demo customer has, by email. */
  addressCounts: Record<string, number>;
}

export interface DemoCheck {
  name: string;
  /** Empty when the rule holds; one line per violation otherwise. */
  problems: string[];
}

type Check = (data: DemoSnapshot, now: Date) => string[];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const REFERENCE_FORMATS = {
  request: /^FF-\d{4}-\d{5,}$/,
  quotation: /^QT-\d{4}-\d{5,}$/,
  job: /^JOB-\d{4}-\d{5,}$/,
  invoice: /^INV-\d{4}-\d{5,}$/,
} as const;

/** `(212) 555-0100` to `(212) 555-0199`: the range that is set aside for fiction. */
const FICTIONAL_PHONE = /^\(\d{3}\) 555-01\d\d$/;
const RESERVED_EMAIL = /\.test$/;

const byId = <T extends { id: string }>(rows: readonly T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.id, row]));

function range(label: string, count: number, bounds: { min: number; max: number }): string[] {
  return count >= bounds.min && count <= bounds.max
    ? []
    : [`${label}: ${count}, expected ${bounds.min} to ${bounds.max}`];
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

// ---- The checks ------------------------------------------------------------------------------------

const volumes: Check = (data) => [
  ...range("customers", data.customerCount, SHOWCASE_VOLUMES.customers),
  ...range("technicians", data.technicians.length, SHOWCASE_VOLUMES.technicians),
  ...range("requests", data.requests.length, SHOWCASE_VOLUMES.requests),
  ...range("quotations", data.quotations.length, SHOWCASE_VOLUMES.quotations),
  ...range("work orders", data.workOrders.length, SHOWCASE_VOLUMES.workOrders),
  ...range("invoices", data.invoices.length, SHOWCASE_VOLUMES.invoices),
  ...range("payments", data.payments.length, SHOWCASE_VOLUMES.payments),
];

function missingValues<T extends string>(all: readonly T[], present: readonly T[]): T[] {
  const found = new Set(present);
  return all.filter((value) => !found.has(value));
}

const everyStatusAppears: Check = (data) => {
  const problems: string[] = [];
  const report = (entity: string, missing: readonly string[]): void => {
    if (missing.length > 0) problems.push(`no ${entity} is ${missing.join(" or ")}`);
  };
  report(
    "request",
    missingValues(
      Object.values(ServiceRequestStatus),
      data.requests.map((row) => row.status),
    ),
  );
  report(
    "quotation",
    missingValues(
      Object.values(QuotationStatus),
      data.quotations.map((row) => row.status),
    ),
  );
  report(
    "job",
    missingValues(
      Object.values(WorkOrderStatus),
      data.workOrders.map((row) => row.status),
    ),
  );
  report(
    "invoice",
    missingValues(
      Object.values(InvoiceStatus),
      data.invoices.map((row) => row.status),
    ),
  );
  return problems;
};

/** Standing payments of every invoice, summed as decimals. */
function standingTotals(data: DemoSnapshot): Map<string, string> {
  const amounts = new Map<string, string[]>();
  for (const payment of data.payments) {
    if (payment.voidedAt === null) {
      amounts.set(payment.invoiceId, [...(amounts.get(payment.invoiceId) ?? []), payment.amount]);
    }
  }
  return new Map(
    data.invoices.map((invoice) => [invoice.id, sumAmounts(amounts.get(invoice.id) ?? [])]),
  );
}

const paidInvoicesAreSettled: Check = (data) => {
  const standing = standingTotals(data);
  return data.invoices
    .filter((invoice) => invoice.status === InvoiceStatus.PAID)
    .flatMap((invoice) => {
      const sum = standing.get(invoice.id) ?? "0.00";
      return invoice.amountPaid === invoice.totalAmount && sum === invoice.totalAmount
        ? []
        : [
            `${invoice.invoiceNumber ?? invoice.id} is PAID but amountPaid is ${invoice.amountPaid}, its payments add up to ${sum} and its total is ${invoice.totalAmount}`,
          ];
    });
};

const amountPaidIsThePaymentsSum: Check = (data) => {
  const standing = standingTotals(data);
  return data.invoices.flatMap((invoice) => {
    const sum = standing.get(invoice.id) ?? "0.00";
    const problems: string[] = [];
    if (invoice.amountPaid !== sum) {
      problems.push(
        `${invoice.invoiceNumber ?? invoice.id}: amountPaid is ${invoice.amountPaid} but its payments add up to ${sum}`,
      );
    }
    if (balanceDue(invoice.totalAmount, invoice.amountPaid).startsWith("-")) {
      problems.push(`${invoice.invoiceNumber ?? invoice.id}: amountPaid exceeds the total`);
    }
    return problems;
  });
};

const invoiceStatusesAreDerived: Check = (data, now) =>
  data.invoices.flatMap((invoice) => {
    const derived = deriveInvoiceStatus({
      issuedAt: invoice.issuedAt,
      voidedAt: invoice.voidedAt,
      totalAmount: invoice.totalAmount,
      amountPaid: invoice.amountPaid,
      dueDate: invoice.dueDate,
      now,
      timeZone: data.timeZone,
    });
    return derived === invoice.status
      ? []
      : [`${invoice.invoiceNumber ?? invoice.id} is stored as ${invoice.status} but is ${derived}`];
  });

const quotationStatusesAreDerived: Check = (data, now) =>
  data.quotations.flatMap((quotation) => {
    const effective = effectiveQuotationStatus(quotation, now, data.timeZone);
    return effective === quotation.status
      ? []
      : [`${quotation.reference} is stored as ${quotation.status} but is ${effective}`];
  });

const acceptedIsNeverDeclined: Check = (data) => {
  const problems: string[] = [];
  const perRequest = new Map<string, Set<QuotationStatus>>();
  for (const quotation of data.quotations) {
    perRequest.set(
      quotation.requestId,
      (perRequest.get(quotation.requestId) ?? new Set()).add(quotation.status),
    );
    if (quotation.status === QuotationStatus.ACCEPTED && quotation.declineReason !== null) {
      problems.push(`${quotation.reference} is ACCEPTED but carries a decline reason`);
    }
    if (quotation.status === QuotationStatus.ACCEPTED && quotation.respondedAt === null) {
      problems.push(`${quotation.reference} is ACCEPTED but has no response time`);
    }
  }
  const references = new Map(data.requests.map((request) => [request.id, request.reference]));
  for (const [requestId, statuses] of perRequest) {
    if (statuses.has(QuotationStatus.ACCEPTED) && statuses.has(QuotationStatus.DECLINED)) {
      problems.push(
        `${references.get(requestId) ?? requestId} has a quotation both accepted and declined`,
      );
    }
  }
  return problems;
};

const requestsMatchTheirQuotationsAndJobs: Check = (data) => {
  const problems: string[] = [];
  for (const request of data.requests) {
    const quotes = data.quotations.filter((quotation) => quotation.requestId === request.id);
    const has = (status: QuotationStatus): boolean =>
      quotes.some((quotation) => quotation.status === status);
    const jobs = data.workOrders.filter((job) => job.requestId === request.id);
    const say = (message: string): void => {
      problems.push(`${request.reference} (${request.status}) ${message}`);
    };
    switch (request.status) {
      case ServiceRequestStatus.SUBMITTED:
      case ServiceRequestStatus.UNDER_REVIEW:
        if (has(QuotationStatus.SENT) || has(QuotationStatus.ACCEPTED))
          say("has a quotation waiting or accepted");
        break;
      case ServiceRequestStatus.QUOTED:
        if (!has(QuotationStatus.SENT)) say("has no sent quotation");
        break;
      case ServiceRequestStatus.ACCEPTED:
        if (!has(QuotationStatus.ACCEPTED)) say("has no accepted quotation");
        if (jobs.length > 0) say("already has a job");
        break;
      case ServiceRequestStatus.DECLINED:
        if (!has(QuotationStatus.DECLINED)) say("has no declined quotation");
        break;
      case ServiceRequestStatus.CONVERTED_TO_JOB:
        if (jobs.length !== 1) say(`has ${jobs.length} jobs, expected one`);
        break;
      case ServiceRequestStatus.CANCELLED:
        if (has(QuotationStatus.DRAFT) || has(QuotationStatus.SENT))
          say("still has an open quotation");
        break;
    }
    if (request.status !== ServiceRequestStatus.CONVERTED_TO_JOB && jobs.length > 0) {
      say("has a job but is not converted");
    }
  }
  return problems;
};

const everyJobHasAnAcceptedQuotation: Check = (data) => {
  const quotations = byId(data.quotations);
  return data.workOrders.flatMap((job) => {
    const quotation = quotations.get(job.quotationId);
    if (quotation === undefined)
      return [`${job.reference} links to a quotation that does not exist`];
    const problems: string[] = [];
    if (quotation.status !== QuotationStatus.ACCEPTED) {
      problems.push(
        `${job.reference} links to ${quotation.reference}, which is ${quotation.status}, not ACCEPTED`,
      );
    }
    if (quotation.requestId !== job.requestId) {
      problems.push(
        `${job.reference} links to ${quotation.reference}, which belongs to another request`,
      );
    }
    if (quotation.customerId !== job.customerId) {
      problems.push(
        `${job.reference} links to ${quotation.reference}, which belongs to another customer`,
      );
    }
    return problems;
  });
};

const jobFieldsMatchTheirStatus: Check = (data) =>
  data.workOrders.flatMap((job) => {
    const say = (message: string): string => `${job.reference} (${job.status}) ${message}`;
    const booked =
      job.technicianId !== null && job.scheduledStart !== null && job.scheduledEnd !== null;
    switch (job.status) {
      case WorkOrderStatus.PENDING_SCHEDULING:
        return job.technicianId === null && job.scheduledStart === null
          ? []
          : [say("is booked although it is waiting to be scheduled")];
      case WorkOrderStatus.SCHEDULED:
        return booked && job.startedAt === null
          ? []
          : [say("needs a technician, a time and no start time")];
      case WorkOrderStatus.IN_PROGRESS:
        return booked && job.startedAt !== null && job.completedAt === null
          ? []
          : [say("needs a technician, a time and a start time, and no completion")];
      case WorkOrderStatus.NEEDS_RESCHEDULING:
        return job.startedAt === null ? [] : [say("has a start time")];
      case WorkOrderStatus.CANCELLED:
        return job.cancelReason === null ? [say("has no cancellation reason")] : [];
      case WorkOrderStatus.COMPLETED:
        return [];
    }
  });

const noTechnicianOverlaps: Check = (data) => {
  const problems: string[] = [];
  const names = new Map(data.technicians.map((technician) => [technician.id, technician.name]));
  const holding = data.workOrders.filter(
    (job) =>
      (job.status === WorkOrderStatus.SCHEDULED || job.status === WorkOrderStatus.IN_PROGRESS) &&
      job.technicianId !== null &&
      job.scheduledStart !== null &&
      job.scheduledEnd !== null,
  );
  const perTechnician = new Map<string, SnapshotWorkOrder[]>();
  for (const job of holding) {
    const key = job.technicianId ?? "";
    perTechnician.set(key, [...(perTechnician.get(key) ?? []), job]);
  }
  for (const [technicianId, jobs] of perTechnician) {
    const sorted = [...jobs].sort(
      (a, b) => (a.scheduledStart?.getTime() ?? 0) - (b.scheduledStart?.getTime() ?? 0),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (
        previous?.scheduledEnd != null &&
        current?.scheduledStart != null &&
        previous.scheduledEnd.getTime() > current.scheduledStart.getTime()
      ) {
        problems.push(
          `${names.get(technicianId) ?? technicianId} is booked for ${previous.reference} and ${current.reference} at the same time`,
        );
      }
    }
  }
  return problems;
};

const completedJobsHavePlausibleTimes: Check = (data, now) =>
  data.workOrders
    .filter((job) => job.status === WorkOrderStatus.COMPLETED)
    .flatMap((job) => {
      const { startedAt, completedAt, scheduledStart, scheduledEnd } = job;
      const say = (message: string): string => `${job.reference} ${message}`;
      if (startedAt === null || completedAt === null)
        return [say("is completed without a start or completion time")];
      if (scheduledStart === null || scheduledEnd === null)
        return [say("is completed without a booked visit")];
      const problems: string[] = [];
      const took = completedAt.getTime() - startedAt.getTime();
      if (took < 10 * MINUTE)
        problems.push(say("took less than ten minutes, or ended before it began"));
      if (took > 12 * HOUR) problems.push(say("took more than twelve hours"));
      if (startedAt.getTime() < scheduledStart.getTime() - 2 * HOUR) {
        problems.push(say("started more than two hours before its visit"));
      }
      if (startedAt.getTime() > scheduledEnd.getTime())
        problems.push(say("started after its visit ended"));
      if (completedAt.getTime() > scheduledEnd.getTime() + 3 * HOUR) {
        problems.push(say("finished more than three hours after its visit ended"));
      }
      if (completedAt.getTime() > now.getTime()) problems.push(say("was completed in the future"));
      return problems;
    });

const invoicesBelongToCompletedJobs: Check = (data) => {
  const jobs = byId(data.workOrders);
  const problems: string[] = [];
  const live = new Map<string, number>();
  for (const invoice of data.invoices) {
    const job = jobs.get(invoice.workOrderId);
    const label = invoice.invoiceNumber ?? invoice.id;
    if (job === undefined) {
      problems.push(`${label} belongs to a job that does not exist`);
    } else if (job.status !== WorkOrderStatus.COMPLETED) {
      problems.push(`${label} is for ${job.reference}, which is ${job.status}, not COMPLETED`);
    }
    if (invoice.status !== InvoiceStatus.VOID) {
      live.set(invoice.workOrderId, (live.get(invoice.workOrderId) ?? 0) + 1);
    }
    if (invoice.status === InvoiceStatus.DRAFT && invoice.invoiceNumber !== null) {
      problems.push(`${label} is a draft with a number`);
    }
    if (invoice.status !== InvoiceStatus.DRAFT && invoice.invoiceNumber === null) {
      problems.push(`${invoice.id} is ${invoice.status} but has no invoice number`);
    }
    if (invoice.status === InvoiceStatus.VOID && (invoice.voidReason ?? "").trim() === "") {
      problems.push(`${label} is VOID without a reason`);
    }
  }
  for (const [jobId, count] of live) {
    if (count > 1)
      problems.push(
        `${jobs.get(jobId)?.reference ?? jobId} has ${count} invoices that are not void`,
      );
  }
  return problems;
};

const referencesAreWellFormedAndUnique: Check = (data) => {
  const problems: string[] = [];
  const audit = (kind: keyof typeof REFERENCE_FORMATS, values: readonly string[]): void => {
    for (const value of values) {
      if (!REFERENCE_FORMATS[kind].test(value))
        problems.push(`the ${kind} reference ${value} is malformed`);
    }
    for (const value of duplicates(values))
      problems.push(`the ${kind} reference ${value} is used twice`);
  };
  audit(
    "request",
    data.requests.map((row) => row.reference),
  );
  audit(
    "quotation",
    data.quotations.map((row) => row.reference),
  );
  audit(
    "job",
    data.workOrders.map((row) => row.reference),
  );
  audit(
    "invoice",
    data.invoices.flatMap((row) => (row.invoiceNumber === null ? [] : [row.invoiceNumber])),
  );
  return problems;
};

const everythingIsFictional: Check = (data) => {
  const problems: string[] = [];
  for (const person of data.people) {
    if (!RESERVED_EMAIL.test(person.email))
      problems.push(`${person.email} is not on a reserved .test domain`);
    if (person.phone !== null && !FICTIONAL_PHONE.test(person.phone)) {
      problems.push(`${person.email} has a phone number outside the fictional 555-01xx range`);
    }
  }
  for (const technician of data.technicians) {
    if (technician.email !== null && !RESERVED_EMAIL.test(technician.email)) {
      problems.push(`${technician.name} has an email outside the reserved .test domain`);
    }
    if (technician.phone !== null && !FICTIONAL_PHONE.test(technician.phone)) {
      problems.push(`${technician.name} has a phone number outside the fictional 555-01xx range`);
    }
  }
  if (!RESERVED_EMAIL.test(data.businessEmail))
    problems.push("the business email is not on a reserved .test domain");
  return problems;
};

const emailIsLoggedNeverSent: Check = (data) =>
  Object.entries(data.emailStatuses)
    .filter(([status, count]) => status !== EmailDeliveryStatus.LOGGED && count > 0)
    .map(
      ([status, count]) =>
        `${count} email(s) are ${status}; every showcase email is only logged (D-52)`,
    );

const historyIsInOrder: Check = (data) => {
  const problems: string[] = [];
  if (data.eventsBeforeSubmission > 0) {
    problems.push(
      `${data.eventsBeforeSubmission} event(s) are older than the request they belong to`,
    );
  }
  if (data.futureRows > 0)
    problems.push(`${data.futureRows} event(s) or notification(s) are dated in the future`);
  return problems;
};

const storiesTheScriptNeeds: Check = (data, now) => {
  const problems: string[] = [];
  const alex = DEMO_ACCOUNTS.find((account) => account.name === "Alex Morgan");
  const admin = DEMO_ACCOUNTS.find((account) => account.role === "BUSINESS_ADMIN");
  const calendar = createCalendar(now, data.timeZone);
  const today = calendar.today;

  const waiting = data.quotations.filter(
    (quotation) => quotation.status === QuotationStatus.SENT && quotation.validUntil >= today,
  );
  if (waiting.length === 0) problems.push("no quotation is waiting for a decision");

  const replaced = data.quotations.some(
    (quotation) =>
      quotation.status === QuotationStatus.VOID &&
      data.quotations.some((other) => other.replacesQuotationId === quotation.id),
  );
  if (!replaced) problems.push("no VOID quotation was replaced by a newer one");
  if (
    !data.quotations.some(
      (q) => q.status === QuotationStatus.DECLINED && (q.declineReason ?? "") !== "",
    )
  ) {
    problems.push("no DECLINED quotation carries a reason");
  }

  const inToday = data.workOrders.filter(
    (job) =>
      job.status === WorkOrderStatus.IN_PROGRESS &&
      job.scheduledStart !== null &&
      toDateOnlyIn(job.scheduledStart, data.timeZone) === today,
  );
  if (inToday.length === 0) problems.push("no job is IN_PROGRESS today");

  const holding = data.workOrders.filter(
    (job) =>
      (job.status === WorkOrderStatus.SCHEDULED || job.status === WorkOrderStatus.IN_PROGRESS) &&
      job.scheduledStart !== null &&
      job.scheduledEnd !== null &&
      job.technicianId !== null,
  );
  const upcoming = holding.filter(
    (job) =>
      job.status === WorkOrderStatus.SCHEDULED &&
      (job.scheduledStart?.getTime() ?? 0) >= now.getTime() &&
      (job.scheduledStart?.getTime() ?? 0) < now.getTime() + 8 * 24 * HOUR,
  );
  const technicianOfUpcoming = new Set(upcoming.map((job) => job.technicianId));
  if (upcoming.length < 3)
    problems.push(`only ${upcoming.length} job(s) are booked in the next eight days`);
  if (technicianOfUpcoming.size < 2)
    problems.push("the booked jobs of the coming days are all with one technician");

  // A back-to-back pair: one visit ends exactly when the same technician's next one begins.
  const byTechnician = new Map<string, SnapshotWorkOrder[]>();
  for (const job of holding) {
    byTechnician.set(job.technicianId ?? "", [
      ...(byTechnician.get(job.technicianId ?? "") ?? []),
      job,
    ]);
  }
  const backToBack = [...byTechnician.values()].some((jobs) =>
    jobs.some((first) =>
      jobs.some((second) => first.scheduledEnd?.getTime() === second.scheduledStart?.getTime()),
    ),
  );
  if (!backToBack) problems.push("no technician has two visits that follow each other directly");

  // Jordan Lee has a free day this week: a non-Sunday in the next seven days with no visit.
  const jordan = data.technicians.find((technician) => technician.name === "Jordan Lee");
  if (jordan === undefined) {
    problems.push("Jordan Lee is missing");
  } else {
    const busyDays = new Set(
      holding
        .filter((job) => job.technicianId === jordan.id)
        .map((job) => toDateOnlyIn(job.scheduledStart as Date, data.timeZone)),
    );
    let free = 0;
    for (let offset = 1; offset <= 7; offset += 1) {
      const date = calendar.dateOf(offset);
      if (dayOfWeek(date) !== 0 && !busyDays.has(date)) free += 1;
    }
    if (free < 3) problems.push(`Jordan Lee has only ${free} free day(s) in the next seven`);
  }

  if (!data.activeServiceSlugs.includes("ac-diagnostic-visit")) {
    problems.push("the AC Diagnostic Visit service cannot take a new request");
  }
  if (alex !== undefined && (data.addressCounts[alex.email] ?? 0) < 1) {
    problems.push("Alex Morgan has no saved address to send a request to");
  }
  for (const account of [alex, admin]) {
    if (account === undefined) continue;
    const counts = data.notifications[account.email];
    if (counts === undefined || counts.read === 0 || counts.unread === 0) {
      problems.push(`${account.email} should have some notifications read and some unread`);
    }
  }
  return problems;
};

/** The business date of an instant, `YYYY-MM-DD`. */
function toDateOnlyIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parts;
}

export const DEMO_CHECKS: readonly { name: string; check: Check }[] = [
  { name: "volumes are within the ranges", check: volumes },
  { name: "every status of every entity appears", check: everyStatusAppears },
  {
    name: "PAID invoices have amountPaid = total = the sum of their active payments",
    check: paidInvoicesAreSettled,
  },
  {
    name: "every amountPaid equals the sum of its active payments",
    check: amountPaidIsThePaymentsSum,
  },
  { name: "invoice statuses equal the derived statuses", check: invoiceStatusesAreDerived },
  { name: "quotation statuses equal the derived statuses", check: quotationStatusesAreDerived },
  { name: "accepted quotations are never also declined", check: acceptedIsNeverDeclined },
  {
    name: "requests agree with their quotations and jobs",
    check: requestsMatchTheirQuotationsAndJobs,
  },
  {
    name: "every job links to an ACCEPTED quotation of its own request",
    check: everyJobHasAnAcceptedQuotation,
  },
  { name: "a job's fields match its status", check: jobFieldsMatchTheirStatus },
  { name: "no technician is booked twice at once", check: noTechnicianOverlaps },
  {
    name: "completed jobs have plausible start and complete times",
    check: completedJobsHavePlausibleTimes,
  },
  {
    name: "invoices belong to completed jobs, one live invoice each",
    check: invoicesBelongToCompletedJobs,
  },
  { name: "references are well formed and unique", check: referencesAreWellFormedAndUnique },
  { name: "all personal data is fictional", check: everythingIsFictional },
  { name: "emails are logged, never sent", check: emailIsLoggedNeverSent },
  { name: "history is in order and not in the future", check: historyIsInOrder },
  { name: "the demo script has what it needs", check: storiesTheScriptNeeds },
];

export interface DemoReport {
  checks: DemoCheck[];
  ok: boolean;
}

/** Runs every check. It never throws for a violation; read {@link DemoReport.ok}. */
export function runDemoChecks(snapshot: DemoSnapshot, now: Date): DemoReport {
  const checks = DEMO_CHECKS.map(({ name, check }) => ({ name, problems: check(snapshot, now) }));
  return { checks, ok: checks.every((entry) => entry.problems.length === 0) };
}

export function formatDemoReport(report: DemoReport): string {
  const lines = report.checks.flatMap((entry) =>
    entry.problems.length === 0
      ? [`  PASS  ${entry.name}`]
      : [`  FAIL  ${entry.name}`, ...entry.problems.map((problem) => `          - ${problem}`)],
  );
  const failed = report.checks.filter((entry) => entry.problems.length > 0).length;
  return [
    ...lines,
    "",
    report.ok
      ? `All ${report.checks.length} checks passed.`
      : `${failed} of ${report.checks.length} checks failed.`,
  ].join("\n");
}

// ---- Reading the snapshot from the database -----------------------------------------------------------

const money = (value: { toFixed(places: number): string }): string => value.toFixed(2);

export async function loadDemoSnapshot(prisma: PrismaClient, now: Date): Promise<DemoSnapshot> {
  const settings = await prisma.businessSettings.findUniqueOrThrow({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { timeZone: true, contactEmail: true },
  });

  const [
    customerCount,
    technicians,
    customerUsers,
    requests,
    quotations,
    workOrders,
    invoices,
    payments,
    emailGroups,
    beforeSubmission,
    futureEvents,
    futureNotifications,
    notificationRows,
    services,
    demoAddresses,
  ] = await Promise.all([
    prisma.customerProfile.count(),
    prisma.technician.findMany({ select: { id: true, name: true, email: true, phone: true } }),
    prisma.user.findMany({
      where: { role: "CUSTOMER" },
      select: { email: true, customerProfile: { select: { phone: true } } },
    }),
    prisma.serviceRequest.findMany({
      select: { id: true, reference: true, status: true, customerId: true, submittedAt: true },
    }),
    prisma.quotation.findMany({
      select: {
        id: true,
        reference: true,
        requestId: true,
        customerId: true,
        status: true,
        validUntil: true,
        declineReason: true,
        respondedAt: true,
        sentAt: true,
        voidReason: true,
        replacesQuotationId: true,
      },
    }),
    prisma.workOrder.findMany({
      select: {
        id: true,
        reference: true,
        requestId: true,
        quotationId: true,
        customerId: true,
        status: true,
        technicianId: true,
        scheduledStart: true,
        scheduledEnd: true,
        startedAt: true,
        completedAt: true,
        cancelReason: true,
      },
    }),
    prisma.invoice.findMany({
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        workOrderId: true,
        totalAmount: true,
        amountPaid: true,
        issuedAt: true,
        voidedAt: true,
        voidReason: true,
        dueDate: true,
      },
    }),
    prisma.paymentRecord.findMany({
      select: { id: true, invoiceId: true, amount: true, voidedAt: true },
    }),
    prisma.emailDeliveryLog.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM activity_events e
      JOIN service_requests r ON r.id = e.request_id
      WHERE e.created_at < r.submitted_at`,
    prisma.activityEvent.count({ where: { createdAt: { gt: now } } }),
    prisma.notification.count({ where: { createdAt: { gt: now } } }),
    prisma.notification.findMany({
      select: { readAt: true, recipient: { select: { email: true } } },
    }),
    prisma.service.findMany({
      where: { isPublished: true, archivedAt: null },
      select: { slug: true },
    }),
    prisma.user.findMany({
      where: { email: { in: DEMO_ACCOUNTS.map((account) => account.email) } },
      select: {
        email: true,
        customerProfile: { select: { _count: { select: { addresses: true } } } },
      },
    }),
  ]);

  const notifications: DemoSnapshot["notifications"] = {};
  for (const row of notificationRows) {
    const entry = (notifications[row.recipient.email] ??= { read: 0, unread: 0 });
    if (row.readAt === null) entry.unread += 1;
    else entry.read += 1;
  }

  return {
    timeZone: settings.timeZone,
    customerCount,
    technicians,
    people: customerUsers.map((user) => ({
      email: user.email,
      phone: user.customerProfile?.phone ?? null,
    })),
    businessEmail: settings.contactEmail,
    requests,
    quotations: quotations.map((quotation) => ({
      ...quotation,
      validUntil: toDateOnly(quotation.validUntil),
    })),
    workOrders,
    invoices: invoices.map((invoice) => ({
      ...invoice,
      totalAmount: money(invoice.totalAmount),
      amountPaid: money(invoice.amountPaid),
      dueDate: invoice.dueDate === null ? null : toDateOnly(invoice.dueDate),
    })),
    payments: payments.map((payment) => ({ ...payment, amount: money(payment.amount) })),
    emailStatuses: Object.fromEntries(
      emailGroups.map((group) => [group.status, group._count._all]),
    ),
    eventsBeforeSubmission: Number(beforeSubmission[0]?.count ?? 0),
    futureRows: futureEvents + futureNotifications,
    notifications,
    activeServiceSlugs: services.map((service) => service.slug),
    addressCounts: Object.fromEntries(
      demoAddresses.map((user) => [user.email, user.customerProfile?._count.addresses ?? 0]),
    ),
  };
}

/** Loads the snapshot and runs every check. */
export async function verifyDemo(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<DemoReport> {
  return runDemoChecks(await loadDemoSnapshot(prisma, now), now);
}
