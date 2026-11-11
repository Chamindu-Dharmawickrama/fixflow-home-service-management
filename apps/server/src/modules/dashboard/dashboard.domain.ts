import {
  addDaysToDateOnly,
  ATTENTION_ITEM_TYPES,
  type AttentionItemDto,
  type AttentionItemType,
  balanceDue,
  DASHBOARD_LIMITS,
  DASHBOARD_RANGE_DAYS,
  type DashboardActivityDto,
  type DashboardAttentionDto,
  type DashboardKpisDto,
  type DashboardPeriodDto,
  type DashboardRange,
  dateOnlyInTimeZone,
  daysBetweenDateOnly,
  instantToWallClock,
  InvoiceStatus,
  OUTSTANDING_INVOICE_STATUSES,
  ServiceRequestStatus,
  WorkOrderStatus,
} from "@fixflow/shared";

import { startOfBusinessDay } from "../../lib/business-day.js";

/**
 * The dashboard's pure rules (FR-080 to FR-085): the period of each range on the business's
 * calendar, the sentences that say how long something has waited, the classification of the
 * needs-attention queue, and the definition and link of each KPI. Nothing here reads the database or
 * the clock; the service hands in the rows and `now`.
 */

// ---- Paths ------------------------------------------------------------------------------------

/** The admin screens the dashboard links to. The web app owns these routes; a test checks each is a safe app path. */
export const DASHBOARD_PATHS = {
  requests: "/app/requests",
  jobs: "/app/jobs",
  invoices: "/app/invoices",
  quotations: "/app/quotations",
  customers: "/app/customers",
  technicians: "/app/technicians",
} as const;

/**
 * The statuses that need the business to act on the request: new, under review with no quotation out
 * (a request with a quotation out is `QUOTED`), accepted and waiting for a job, and declined and not
 * yet closed. Both the KPI and its link use this list.
 */
export const REQUESTS_NEEDING_ACTION_STATUSES = [
  ServiceRequestStatus.SUBMITTED,
  ServiceRequestStatus.UNDER_REVIEW,
  ServiceRequestStatus.ACCEPTED,
  ServiceRequestStatus.DECLINED,
] as const;

/** The jobs that hold a visit: the KPI counts these starting today and in the days after. */
export const VISIT_STATUSES = [WorkOrderStatus.SCHEDULED, WorkOrderStatus.IN_PROGRESS] as const;

/** The invoices that still owe money. */
export const UNPAID_STATUSES = OUTSTANDING_INVOICE_STATUSES;

// ---- The period -----------------------------------------------------------------------------------

export interface DashboardPeriod extends DashboardPeriodDto {
  /** The first instant of the period (inclusive) and the first instant after it (exclusive). */
  fromInstant: Date;
  beforeInstant: Date;
}

/**
 * The days a range covers, ending today, on the business's calendar: `today` is one day, `7d` the
 * last seven days and `30d` the last thirty, today included in each. The instants are the start of
 * the first day and the start of the day after the last, each looked up for its own day, so a period
 * that crosses a change of the clocks is still made of whole calendar days (BR-17, D-42).
 */
export function dashboardPeriod(
  range: DashboardRange,
  now: Date,
  timeZone: string,
): DashboardPeriod {
  const to = dateOnlyInTimeZone(now, timeZone);
  const from = addDaysToDateOnly(to, 1 - DASHBOARD_RANGE_DAYS[range]);
  return {
    range,
    from,
    to,
    fromInstant: startOfBusinessDay(from, timeZone),
    beforeInstant: startOfBusinessDay(addDaysToDateOnly(to, 1), timeZone),
  };
}

export interface BusinessDay {
  /** `YYYY-MM-DD` on the business's calendar. */
  date: string;
  start: Date;
  /** The start of the next day: the exclusive end. */
  end: Date;
}

/** One day on the business's calendar and the instants that bound it. */
export function businessDay(date: string, timeZone: string): BusinessDay {
  return {
    date,
    start: startOfBusinessDay(date, timeZone),
    end: startOfBusinessDay(addDaysToDateOnly(date, 1), timeZone),
  };
}

// ---- Words ------------------------------------------------------------------------------------------

