import type { AdminDashboardSummaryDto, AttentionItemDto } from "@fixflow/shared";

/** Shared test data for the dashboard (T23). All of it is fictional. */

export const DASH_TIME_ZONE = "America/New_York";
/** 10:00 in New York on Thursday 5 March 2026. */
export const DASH_NOW = "2026-03-05T15:00:00.000Z";

export function attentionItem(overrides: Partial<AttentionItemDto> = {}): AttentionItemDto {
  return {
    id: "NEW_REQUEST:r1",
    type: "NEW_REQUEST",
    title: "FF-2026-00012 · Alex Morgan",
    context: "AC Repair · submitted 2 h ago",
    link: "/app/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    actionLabel: "Review request",
    amount: null,
    since: "2026-03-05T13:00:00.000Z",
    ...overrides,
  };
}

/** A busy day: every figure non-zero, a queue of three, a schedule of two and two events. */
export function dashboardSummary(
  overrides: Partial<AdminDashboardSummaryDto> = {},
): AdminDashboardSummaryDto {
  return {
    period: { range: "7d", from: "2026-02-27", to: "2026-03-05" },
    today: "2026-03-05",
    timeZone: DASH_TIME_ZONE,
    currencyCode: "USD",
    generatedAt: DASH_NOW,
    isFresh: false,
    kpis: {
      newRequests: {
        label: "New requests",
        value: 7,
        scope: "range",
        definition: "Service requests submitted in the last 7 days.",
        link: "/app/requests?submittedFrom=2026-02-27&submittedTo=2026-03-05",
      },
      requestsNeedingAction: {
        label: "Requests needing action",
        value: 6,
        scope: "current",
        definition: "Requests waiting on you right now.",
        link: "/app/requests?status=SUBMITTED,UNDER_REVIEW,ACCEPTED,DECLINED",
      },
      jobs: {
        label: "Jobs today",
        value: 3,
        upcomingCount: 2,
        upcomingDays: 7,
        scope: "current",
        definition: "Scheduled or in-progress jobs that start today.",
        link: "/app/jobs?view=all&status=SCHEDULED,IN_PROGRESS&scheduledFrom=2026-03-05&scheduledTo=2026-03-12",
      },
      awaitingInvoice: {
        label: "Completed, awaiting invoice",
        value: 2,
        scope: "current",
        definition: "Completed jobs that have no invoice yet.",
        link: "/app/jobs?view=ready-to-invoice",
      },
      unpaidBalance: {
        label: "Unpaid balance",
        value: "690.00",
        currencyCode: "USD",
        invoiceCount: 5,
        overdueCount: 2,
        overdueAmount: "180.00",
        scope: "current",
        definition: "What customers still owe.",
        link: "/app/invoices?status=ISSUED,PARTIALLY_PAID,OVERDUE",
        overdueLink: "/app/invoices?status=OVERDUE",
      },
    },
    needsAttention: {
      items: [
        attentionItem({
          id: "OVERDUE_INVOICE:i1",
          type: "OVERDUE_INVOICE",
          title: "INV-2026-00007 · Priya Shah",
          context: "overdue by 6 days",
          link: "/app/invoices/7d3c9b1a-2e4f-4a6b-8c5d-1f0e9d8c7b6a",
          actionLabel: "Open invoice",
          amount: { amount: "100.00", currencyCode: "USD" },
          since: null,
        }),
        attentionItem(),
        attentionItem({
          id: "JOB_NEEDS_SCHEDULING:j1",
          type: "JOB_NEEDS_SCHEDULING",
          title: "JOB-2026-00007 · Alex Morgan",
          context: "AC Repair · needs a time · 2 days ago",
          link: "/app/jobs/b4a1f5c2-3d6e-4c7a-9b8d-2e1f0a9b8c7d?schedule=1",
          actionLabel: "Schedule",
        }),
      ],
      totalItems: 3,
      counts: {
        OVERDUE_INVOICE: 1,
        JOB_TODAY_NOT_STARTED: 0,
        NEW_REQUEST: 1,
        ACCEPTED_QUOTATION: 0,
        JOB_NEEDS_SCHEDULING: 1,
        JOB_AWAITING_INVOICE: 0,
        QUOTATION_EXPIRING: 0,
      },
    },
    upcomingSchedule: [
      {
        id: "b4a1f5c2-3d6e-4c7a-9b8d-2e1f0a9b8c7d",
        reference: "JOB-2026-00007",
        scheduledStart: "2026-03-05T20:00:00.000Z",
        scheduledEnd: "2026-03-05T21:00:00.000Z",
        status: "SCHEDULED",
        customerName: "Alex Morgan",
        serviceName: "AC Repair",
        technicianName: "Jordan Lee",
        link: "/app/jobs/b4a1f5c2-3d6e-4c7a-9b8d-2e1f0a9b8c7d",
      },
      {
        id: "c5b2a6d3-4e7f-4d8b-8c9e-3f2a1b0c9d8e",
        reference: "JOB-2026-00008",
        scheduledStart: "2026-03-06T14:00:00.000Z",
        scheduledEnd: "2026-03-06T15:00:00.000Z",
        status: "SCHEDULED",
        customerName: "Priya Shah",
        serviceName: "Gutter Cleaning",
        technicianName: null,
        link: "/app/jobs/c5b2a6d3-4e7f-4d8b-8c9e-3f2a1b0c9d8e",
      },
    ],
    recentActivity: [
      {
        id: "e1",
        action: "request.submitted",
        summary: "Alex Morgan sent request FF-2026-00012",
        toStatus: "SUBMITTED",
        actorName: "Alex Morgan",
        entityType: "SERVICE_REQUEST",
        createdAt: "2026-03-05T13:00:00.000Z",
        link: "/app/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
      },
      {
        id: "e2",
        action: "quotation.expired",
        summary: "Quotation QT-2026-00003 expired",
        toStatus: "EXPIRED",
        actorName: null,
        entityType: "QUOTATION",
        createdAt: "2026-03-05T05:00:00.000Z",
        link: null,
      },
    ],
    ...overrides,
  };
}
