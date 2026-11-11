import { ATTENTION_ITEM_TYPES, type AttentionItemType, isSafeAppPath } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  acceptedQuotationItem,
  activityLink,
  buildAttention,
  buildKpis,
  businessDay,
  DASHBOARD_PATHS,
  dashboardPeriod,
  expiringQuotationItem,
  expiryText,
  jobAwaitingInvoiceItem,
  jobNeedsSchedulingItem,
  jobTodayItem,
  newRequestItem,
  overdueInvoiceItem,
  overdueText,
  relativeAgo,
} from "./dashboard.domain.js";

const NY = "America/New_York";
const at = (value: string) => new Date(value);

describe("dashboardPeriod (D-42)", () => {
  // 12:00 in New York on 5 March 2026 (EST, UTC-5).
  const now = at("2026-03-05T17:00:00Z");

  it("today is the one calendar day, from local midnight to the next", () => {
    const period = dashboardPeriod("today", now, NY);
    expect([period.from, period.to]).toEqual(["2026-03-05", "2026-03-05"]);
    expect(period.fromInstant.toISOString()).toBe("2026-03-05T05:00:00.000Z");
    expect(period.beforeInstant.toISOString()).toBe("2026-03-06T05:00:00.000Z");
  });

  it("7 days is the last seven calendar days, today included", () => {
    const period = dashboardPeriod("7d", now, NY);
    expect([period.from, period.to]).toEqual(["2026-02-27", "2026-03-05"]);
    expect(period.fromInstant.toISOString()).toBe("2026-02-27T05:00:00.000Z");
  });

  it("30 days is the last thirty calendar days, today included", () => {
    const period = dashboardPeriod("30d", now, NY);
    expect([period.from, period.to]).toEqual(["2026-02-04", "2026-03-05"]);
  });

  it("takes today from the business's calendar, not UTC: 23:30 local is still today", () => {
    // 04:30 UTC on 6 March is 23:30 on 5 March in New York.
    expect(dashboardPeriod("today", at("2026-03-06T04:30:00Z"), NY).to).toBe("2026-03-05");
    // And 00:30 local on the 6th is already the next day.
    expect(dashboardPeriod("today", at("2026-03-06T05:30:00Z"), NY).to).toBe("2026-03-06");
  });

  it("is made of whole calendar days across the spring clock change (8 March 2026)", () => {
    const period = dashboardPeriod("7d", at("2026-03-10T16:00:00Z"), NY);
    expect(period.from).toBe("2026-03-04");
    // 4 March starts at 05:00 UTC (EST); the day after 10 March starts at 04:00 UTC (EDT).
    expect(period.fromInstant.toISOString()).toBe("2026-03-04T05:00:00.000Z");
    expect(period.beforeInstant.toISOString()).toBe("2026-03-11T04:00:00.000Z");
  });

  it("is made of whole calendar days across the autumn clock change (1 November 2026)", () => {
    const period = dashboardPeriod("today", at("2026-11-01T17:00:00Z"), NY);
    expect(period.fromInstant.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    // The day is 25 hours long: the next one starts at 05:00 UTC.
    expect(period.beforeInstant.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("works in a zone ahead of UTC", () => {
    const period = dashboardPeriod("today", at("2026-03-05T16:30:00Z"), "Asia/Tokyo");
    // 01:30 on 6 March in Tokyo.
    expect(period.to).toBe("2026-03-06");
    expect(period.fromInstant.toISOString()).toBe("2026-03-05T15:00:00.000Z");
  });
});

describe("businessDay", () => {
  it("bounds a day on the business's calendar", () => {
    const day = businessDay("2026-03-08", NY);
    expect(day.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    // The clocks went forward that night: the day is 23 hours long.
    expect(day.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("relativeAgo", () => {
  const now = at("2026-03-05T17:00:00Z");
  it.each([
    ["2026-03-05T17:00:00Z", "just now"],
    ["2026-03-05T17:00:30Z", "just now"],
    ["2026-03-05T16:59:30Z", "just now"],
    ["2026-03-05T16:58:00Z", "2 min ago"],
    ["2026-03-05T16:01:00Z", "59 min ago"],
    ["2026-03-05T16:00:00Z", "1 h ago"],
    ["2026-03-05T15:00:00Z", "2 h ago"],
    ["2026-03-05T14:30:00Z", "2 h ago"],
    ["2026-03-04T18:00:00Z", "23 h ago"],
    ["2026-03-04T17:00:00Z", "1 day ago"],
    ["2026-03-02T17:00:00Z", "3 days ago"],
    ["2026-02-05T17:00:00Z", "28 days ago"],
  ])("%s reads %s", (then, text) => {
    expect(relativeAgo(at(then), now)).toBe(text);
  });
});

describe("overdueText and expiryText", () => {
  it("says days in the singular and the plural", () => {
    expect(overdueText(1)).toBe("overdue by 1 day");
    expect(overdueText(6)).toBe("overdue by 6 days");
    expect(overdueText(0)).toBe("overdue by 1 day");
  });

  it("says when a quotation runs out", () => {
    expect(expiryText(0)).toBe("expires today");
    expect(expiryText(1)).toBe("expires tomorrow");
    expect(expiryText(2)).toBe("expires in 2 days");
  });
});

describe("attention items", () => {
  const now = at("2026-03-05T17:00:00Z");
  const base = { id: "abc", reference: "FF-2026-00001", customerName: "Alex Morgan" };

  it("a new request links to the request and says how long ago it came", () => {
    const item = newRequestItem(
      { ...base, serviceName: "AC Repair", submittedAt: at("2026-03-05T15:00:00Z") },
      now,
    );
    expect(item).toMatchObject({
      id: "NEW_REQUEST:abc",
      type: "NEW_REQUEST",
      title: "FF-2026-00001 · Alex Morgan",
      context: "AC Repair · submitted 2 h ago",
      link: "/app/requests/abc",
      actionLabel: "Review request",
      amount: null,
      since: "2026-03-05T15:00:00.000Z",
    });
  });

  it("an accepted quotation leads to the request, where the job is made", () => {
    const item = acceptedQuotationItem(
      { ...base, serviceName: "AC Repair", acceptedAt: at("2026-03-04T17:00:00Z") },
      now,
    );
    expect(item.link).toBe("/app/requests/abc");
    expect(item.actionLabel).toBe("Create job");
    expect(item.context).toBe("AC Repair · quotation accepted 1 day ago");
    expect(
      acceptedQuotationItem({ ...base, serviceName: "AC Repair", acceptedAt: null }, now).context,
    ).toBe("AC Repair · quotation accepted");
  });

  it("a job that needs a time opens the scheduling dialog", () => {
    const pending = jobNeedsSchedulingItem(
      {
        ...base,
        serviceName: "AC Repair",
        status: "PENDING_SCHEDULING",
        updatedAt: at("2026-03-03T17:00:00Z"),
      },
      now,
    );
    expect(pending.link).toBe("/app/jobs/abc?schedule=1");
    expect(pending.actionLabel).toBe("Schedule");
    expect(pending.context).toBe("AC Repair · needs a time · 2 days ago");

    const again = jobNeedsSchedulingItem(
      {
        ...base,
        serviceName: "AC Repair",
        status: "NEEDS_RESCHEDULING",
        updatedAt: at("2026-03-05T16:00:00Z"),
      },
      now,
    );
    expect(again.actionLabel).toBe("Reschedule");
    expect(again.context).toBe("AC Repair · needs a new time · 1 h ago");
  });

  it("a visit today reads its time on the business's clocks", () => {
    const upcoming = jobTodayItem(
      {
        ...base,
        serviceName: "AC Repair",
        scheduledStart: at("2026-03-05T20:00:00Z"),
        technicianName: "Jordan Lee",
      },
      now,
      NY,
    );
    expect(upcoming.context).toBe("AC Repair · starts at 15:00 today · Jordan Lee");

    const missed = jobTodayItem(
      {
        ...base,
        serviceName: "AC Repair",
        scheduledStart: at("2026-03-05T14:00:00Z"),
        technicianName: null,
      },
      now,
      NY,
    );
    expect(missed.context).toBe("AC Repair · was due to start at 09:00");
    expect(missed.link).toBe("/app/jobs/abc");
  });

  it("a finished job asks for an invoice", () => {
    const item = jobAwaitingInvoiceItem(
      { ...base, serviceName: "AC Repair", completedAt: at("2026-03-03T17:00:00Z") },
      now,
    );
    expect(item.actionLabel).toBe("Create invoice");
    expect(item.context).toBe("AC Repair · completed 2 days ago");
  });

  it("an overdue invoice says how many days and carries the balance, not the total", () => {
    const item = overdueInvoiceItem(
      {
        id: "inv",
        invoiceNumber: "INV-2026-00007",
        customerName: "Priya Shah",
        dueDate: "2026-02-27",
        totalAmount: "120.00",
        amountPaid: "20.00",
        currencyCode: "USD",
      },
      "2026-03-05",
    );
    expect(item).toMatchObject({
      title: "INV-2026-00007 · Priya Shah",
      context: "overdue by 6 days",
      link: "/app/invoices/inv",
      amount: { amount: "100.00", currencyCode: "USD" },
    });
  });

  it("a quotation about to run out says when", () => {
    const item = expiringQuotationItem(
      { ...base, serviceName: "AC Repair", validUntil: "2026-03-06" },
      "2026-03-05",
    );
    expect(item.context).toBe("AC Repair · expires tomorrow");
    expect(item.link).toBe("/app/quotations/abc");
  });

  it("every path the dashboard links through is a safe app path", () => {
    for (const path of Object.values(DASHBOARD_PATHS)) {
      expect(isSafeAppPath(path)).toBe(true);
    }
  });
});

describe("buildAttention (FR-081)", () => {
  const item = (type: AttentionItemType, n: number) => ({
    id: `${type}:${n}`,
    type,
    title: "t",
    context: "c",
    link: "/app/requests",
    actionLabel: "Open",
    amount: null,
    since: null,
  });
  const byType = <T>(make: () => T): Record<AttentionItemType, T> => ({
    OVERDUE_INVOICE: make(),
    JOB_TODAY_NOT_STARTED: make(),
    NEW_REQUEST: make(),
    ACCEPTED_QUOTATION: make(),
    JOB_NEEDS_SCHEDULING: make(),
    JOB_AWAITING_INVOICE: make(),
    QUOTATION_EXPIRING: make(),
  });
  const empty = byType((): ReturnType<typeof item>[] => []);
  const zero = byType(() => 0);

  it("orders by priority, then keeps the order inside a kind", () => {
    const result = buildAttention(
      {
        ...empty,
        QUOTATION_EXPIRING: [item("QUOTATION_EXPIRING", 1)],
        NEW_REQUEST: [item("NEW_REQUEST", 1), item("NEW_REQUEST", 2)],
        OVERDUE_INVOICE: [item("OVERDUE_INVOICE", 1)],
      },
      { ...zero, QUOTATION_EXPIRING: 1, NEW_REQUEST: 2, OVERDUE_INVOICE: 1 },
    );
    expect(result.items.map((entry) => entry.id)).toEqual([
      "OVERDUE_INVOICE:1",
      "NEW_REQUEST:1",
      "NEW_REQUEST:2",
      "QUOTATION_EXPIRING:1",
    ]);
    expect(result.totalItems).toBe(4);
  });

  it("puts overdue money first and the expiring quotation last", () => {
    expect(ATTENTION_ITEM_TYPES[0]).toBe("OVERDUE_INVOICE");
    expect(ATTENTION_ITEM_TYPES[ATTENTION_ITEM_TYPES.length - 1]).toBe("QUOTATION_EXPIRING");
  });

  it("caps the queue at 15 and still reports how many exist", () => {
    const many = Array.from({ length: 20 }, (_, n) => item("NEW_REQUEST", n));
    const result = buildAttention({ ...empty, NEW_REQUEST: many }, { ...zero, NEW_REQUEST: 40 });
    expect(result.items).toHaveLength(15);
    expect(result.totalItems).toBe(40);
    expect(result.counts.NEW_REQUEST).toBe(40);
  });

  it("keeps the first item of every kind, so a flood of one cannot hide the others", () => {
    const many = Array.from({ length: 30 }, (_, n) => item("NEW_REQUEST", n));
    const result = buildAttention(
      {
        ...empty,
        NEW_REQUEST: many,
        ACCEPTED_QUOTATION: [item("ACCEPTED_QUOTATION", 1), item("ACCEPTED_QUOTATION", 2)],
        QUOTATION_EXPIRING: [item("QUOTATION_EXPIRING", 1)],
        OVERDUE_INVOICE: [item("OVERDUE_INVOICE", 1)],
      },
      {
        ...zero,
        NEW_REQUEST: 30,
        ACCEPTED_QUOTATION: 2,
        QUOTATION_EXPIRING: 1,
        OVERDUE_INVOICE: 1,
      },
    );
    const ids = result.items.map((entry) => entry.id);
    expect(ids).toHaveLength(15);
    // Every kind that has work is there, and the order is still the priority order.
    expect(ids).toContain("OVERDUE_INVOICE:1");
    expect(ids).toContain("ACCEPTED_QUOTATION:1");
    expect(ids).toContain("QUOTATION_EXPIRING:1");
    expect(ids[0]).toBe("OVERDUE_INVOICE:1");
    expect(ids.at(-1)).toBe("QUOTATION_EXPIRING:1");
    // The places left over go to the most urgent items in priority order: here the new requests.
    expect(ids.filter((id) => id.startsWith("NEW_REQUEST")).slice(0, 3)).toEqual([
      "NEW_REQUEST:0",
      "NEW_REQUEST:1",
      "NEW_REQUEST:2",
    ]);
  });

  it("an empty queue is empty", () => {
    expect(buildAttention(empty, zero)).toEqual({ items: [], totalItems: 0, counts: zero });
  });
});

describe("buildKpis (FR-080, FR-085)", () => {
  const figures = {
    newRequests: 3,
    requestsNeedingAction: 6,
    jobsToday: 2,
    jobsNext: 4,
    awaitingInvoice: 1,
    unpaidAmount: "630.00",
    unpaidCount: 4,
    overdueAmount: "180.00",
    overdueCount: 2,
  };
  const period = { range: "7d", from: "2026-02-27", to: "2026-03-05" } as const;
  const kpis = buildKpis(figures, period, "2026-03-05", "USD");

  it("carries the values it is given", () => {
    expect(kpis.newRequests.value).toBe(3);
    expect(kpis.requestsNeedingAction.value).toBe(6);
    expect(kpis.jobs).toMatchObject({ value: 2, upcomingCount: 4, upcomingDays: 7 });
    expect(kpis.awaitingInvoice.value).toBe(1);
    expect(kpis.unpaidBalance).toMatchObject({
      value: "630.00",
      currencyCode: "USD",
      overdueCount: 2,
      overdueAmount: "180.00",
      invoiceCount: 4,
    });
  });

  it("only the first follows the range; the others say they are current", () => {
    expect(kpis.newRequests.scope).toBe("range");
    for (const kpi of [
      kpis.requestsNeedingAction,
      kpis.jobs,
      kpis.awaitingInvoice,
      kpis.unpaidBalance,
    ]) {
      expect(kpi.scope).toBe("current");
    }
  });

  it("gives every KPI a definition and a link that is a safe app path", () => {
    for (const kpi of [
      kpis.newRequests,
      kpis.requestsNeedingAction,
      kpis.jobs,
      kpis.awaitingInvoice,
      kpis.unpaidBalance,
    ]) {
      expect(kpi.definition.length).toBeGreaterThan(20);
      expect(isSafeAppPath(kpi.link)).toBe(true);
    }
    expect(isSafeAppPath(kpis.unpaidBalance.overdueLink)).toBe(true);
  });

  it("links to lists whose filters reproduce each figure", () => {
    expect(kpis.newRequests.link).toBe(
      "/app/requests?submittedFrom=2026-02-27&submittedTo=2026-03-05",
    );
    expect(kpis.requestsNeedingAction.link).toBe(
      "/app/requests?status=SUBMITTED,UNDER_REVIEW,ACCEPTED,DECLINED",
    );
    expect(kpis.jobs.link).toBe(
      "/app/jobs?view=all&status=SCHEDULED,IN_PROGRESS&scheduledFrom=2026-03-05&scheduledTo=2026-03-12",
    );
    expect(kpis.awaitingInvoice.link).toBe("/app/jobs?view=ready-to-invoice");
    expect(kpis.unpaidBalance.link).toBe("/app/invoices?status=ISSUED,PARTIALLY_PAID,OVERDUE");
    expect(kpis.unpaidBalance.overdueLink).toBe("/app/invoices?status=OVERDUE");
  });

  it("describes the period in the new-requests definition", () => {
    expect(kpis.newRequests.definition).toContain("in the last 7 days");
    expect(kpis.newRequests.definition).toContain("2026-02-27 to 2026-03-05");
    const today = buildKpis(
      figures,
      { range: "today", from: "2026-03-05", to: "2026-03-05" },
      "2026-03-05",
      "USD",
    );
    expect(today.newRequests.definition).toContain("submitted today (2026-03-05");
  });
});

describe("activityLink", () => {
  it("links to the page of the record, and to none for a payment or the settings", () => {
    expect(activityLink("SERVICE_REQUEST", "r1")).toBe("/app/requests/r1");
    expect(activityLink("QUOTATION", "q1")).toBe("/app/quotations/q1");
    expect(activityLink("WORK_ORDER", "j1")).toBe("/app/jobs/j1");
    expect(activityLink("INVOICE", "i1")).toBe("/app/invoices/i1");
    expect(activityLink("CUSTOMER", "c1")).toBe("/app/customers/c1");
    expect(activityLink("TECHNICIAN", "t1")).toBe("/app/technicians/t1");
    expect(activityLink("PAYMENT", "p1")).toBeNull();
    expect(activityLink("SETTINGS", "s1")).toBeNull();
    expect(activityLink("SERVICE", "x")).toBeNull();
  });
});
