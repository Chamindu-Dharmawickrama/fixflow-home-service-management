import type { ActivityEntityType } from "./enums.js";
import type { CustomerInvoiceListItemDto } from "./invoices.js";
import type { CustomerQuotationListItemDto } from "./quotations.js";
import type { CustomerRequestListItemDto } from "./requests.js";
import type { CustomerWorkOrderListItemDto } from "./work-orders.js";

/**
 * The admin dashboard (FR-080 to FR-085, spec §9.2) and the customer's overview (spec §9.3). Every
 * figure is computed from the database on the server, with day boundaries on the business's calendar
 * (D-42); these types are the wire shapes.
 */

// ---- Ranges ----------------------------------------------------------------------------------

/** The periods the dashboard can be asked for. Only the period-dependent metrics change with it. */
export const DASHBOARD_RANGES = ["today", "7d", "30d"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = "7d";

export const DASHBOARD_RANGE_LABELS: Readonly<Record<DashboardRange, string>> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
};

/** How many calendar days each range covers, today included. */
export const DASHBOARD_RANGE_DAYS: Readonly<Record<DashboardRange, number>> = {
  today: 1,
  "7d": 7,
  "30d": 30,
};

export function isDashboardRange(value: unknown): value is DashboardRange {
  return DASHBOARD_RANGES.some((range) => range === value);
}

/** What the dashboard shows beside the queue: how many of each, and how far ahead the schedule looks. */
export const DASHBOARD_LIMITS = {
  /** Most items in the needs-attention queue. */
  attentionItems: 15,
  /** Jobs in the upcoming schedule. */
  upcomingJobs: 8,
  /** Events in the recent activity list. */
  recentEvents: 10,
  /** A quotation counts as expiring when its last valid day is at most this many days away. */
  quotationExpiryDays: 2,
  /** The jobs KPI also counts the visits of this many days after today. */
  upcomingJobDays: 7,
} as const;

// ---- KPIs --------------------------------------------------------------------------------------

/** Whether a figure follows the chosen range or is the state of the business right now. */
export type KpiScope = "range" | "current";

interface KpiBase {
  label: string;
  /** Plain-language definition of exactly what the query counts (FR-085). */
  definition: string;
  /** A list address (a path with a query string) whose filters reproduce the figure. */
  link: string;
  scope: KpiScope;
}

export interface CountKpiDto extends KpiBase {
  value: number;
}

export interface JobsKpiDto extends KpiBase {
  /** Scheduled or in-progress jobs whose appointment starts today. */
  value: number;
  /** The same kind of job starting on each of the next days (after today). */
  upcomingCount: number;
  /** The whole window, today and the days after, which is what the link lists. */
  upcomingDays: number;
}

export interface UnpaidBalanceKpiDto extends KpiBase {
  /** A decimal string, in the business's currency. */
  value: string;
  currencyCode: string;
  overdueCount: number;
  overdueAmount: string;
  overdueLink: string;
  /** How many invoices make up the balance. */
  invoiceCount: number;
}

export interface DashboardKpisDto {
  newRequests: CountKpiDto;
  requestsNeedingAction: CountKpiDto;
  jobs: JobsKpiDto;
  awaitingInvoice: CountKpiDto;
  unpaidBalance: UnpaidBalanceKpiDto;
}

// ---- Needs attention ---------------------------------------------------------------------------

/** The kinds of item in the queue, most urgent first: the order is the priority. */
export const ATTENTION_ITEM_TYPES = [
  "OVERDUE_INVOICE",
  "JOB_TODAY_NOT_STARTED",
  "NEW_REQUEST",
  "ACCEPTED_QUOTATION",
  "JOB_NEEDS_SCHEDULING",
  "JOB_AWAITING_INVOICE",
  "QUOTATION_EXPIRING",
] as const;
export type AttentionItemType = (typeof ATTENTION_ITEM_TYPES)[number];