function plural(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

/**
 * How long ago something happened: "just now", "12 min ago", "2 h ago", "3 days ago". Whole units,
 * rounded down, so "2 h ago" never means less than two hours. An instant a little ahead of `now`
 * (clock skew) reads as "just now".
 */
export function relativeAgo(then: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  return `${plural(Math.floor(hours / 24), "day", "days")} ago`;
}

/** "overdue by 1 day" / "overdue by 6 days". */
export function overdueText(daysOverdue: number): string {
  return `overdue by ${plural(Math.max(daysOverdue, 1), "day", "days")}`;
}

/** When a quotation's last valid day is: "expires today", "expires tomorrow", "expires in 2 days". */
export function expiryText(daysLeft: number): string {
  if (daysLeft <= 0) {
    return "expires today";
  }
  return daysLeft === 1 ? "expires tomorrow" : `expires in ${daysLeft} days`;
}

// ---- Needs attention ----------------------------------------------------------------------------------

export interface AttentionRowBase {
  id: string;
  /** The reference (or invoice number) shown in the title. */
  reference: string;
  /** The customer's name only. */
  customerName: string;
  serviceName: string;
}

const title = (reference: string, customerName: string) => `${reference} · ${customerName}`;

export interface NewRequestRow extends AttentionRowBase {
  submittedAt: Date;
}

/** A request nobody has started reviewing. */
export function newRequestItem(row: NewRequestRow, now: Date): AttentionItemDto {
  return {
    id: `NEW_REQUEST:${row.id}`,
    type: "NEW_REQUEST",
    title: title(row.reference, row.customerName),
    context: `${row.serviceName} · submitted ${relativeAgo(row.submittedAt, now)}`,
    link: `${DASHBOARD_PATHS.requests}/${row.id}`,
    actionLabel: "Review request",
    amount: null,
    since: row.submittedAt.toISOString(),
  };
}

export interface AcceptedQuotationRow extends AttentionRowBase {
  /** When the customer accepted; the request's own id is `id`. */
  acceptedAt: Date | null;
}

/** An accepted quotation whose request has no job yet. */
export function acceptedQuotationItem(row: AcceptedQuotationRow, now: Date): AttentionItemDto {
  return {
    id: `ACCEPTED_QUOTATION:${row.id}`,
    type: "ACCEPTED_QUOTATION",
    title: title(row.reference, row.customerName),
    context:
      row.acceptedAt === null
        ? `${row.serviceName} · quotation accepted`
        : `${row.serviceName} · quotation accepted ${relativeAgo(row.acceptedAt, now)}`,
    link: `${DASHBOARD_PATHS.requests}/${row.id}`,
    actionLabel: "Create job",
    amount: null,
    since: row.acceptedAt?.toISOString() ?? null,
  };
}

export interface JobNeedsSchedulingRow extends AttentionRowBase {
  status: typeof WorkOrderStatus.PENDING_SCHEDULING | typeof WorkOrderStatus.NEEDS_RESCHEDULING;
  /** When the job reached this state (the row's last change). */
  updatedAt: Date;
}

/** A job with no time, or one whose time was released. The link opens the scheduling dialog. */
export function jobNeedsSchedulingItem(row: JobNeedsSchedulingRow, now: Date): AttentionItemDto {
  const rescheduling = row.status === WorkOrderStatus.NEEDS_RESCHEDULING;
  return {
    id: `JOB_NEEDS_SCHEDULING:${row.id}`,
    type: "JOB_NEEDS_SCHEDULING",
    title: title(row.reference, row.customerName),
    context: `${row.serviceName} · ${rescheduling ? "needs a new time" : "needs a time"} · ${relativeAgo(row.updatedAt, now)}`,
    link: `${DASHBOARD_PATHS.jobs}/${row.id}?schedule=1`,
    actionLabel: rescheduling ? "Reschedule" : "Schedule",
    amount: null,
    since: row.updatedAt.toISOString(),
  };
}

export interface JobTodayRow extends AttentionRowBase {
  scheduledStart: Date;
  technicianName: string | null;
}

/** A visit planned for today that nobody has started. */
export function jobTodayItem(row: JobTodayRow, now: Date, timeZone: string): AttentionItemDto {
  const time = instantToWallClock(row.scheduledStart, timeZone).time;
  const started = row.scheduledStart.getTime() <= now.getTime();
  const who = row.technicianName === null ? "" : ` · ${row.technicianName}`;
  return {
    id: `JOB_TODAY_NOT_STARTED:${row.id}`,
    type: "JOB_TODAY_NOT_STARTED",
    title: title(row.reference, row.customerName),
    context: `${row.serviceName} · ${started ? `was due to start at ${time}` : `starts at ${time} today`}${who}`,
    link: `${DASHBOARD_PATHS.jobs}/${row.id}`,
    actionLabel: "Open job",
    amount: null,
    since: row.scheduledStart.toISOString(),
  };
}

export interface JobAwaitingInvoiceRow extends AttentionRowBase {
  completedAt: Date | null;
}

/** A finished job nobody has invoiced. */
export function jobAwaitingInvoiceItem(row: JobAwaitingInvoiceRow, now: Date): AttentionItemDto {
  return {
    id: `JOB_AWAITING_INVOICE:${row.id}`,
    type: "JOB_AWAITING_INVOICE",
    title: title(row.reference, row.customerName),
    context:
      row.completedAt === null
        ? `${row.serviceName} · completed`
        : `${row.serviceName} · completed ${relativeAgo(row.completedAt, now)}`,
    link: `${DASHBOARD_PATHS.jobs}/${row.id}`,
    actionLabel: "Create invoice",
    amount: null,
    since: row.completedAt?.toISOString() ?? null,
  };
}

export interface OverdueInvoiceRow {
  id: string;
  /** `null` cannot happen for an overdue invoice (it was issued); the title falls back to "Invoice". */
  invoiceNumber: string | null;
  customerName: string;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  totalAmount: string;
  amountPaid: string;
  currencyCode: string;
}

/** An invoice past its due date with a balance. */
export function overdueInvoiceItem(row: OverdueInvoiceRow, today: string): AttentionItemDto {
  return {
    id: `OVERDUE_INVOICE:${row.id}`,
    type: "OVERDUE_INVOICE",
    title: title(row.invoiceNumber ?? "Invoice", row.customerName),
    context: overdueText(daysBetweenDateOnly(row.dueDate, today)),
    link: `${DASHBOARD_PATHS.invoices}/${row.id}`,
    actionLabel: "Open invoice",
    amount: { amount: balanceDue(row.totalAmount, row.amountPaid), currencyCode: row.currencyCode },
    since: null,
  };
}

export interface ExpiringQuotationRow extends AttentionRowBase {
  /** `YYYY-MM-DD`, the last day the quotation can be accepted. */
  validUntil: string;
}

/** A sent quotation that runs out within a couple of days. */
export function expiringQuotationItem(row: ExpiringQuotationRow, today: string): AttentionItemDto {
  return {
    id: `QUOTATION_EXPIRING:${row.id}`,
    type: "QUOTATION_EXPIRING",
    title: title(row.reference, row.customerName),
    context: `${row.serviceName} · ${expiryText(daysBetweenDateOnly(today, row.validUntil))}`,
    link: `${DASHBOARD_PATHS.quotations}/${row.id}`,
    actionLabel: "View quotation",
    amount: null,
    since: null,
  };
}

/**
 * The queue: the most urgent kind first, in the order of {@link ATTENTION_ITEM_TYPES}, and inside a
 * kind in the order given (the caller sorts each kind by how long it has waited), cut at the cap.
 * Before the cut, the first item of every kind that has any is kept, so a flood of one kind (twenty
 * new requests) can never hide that an invoice is overdue or a quotation was accepted; the rest of
 * the places go to the most urgent items in priority order. `counts` is how many of each kind exist,
 * so the screen can say how many are not shown.
 */
export function buildAttention(
  itemsByType: Readonly<Record<AttentionItemType, readonly AttentionItemDto[]>>,
  counts: Readonly<Record<AttentionItemType, number>>,
  cap: number = DASHBOARD_LIMITS.attentionItems,
): DashboardAttentionDto {
  const kept = new Set<AttentionItemDto>();
  for (const type of ATTENTION_ITEM_TYPES) {
    const first = itemsByType[type][0];
    if (first !== undefined && kept.size < cap) {
      kept.add(first);
    }
  }
  for (const type of ATTENTION_ITEM_TYPES) {
    for (const item of itemsByType[type]) {
      if (kept.size >= cap) {
        break;
      }
      kept.add(item);
    }
  }
  const items = ATTENTION_ITEM_TYPES.flatMap((type) => itemsByType[type]).filter((item) =>
    kept.has(item),
  );
  return {
    items,
    totalItems: ATTENTION_ITEM_TYPES.reduce((sum, type) => sum + counts[type], 0),
    counts: { ...counts },
  };
}

// ---- KPIs ---------------------------------------------------------------------------------------------

export interface KpiFigures {
  newRequests: number;
  requestsNeedingAction: number;
  jobsToday: number;
  jobsNext: number;
  awaitingInvoice: number;
  unpaidAmount: string;
  unpaidCount: number;
  overdueAmount: string;
  overdueCount: number;
}

const RANGE_WORDS: Readonly<Record<DashboardRange, string>> = {
  today: "today",
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
};

/** The query string of a list link: raw commas keep a list of statuses readable. */
function queryString(params: Readonly<Record<string, string>>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value).replaceAll("%2C", ",")}`)
    .join("&");
}

/**
 * The five KPIs with their definitions and links (FR-080, FR-085). Each definition says what the
 * query counts, in the words the business uses, and each link lands on a list whose filters
 * reproduce the figure. Only the first follows the range; the others are the state right now.
 */
export function buildKpis(
  figures: KpiFigures,
  period: DashboardPeriodDto,
  today: string,
  currencyCode: string,
): DashboardKpisDto {
  const jobsEnd = addDaysToDateOnly(today, DASHBOARD_LIMITS.upcomingJobDays);
  return {
    newRequests: {
      label: "New requests",
      value: figures.newRequests,
      scope: "range",
      definition: `Service requests submitted ${RANGE_WORDS[period.range]} (${period.from === period.to ? period.from : `${period.from} to ${period.to}`}, on the business's calendar), whatever has happened to them since.`,
      link: `${DASHBOARD_PATHS.requests}?${queryString({ submittedFrom: period.from, submittedTo: period.to })}`,
    },
    requestsNeedingAction: {
      label: "Requests needing action",
      value: figures.requestsNeedingAction,
      scope: "current",
      definition:
        "Requests waiting on you right now: new (submitted), under review with no quotation out, accepted and not yet made into a job, and declined and not yet closed.",
      link: `${DASHBOARD_PATHS.requests}?${queryString({ status: REQUESTS_NEEDING_ACTION_STATUSES.join(",") })}`,
    },
    jobs: {
      label: "Jobs today",
      value: figures.jobsToday,
      upcomingCount: figures.jobsNext,
      upcomingDays: DASHBOARD_LIMITS.upcomingJobDays,
      scope: "current",
      definition: `Scheduled or in-progress jobs whose appointment starts today, plus the same kind of job starting in the next ${DASHBOARD_LIMITS.upcomingJobDays} days. The list shows both.`,
      link: `${DASHBOARD_PATHS.jobs}?${queryString({ view: "all", status: VISIT_STATUSES.join(","), scheduledFrom: today, scheduledTo: jobsEnd })}`,
    },
    awaitingInvoice: {
      label: "Completed, awaiting invoice",
      value: figures.awaitingInvoice,
      scope: "current",
      definition:
        "Completed jobs that have no invoice yet. A voided invoice does not count: the job is waiting for a new one.",
      link: `${DASHBOARD_PATHS.jobs}?${queryString({ view: "ready-to-invoice" })}`,
    },
    unpaidBalance: {
      label: "Unpaid balance",
      value: figures.unpaidAmount,
      currencyCode,
      invoiceCount: figures.unpaidCount,
      overdueCount: figures.overdueCount,
      overdueAmount: figures.overdueAmount,
      scope: "current",
      definition:
        "What customers still owe: the total minus the payments recorded, added up over issued, part-paid and overdue invoices in the business's currency. Overdue is the part of it past its due date.",
      link: `${DASHBOARD_PATHS.invoices}?${queryString({ status: UNPAID_STATUSES.join(",") })}`,
      overdueLink: `${DASHBOARD_PATHS.invoices}?${queryString({ status: InvoiceStatus.OVERDUE })}`,
    },
  };
}

