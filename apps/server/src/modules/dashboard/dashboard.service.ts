import {
  addDaysToDateOnly,
  type AdminDashboardSummaryDto,
  ATTENTION_ITEM_TYPES,
  type AttentionItemDto,
  type AttentionItemType,
  balanceDue,
  DASHBOARD_LIMITS,
  type DashboardJobDto,
  dateOnlyInTimeZone,
  InvoiceStatus,
  QuotationStatus,
  ServiceRequestStatus,
  WorkOrderStatus,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { fromDateOnly, toDateOnly } from "../../lib/date-only.js";
import { BUSINESS_SETTINGS_ID } from "../../lib/db.js";
import { serviceUnavailable } from "../../lib/errors.js";
import { syncOverdueInvoicesIfDue } from "../invoices/invoices.service.js";
import { syncExpiredQuotationsIfDue } from "../quotations/quotations.service.js";
import {
  acceptedQuotationItem,
  buildAttention,
  buildKpis,
  businessDay,
  DASHBOARD_PATHS,
  dashboardPeriod,
  expiringQuotationItem,
  jobAwaitingInvoiceItem,
  jobNeedsSchedulingItem,
  jobTodayItem,
  newRequestItem,
  overdueInvoiceItem,
  REQUESTS_NEEDING_ACTION_STATUSES,
  toDashboardActivity,
  UNPAID_STATUSES,
  VISIT_STATUSES,
} from "./dashboard.domain.js";
import type { DashboardSummaryQuery } from "./dashboard.schemas.js";

type DashboardDeps = Pick<AppDeps, "prisma" | "clock">;

const CUSTOMER_NAME = { customer: { select: { user: { select: { name: true } } } } } as const;

/**
 * The jobs that are completed and have no invoice other than a void one (workflow 7.5). The same
 * condition as the jobs list's "ready to invoice" tab, which the KPI links to.
 */
const READY_TO_INVOICE_WHERE: Prisma.WorkOrderWhereInput = {
  status: WorkOrderStatus.COMPLETED,
  invoices: { none: { status: { not: InvoiceStatus.VOID } } },
};

/** Most rows read for each kind of item; inside a kind the oldest (longest waiting) lead. */
const CAP = DASHBOARD_LIMITS.attentionItems;

/**
 * `GET /admin/dashboard/summary` (FR-080 to FR-085): the figures, the queue, the schedule and the
 * activity, all read from the database for this request. Time-based statuses are saved first (D-23),
 * so an expired quotation or an overdue invoice is counted as what it is. Every read is a grouped,
 * aggregated or capped query, never one per row, and they run side by side.
 */
export async function getDashboardSummary(
  deps: DashboardDeps,
  query: DashboardSummaryQuery,
): Promise<AdminDashboardSummaryDto> {
  const { prisma, clock } = deps;
  await Promise.all([syncExpiredQuotationsIfDue(deps), syncOverdueInvoicesIfDue(deps)]);

  const settings = await prisma.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { timeZone: true, currencyCode: true },
  });
  if (settings === null) {
    throw serviceUnavailable("The business settings have not been set up yet.");
  }
  const { timeZone, currencyCode } = settings;

  const now = clock.now();
  const period = dashboardPeriod(query.range, now, timeZone);
  const today = businessDay(dateOnlyInTimeZone(now, timeZone), timeZone);
  const nextDaysEnd = businessDay(
    addDaysToDateOnly(today.date, DASHBOARD_LIMITS.upcomingJobDays),
    timeZone,
  );
  const expiryLimit = fromDateOnly(
    addDaysToDateOnly(today.date, DASHBOARD_LIMITS.quotationExpiryDays),
  );
  const todayDate = fromDateOnly(today.date);

  // ---- The conditions, written once: the KPI counts and the queue's counts share them. ----
  const newRequestsWhere: Prisma.ServiceRequestWhereInput = {
    submittedAt: { gte: period.fromInstant, lt: period.beforeInstant },
  };
  const needingActionWhere: Prisma.ServiceRequestWhereInput = {
    status: { in: [...REQUESTS_NEEDING_ACTION_STATUSES] },
  };
  const visitsToday: Prisma.WorkOrderWhereInput = {
    status: { in: [...VISIT_STATUSES] },
    scheduledStart: { gte: today.start, lt: today.end },
  };
  const visitsNext: Prisma.WorkOrderWhereInput = {
    status: { in: [...VISIT_STATUSES] },
    scheduledStart: { gte: today.end, lt: nextDaysEnd.end },
  };
  const unpaid: Prisma.InvoiceWhereInput = {
    status: { in: [...UNPAID_STATUSES] },
    currencyCode,
  };
  const overdue: Prisma.InvoiceWhereInput = { status: InvoiceStatus.OVERDUE, currencyCode };

  const needsTimeWhere: Prisma.WorkOrderWhereInput = {
    status: { in: [WorkOrderStatus.PENDING_SCHEDULING, WorkOrderStatus.NEEDS_RESCHEDULING] },
  };
  const startsTodayWhere: Prisma.WorkOrderWhereInput = {
    status: WorkOrderStatus.SCHEDULED,
    scheduledStart: { gte: today.start, lt: today.end },
  };
  const expiringWhere: Prisma.QuotationWhereInput = {
    status: QuotationStatus.SENT,
    validUntil: { gte: todayDate, lte: expiryLimit },
  };
  const acceptedWhere: Prisma.ServiceRequestWhereInput = { status: ServiceRequestStatus.ACCEPTED };
  const newWhere: Prisma.ServiceRequestWhereInput = { status: ServiceRequestStatus.SUBMITTED };

  const [
    // KPIs
    newRequests,
    requestsNeedingAction,
    jobsToday,
    jobsNext,
    awaitingInvoice,
    unpaidSums,
    overdueSums,
    totalRequests,
    // The queue: the oldest rows of each kind, and how many there are in all.
    newRows,
    newCount,
    acceptedRows,
    acceptedCount,
    needsTimeRows,
    needsTimeCount,
    startsTodayRows,
    startsTodayCount,
    invoiceRows,
    invoiceCount,
    overdueRows,
    overdueCount,
    expiringRows,
    expiringCount,
    // The schedule and the activity.
    scheduleRows,
    activityRows,
  ] = await Promise.all([
    prisma.serviceRequest.count({ where: newRequestsWhere }),
    prisma.serviceRequest.count({ where: needingActionWhere }),
    prisma.workOrder.count({ where: visitsToday }),
    prisma.workOrder.count({ where: visitsNext }),
    prisma.workOrder.count({ where: READY_TO_INVOICE_WHERE }),
    prisma.invoice.aggregate({
      where: unpaid,
      _sum: { totalAmount: true, amountPaid: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: overdue,
      _sum: { totalAmount: true, amountPaid: true },
      _count: { _all: true },
    }),
    prisma.serviceRequest.count(),

    prisma.serviceRequest.findMany({
      where: newWhere,
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: CAP,
      select: {
        id: true,
        reference: true,
        serviceNameSnapshot: true,
        submittedAt: true,
        ...CUSTOMER_NAME,
      },
    }),
    prisma.serviceRequest.count({ where: newWhere }),
    prisma.serviceRequest.findMany({
      where: acceptedWhere,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: CAP,
      select: {
        id: true,
        reference: true,
        serviceNameSnapshot: true,
        ...CUSTOMER_NAME,
        quotations: {
          where: { status: QuotationStatus.ACCEPTED },
          orderBy: { respondedAt: "desc" },
          take: 1,
          select: { respondedAt: true },
        },
      },
    }),
    prisma.serviceRequest.count({ where: acceptedWhere }),
    prisma.workOrder.findMany({
      where: needsTimeWhere,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: CAP,
      select: {
        id: true,
        reference: true,
        status: true,
        serviceNameSnapshot: true,
        updatedAt: true,
        ...CUSTOMER_NAME,
      },
    }),
    prisma.workOrder.count({ where: needsTimeWhere }),
    prisma.workOrder.findMany({
      where: startsTodayWhere,
      orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
      take: CAP,
      select: {
        id: true,
        reference: true,
        serviceNameSnapshot: true,
        scheduledStart: true,
        technician: { select: { name: true } },
        ...CUSTOMER_NAME,
      },
    }),
    prisma.workOrder.count({ where: startsTodayWhere }),
    prisma.workOrder.findMany({
      where: READY_TO_INVOICE_WHERE,
      orderBy: [{ completedAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: CAP,
      select: {
        id: true,
        reference: true,
        serviceNameSnapshot: true,
        completedAt: true,
        ...CUSTOMER_NAME,
      },
    }),
    prisma.workOrder.count({ where: READY_TO_INVOICE_WHERE }),
    prisma.invoice.findMany({
      where: { status: InvoiceStatus.OVERDUE },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: CAP,
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        totalAmount: true,
        amountPaid: true,
        currencyCode: true,
        ...CUSTOMER_NAME,
      },
    }),
    prisma.invoice.count({ where: { status: InvoiceStatus.OVERDUE } }),
    prisma.quotation.findMany({
      where: expiringWhere,
      orderBy: [{ validUntil: "asc" }, { id: "asc" }],
      take: CAP,
      select: {
        id: true,
        reference: true,
        validUntil: true,
        ...CUSTOMER_NAME,
        request: { select: { serviceNameSnapshot: true } },
      },
    }),
    prisma.quotation.count({ where: expiringWhere }),

    prisma.workOrder.findMany({
      where: {
        status: { in: [...VISIT_STATUSES] },
        scheduledStart: { not: null },
        // A visit still to come or one that has not finished: a job in progress stays until it ends.
        scheduledEnd: { gt: now },
      },
      orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
      take: DASHBOARD_LIMITS.upcomingJobs,
      select: {
        id: true,
        reference: true,
        status: true,
        serviceNameSnapshot: true,
        scheduledStart: true,
        scheduledEnd: true,
        technician: { select: { name: true } },
        ...CUSTOMER_NAME,
      },
    }),
    prisma.activityEvent.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_LIMITS.recentEvents,
      include: { actor: { select: { name: true } } },
    }),
  ]);

  // ---- Money: totals minus payments, in decimal arithmetic. ----
  const balanceOf = (sums: {
    totalAmount: { toString(): string } | null;
    amountPaid: { toString(): string } | null;
  }): string => balanceDue(sums.totalAmount?.toString() ?? "0", sums.amountPaid?.toString() ?? "0");

  // ---- The queue ----
  const itemsByType: Record<AttentionItemType, AttentionItemDto[]> = {
    OVERDUE_INVOICE: overdueRows.map((row) =>
      overdueInvoiceItem(
        {
          id: row.id,
          invoiceNumber: row.invoiceNumber,
          customerName: row.customer.user.name,
          // An overdue invoice has been issued, so it has a due date; the column is nullable for drafts.
          dueDate: row.dueDate === null ? today.date : toDateOnly(row.dueDate),
          totalAmount: row.totalAmount.toFixed(2),
          amountPaid: row.amountPaid.toFixed(2),
          currencyCode: row.currencyCode,
        },
        today.date,
      ),
    ),
    JOB_TODAY_NOT_STARTED: startsTodayRows.flatMap((row) =>
      row.scheduledStart === null
        ? []
        : [
            jobTodayItem(
              {
                id: row.id,
                reference: row.reference,
                customerName: row.customer.user.name,
                serviceName: row.serviceNameSnapshot,
                scheduledStart: row.scheduledStart,
                technicianName: row.technician?.name ?? null,
              },
              now,
              timeZone,
            ),
          ],
    ),
    NEW_REQUEST: newRows.map((row) =>
      newRequestItem(
        {
          id: row.id,
          reference: row.reference,
          customerName: row.customer.user.name,
          serviceName: row.serviceNameSnapshot,
          submittedAt: row.submittedAt,
        },
        now,
      ),
    ),
    ACCEPTED_QUOTATION: acceptedRows.map((row) =>
      acceptedQuotationItem(
        {
          id: row.id,
          reference: row.reference,
          customerName: row.customer.user.name,
          serviceName: row.serviceNameSnapshot,
          acceptedAt: row.quotations[0]?.respondedAt ?? null,
        },
        now,
      ),
    ),
    JOB_NEEDS_SCHEDULING: needsTimeRows.flatMap((row) =>
      row.status === WorkOrderStatus.PENDING_SCHEDULING ||
      row.status === WorkOrderStatus.NEEDS_RESCHEDULING
        ? [
            jobNeedsSchedulingItem(
              {
                id: row.id,
                reference: row.reference,
                status: row.status,
                customerName: row.customer.user.name,
                serviceName: row.serviceNameSnapshot,
                updatedAt: row.updatedAt,
              },
              now,
            ),
          ]
        : [],
    ),
    JOB_AWAITING_INVOICE: invoiceRows.map((row) =>
      jobAwaitingInvoiceItem(
        {
          id: row.id,
          reference: row.reference,
          customerName: row.customer.user.name,
          serviceName: row.serviceNameSnapshot,
          completedAt: row.completedAt,
        },
        now,
      ),
    ),
    QUOTATION_EXPIRING: expiringRows.map((row) =>
      expiringQuotationItem(
        {
          id: row.id,
          reference: row.reference,
          customerName: row.customer.user.name,
          serviceName: row.request.serviceNameSnapshot,
          validUntil: toDateOnly(row.validUntil),
        },
        today.date,
      ),
    ),
  };
  const counts: Record<AttentionItemType, number> = {
    OVERDUE_INVOICE: overdueCount,
    JOB_TODAY_NOT_STARTED: startsTodayCount,
    NEW_REQUEST: newCount,
    ACCEPTED_QUOTATION: acceptedCount,
    JOB_NEEDS_SCHEDULING: needsTimeCount,
    JOB_AWAITING_INVOICE: invoiceCount,
    QUOTATION_EXPIRING: expiringCount,
  };
  // Every kind has a list and a count: a kind added to the type cannot be forgotten here.
  for (const type of ATTENTION_ITEM_TYPES) {
    if (itemsByType[type].length > counts[type]) {
      throw new Error(`The dashboard read more ${type} items than exist.`);
    }
  }

  const upcomingSchedule: DashboardJobDto[] = scheduleRows.flatMap((row) =>
    row.scheduledStart === null || row.scheduledEnd === null
      ? []
      : [
          {
            id: row.id,
            reference: row.reference,
            scheduledStart: row.scheduledStart.toISOString(),
            scheduledEnd: row.scheduledEnd.toISOString(),
            status: row.status,
            customerName: row.customer.user.name,
            serviceName: row.serviceNameSnapshot,
            technicianName: row.technician?.name ?? null,
            link: `${DASHBOARD_PATHS.jobs}/${row.id}`,
          },
        ],
  );

  return {
    period: { range: period.range, from: period.from, to: period.to },
    today: today.date,
    timeZone,
    currencyCode,
    generatedAt: now.toISOString(),
    isFresh: totalRequests === 0,
    kpis: buildKpis(
      {
        newRequests,
        requestsNeedingAction,
        jobsToday,
        jobsNext,
        awaitingInvoice,
        unpaidAmount: balanceOf(unpaidSums._sum),
        unpaidCount: unpaidSums._count._all,
        overdueAmount: balanceOf(overdueSums._sum),
        overdueCount: overdueSums._count._all,
      },
      period,
      today.date,
      currencyCode,
    ),
    needsAttention: buildAttention(itemsByType, counts),
    upcomingSchedule,
    recentActivity: activityRows.map(toDashboardActivity),
  };
}