export const ATTENTION_TYPE_LABELS: Readonly<Record<AttentionItemType, string>> = {
  OVERDUE_INVOICE: "Overdue invoice",
  JOB_TODAY_NOT_STARTED: "Job today, not started",
  NEW_REQUEST: "New request",
  ACCEPTED_QUOTATION: "Accepted quotation",
  JOB_NEEDS_SCHEDULING: "Needs scheduling",
  JOB_AWAITING_INVOICE: "Ready to invoice",
  QUOTATION_EXPIRING: "Quotation expiring",
};

export interface AttentionItemDto {
  /** Unique within the queue: the type and the record's id. */
  id: string;
  type: AttentionItemType;
  /** The reference and the customer's name. */
  title: string;
  /** What is going on, in words: "AC repair · submitted 2 h ago". */
  context: string;
  /** The page where the action is taken, a path inside the app. */
  link: string;
  /** The primary action, as a button label. */
  actionLabel: string;
  /** An amount the item is about, for an overdue invoice. */
  amount: { amount: string; currencyCode: string } | null;
  /** ISO 8601 instant the item has waited since, when it has one. */
  since: string | null;
}

export interface DashboardAttentionDto {
  /** At most {@link DASHBOARD_LIMITS.attentionItems}, most urgent first. */
  items: AttentionItemDto[];
  /** How many items exist in all, so the queue can say how many are not shown. */
  totalItems: number;
  counts: Record<AttentionItemType, number>;
}

// ---- Schedule and activity ---------------------------------------------------------------------

export interface DashboardJobDto {
  id: string;
  reference: string;
  /** ISO 8601 instants. */
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  /** The customer's name only. */
  customerName: string;
  serviceName: string;
  technicianName: string | null;
  /** The page of the job, a path inside the app. */
  link: string;
}

export interface DashboardActivityDto {
  id: string;
  action: string;
  summary: string;
  toStatus: string | null;
  /** Who acted; `null` means the system did. */
  actorName: string | null;
  entityType: ActivityEntityType;
  /** ISO 8601 instant. */
  createdAt: string;
  /** The record's page, when it has one. */
  link: string | null;
}

// ---- The summary ---------------------------------------------------------------------------------

export interface DashboardPeriodDto {
  range: DashboardRange;
  /** First and last day of the period on the business's calendar, `YYYY-MM-DD`, both inclusive. */
  from: string;
  to: string;
}

export interface AdminDashboardSummaryDto {
  period: DashboardPeriodDto;
  /** Today on the business's calendar, `YYYY-MM-DD`. */
  today: string;
  timeZone: string;
  currencyCode: string;
  /** ISO 8601 instant the figures were computed. */
  generatedAt: string;
  /** True for a business with no request at all: the page shows how to get the first one. */
  isFresh: boolean;
  kpis: DashboardKpisDto;
  needsAttention: DashboardAttentionDto;
  upcomingSchedule: DashboardJobDto[];
  recentActivity: DashboardActivityDto[];
}

// ---- The customer's overview ---------------------------------------------------------------------

export interface OverviewSectionDto<Item> {
  items: Item[];
  /** All the customer has of this kind, so the screen can link to the rest. */
  totalItems: number;
}

export const CUSTOMER_OVERVIEW_LIMITS = {
  awaitingDecision: 5,
  outstandingInvoices: 3,
  upcomingVisits: 3,
  recentRequests: 3,
} as const;

/**
 * `GET /customers/me/overview`: what the signed-in customer has to do and what is coming up. Only
 * their own records, in the customer's shapes (D-41).
 */
export interface CustomerOverviewDto {
  actionRequired: {
    /** Sent quotations that have not been answered or run out, soonest to run out first. */
    quotations: OverviewSectionDto<CustomerQuotationListItemDto>;
    /** Invoices that still owe money, soonest due first. */
    invoices: OverviewSectionDto<CustomerInvoiceListItemDto>;
  };
  upcomingVisits: OverviewSectionDto<CustomerWorkOrderListItemDto>;
  /** The latest requests, newest first. */
  recentRequests: OverviewSectionDto<CustomerRequestListItemDto>;
  counts: {
    /** Quotations to answer plus invoices to pay. */
    actionRequired: number;
    upcomingVisits: number;
    requests: number;
  };
}

// ---- CSV exports -----------------------------------------------------------------------------------

export const EXPORT_KINDS = ["requests", "jobs", "invoices"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