// ---- Recent activity ------------------------------------------------------------------------------------

/** The page of the record an activity event is about, or `null` when it has none (a payment or the settings). */
export function activityLink(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "SERVICE_REQUEST":
      return `${DASHBOARD_PATHS.requests}/${entityId}`;
    case "QUOTATION":
      return `${DASHBOARD_PATHS.quotations}/${entityId}`;
    case "WORK_ORDER":
      return `${DASHBOARD_PATHS.jobs}/${entityId}`;
    case "INVOICE":
      return `${DASHBOARD_PATHS.invoices}/${entityId}`;
    case "CUSTOMER":
      return `${DASHBOARD_PATHS.customers}/${entityId}`;
    case "TECHNICIAN":
      return `${DASHBOARD_PATHS.technicians}/${entityId}`;
    default:
      return null;
  }
}

export interface ActivityRow {
  id: string;
  action: string;
  summary: string;
  toStatus: string | null;
  entityType: DashboardActivityDto["entityType"];
  entityId: string;
  createdAt: Date;
  actor: { name: string } | null;
}

export function toDashboardActivity(row: ActivityRow): DashboardActivityDto {
  return {
    id: row.id,
    action: row.action,
    summary: row.summary,
    toStatus: row.toStatus,
    actorName: row.actor?.name ?? null,
    entityType: row.entityType,
    createdAt: row.createdAt.toISOString(),
    link: activityLink(row.entityType, row.entityId),
  };
}
