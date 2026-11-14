import {
  InvoiceStatus,
  QuotationStatus,
  ServiceRequestStatus,
  WorkOrderStatus,
} from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  DEMO_CHECKS,
  type DemoSnapshot,
  formatDemoReport,
  runDemoChecks,
  type SnapshotInvoice,
  type SnapshotQuotation,
  type SnapshotWorkOrder,
} from "./verify-demo.js";

/**
 * Each rule of the invariant checker is shown to fail on data that breaks it, and to stay quiet on
 * data that keeps it. The checks themselves are never loosened to make seeded data pass.
 */

const NOW = new Date("2026-11-14T15:00:00.000Z");

const EMPTY: DemoSnapshot = {
  timeZone: "America/New_York",
  customerCount: 0,
  technicians: [],
  people: [],
  businessEmail: "hello@coolbreeze.test",
  requests: [],
  quotations: [],
  workOrders: [],
  invoices: [],
  payments: [],
  emailStatuses: {},
  eventsBeforeSubmission: 0,
  futureRows: 0,
  notifications: {},
  activeServiceSlugs: [],
  addressCounts: {},
};

function problems(name: string, snapshot: Partial<DemoSnapshot>): string[] {
  const entry = DEMO_CHECKS.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`There is no check named "${name}".`);
  return entry.check({ ...EMPTY, ...snapshot }, NOW);
}

const invoice = (overrides: Partial<SnapshotInvoice> = {}): SnapshotInvoice => ({
  id: "i1",
  invoiceNumber: "INV-2026-00001",
  status: InvoiceStatus.ISSUED,
  workOrderId: "w1",
  totalAmount: "100.00",
  amountPaid: "0.00",
  issuedAt: new Date("2026-11-10T15:00:00.000Z"),
  voidedAt: null,
  voidReason: null,
  dueDate: "2026-11-24",
  ...overrides,
});

const quotation = (overrides: Partial<SnapshotQuotation> = {}): SnapshotQuotation => ({
  id: "q1",
  reference: "QT-2026-00001",
  requestId: "r1",
  customerId: "c1",
  status: QuotationStatus.ACCEPTED,
  validUntil: "2026-11-30",
  declineReason: null,
  respondedAt: new Date("2026-11-10T15:00:00.000Z"),
  sentAt: new Date("2026-11-09T15:00:00.000Z"),
  voidReason: null,
  replacesQuotationId: null,
  ...overrides,
});

const job = (overrides: Partial<SnapshotWorkOrder> = {}): SnapshotWorkOrder => ({
  id: "w1",
  reference: "JOB-2026-00001",
  requestId: "r1",
  quotationId: "q1",
  customerId: "c1",
  status: WorkOrderStatus.COMPLETED,
  technicianId: "t1",
  scheduledStart: new Date("2026-11-10T14:00:00.000Z"),
  scheduledEnd: new Date("2026-11-10T16:00:00.000Z"),
  startedAt: new Date("2026-11-10T14:05:00.000Z"),
  completedAt: new Date("2026-11-10T16:10:00.000Z"),
  cancelReason: null,
  ...overrides,
});

describe("PAID invoices have amountPaid = total = the sum of their active payments", () => {
  const NAME = "PAID invoices have amountPaid = total = the sum of their active payments";
  const paid = invoice({ status: InvoiceStatus.PAID, amountPaid: "100.00" });

  it("passes when the payments add up to the total", () => {
    const payments = [
      { id: "p1", invoiceId: "i1", amount: "60.00", voidedAt: null },
      { id: "p2", invoiceId: "i1", amount: "40.00", voidedAt: null },
    ];
    expect(problems(NAME, { invoices: [paid], payments })).toEqual([]);
  });

  it("fails when amountPaid is short of the total", () => {
    const short = invoice({ status: InvoiceStatus.PAID, amountPaid: "90.00" });
    const payments = [{ id: "p1", invoiceId: "i1", amount: "90.00", voidedAt: null }];
    expect(problems(NAME, { invoices: [short], payments })).toHaveLength(1);
  });

  it("fails when the payments that stand do not reach the total, because one was voided", () => {
    const payments = [
      {
        id: "p1",
        invoiceId: "i1",
        amount: "100.00",
        voidedAt: new Date("2026-11-11T00:00:00.000Z"),
      },
    ];
    expect(problems(NAME, { invoices: [paid], payments })).toHaveLength(1);
  });

  it("adds money as decimals, so 0.1 + 0.2 is 0.30", () => {
    const point3 = invoice({ status: InvoiceStatus.PAID, totalAmount: "0.30", amountPaid: "0.30" });
    const payments = [
      { id: "p1", invoiceId: "i1", amount: "0.10", voidedAt: null },
      { id: "p2", invoiceId: "i1", amount: "0.20", voidedAt: null },
    ];
    expect(problems(NAME, { invoices: [point3], payments })).toEqual([]);
  });
});

describe("every amountPaid equals the sum of its active payments", () => {
  const NAME = "every amountPaid equals the sum of its active payments";

  it("fails when an invoice records money that no payment backs", () => {
    expect(problems(NAME, { invoices: [invoice({ amountPaid: "25.00" })] })).toHaveLength(1);
  });

  it("fails when amountPaid exceeds the total", () => {
    const over = invoice({ amountPaid: "120.00" });
    const payments = [{ id: "p1", invoiceId: "i1", amount: "120.00", voidedAt: null }];
    expect(problems(NAME, { invoices: [over], payments }).join(" ")).toContain("exceeds the total");
  });

  it("passes for an unpaid invoice and for a part-paid one", () => {
    expect(problems(NAME, { invoices: [invoice()] })).toEqual([]);
    const part = invoice({ amountPaid: "30.00" });
    const payments = [{ id: "p1", invoiceId: "i1", amount: "30.00", voidedAt: null }];
    expect(problems(NAME, { invoices: [part], payments })).toEqual([]);
  });
});

describe("invoice statuses equal the derived statuses", () => {
  const NAME = "invoice statuses equal the derived statuses";

  it("fails for an invoice that is past its due date but stored as ISSUED", () => {
    const late = invoice({ dueDate: "2026-11-01" });
    expect(problems(NAME, { invoices: [late] }).join(" ")).toContain("OVERDUE");
  });

  it("fails for a stored PAID with money still owed", () => {
    expect(problems(NAME, { invoices: [invoice({ status: InvoiceStatus.PAID })] })).toHaveLength(1);
  });

  it("passes for each status the way it is derived", () => {
    const overdue = invoice({ status: InvoiceStatus.OVERDUE, dueDate: "2026-11-01" });
    const issued = invoice();
    const part = invoice({ status: InvoiceStatus.PARTIALLY_PAID, amountPaid: "10.00" });
    const voided = invoice({
      status: InvoiceStatus.VOID,
      voidedAt: new Date("2026-11-11T00:00:00.000Z"),
      voidReason: "Wrong address.",
    });
    const draft = invoice({ status: InvoiceStatus.DRAFT, issuedAt: null, invoiceNumber: null });
    expect(problems(NAME, { invoices: [overdue, issued, part, voided, draft] })).toEqual([]);
  });
});

describe("quotation statuses equal the derived statuses", () => {
  const NAME = "quotation statuses equal the derived statuses";

  it("fails for a SENT quotation whose last day has passed", () => {
    const stale = quotation({ status: QuotationStatus.SENT, validUntil: "2026-11-10" });
    expect(problems(NAME, { quotations: [stale] }).join(" ")).toContain("EXPIRED");
  });

  it("passes for a SENT quotation that is still valid, and for an EXPIRED one", () => {
    const fresh = quotation({ status: QuotationStatus.SENT, validUntil: "2026-11-20" });
    const lapsed = quotation({
      id: "q2",
      reference: "QT-2026-00002",
      status: QuotationStatus.EXPIRED,
      validUntil: "2026-11-01",
    });
    expect(problems(NAME, { quotations: [fresh, lapsed] })).toEqual([]);
  });
});

describe("accepted quotations are never also declined", () => {
  const NAME = "accepted quotations are never also declined";

  it("fails when an accepted quotation carries a decline reason", () => {
    expect(
      problems(NAME, { quotations: [quotation({ declineReason: "Too dear." })] }),
    ).toHaveLength(1);
  });

  it("fails when one request has both an accepted and a declined quotation", () => {
    const declined = quotation({
      id: "q2",
      reference: "QT-2026-00002",
      status: QuotationStatus.DECLINED,
    });
    const requests = [
      {
        id: "r1",
        reference: "FF-2026-00001",
        status: ServiceRequestStatus.ACCEPTED,
        customerId: "c1",
        submittedAt: NOW,
      },
    ];
    expect(problems(NAME, { quotations: [quotation(), declined], requests }).join(" ")).toContain(
      "both accepted and declined",
    );
  });

  it("passes for an accepted quotation and a declined one on different requests", () => {
    const declined = quotation({
      id: "q2",
      reference: "QT-2026-00002",
      requestId: "r2",
      status: QuotationStatus.DECLINED,
    });
    expect(problems(NAME, { quotations: [quotation(), declined] })).toEqual([]);
  });
});

describe("every job links to an ACCEPTED quotation of its own request", () => {
  const NAME = "every job links to an ACCEPTED quotation of its own request";

  it("fails when the quotation is not accepted", () => {
    const sent = quotation({ status: QuotationStatus.SENT });
    expect(problems(NAME, { quotations: [sent], workOrders: [job()] }).join(" ")).toContain(
      "not ACCEPTED",
    );
  });

  it("fails when the quotation belongs to another request or customer", () => {
    const elsewhere = quotation({ requestId: "r2", customerId: "c2" });
    expect(problems(NAME, { quotations: [elsewhere], workOrders: [job()] })).toHaveLength(2);
  });

  it("fails when the quotation does not exist", () => {
    expect(problems(NAME, { workOrders: [job()] }).join(" ")).toContain("does not exist");
  });

  it("passes for an accepted quotation of the same request and customer", () => {
    expect(problems(NAME, { quotations: [quotation()], workOrders: [job()] })).toEqual([]);
  });
});

describe("no technician is booked twice at once", () => {
  const NAME = "no technician is booked twice at once";
  const technicians = [{ id: "t1", name: "Jordan Lee", email: null, phone: null }];
  const visit = (
    id: string,
    start: string,
    end: string,
    status: WorkOrderStatus = WorkOrderStatus.SCHEDULED,
  ) =>
    job({
      id,
      reference: `JOB-${id}`,
      status,
      scheduledStart: new Date(start),
      scheduledEnd: new Date(end),
      startedAt: null,
      completedAt: null,
    });

  it("fails for two overlapping visits of one technician", () => {
    const workOrders = [
      visit("a", "2026-11-14T14:00:00.000Z", "2026-11-14T16:00:00.000Z"),
      visit("b", "2026-11-14T15:30:00.000Z", "2026-11-14T17:00:00.000Z"),
    ];
    expect(problems(NAME, { technicians, workOrders }).join(" ")).toContain("Jordan Lee");
  });

  it("allows a back-to-back pair, where one ends exactly as the next begins", () => {
    const workOrders = [
      visit("a", "2026-11-14T14:00:00.000Z", "2026-11-14T16:00:00.000Z"),
      visit("b", "2026-11-14T16:00:00.000Z", "2026-11-14T17:30:00.000Z"),
    ];
    expect(problems(NAME, { technicians, workOrders })).toEqual([]);
  });

  it("ignores jobs that hold no one's time, such as a cancelled one", () => {
    const workOrders = [
      visit("a", "2026-11-14T14:00:00.000Z", "2026-11-14T16:00:00.000Z"),
      visit("b", "2026-11-14T15:00:00.000Z", "2026-11-14T17:00:00.000Z", WorkOrderStatus.CANCELLED),
    ];
    expect(problems(NAME, { technicians, workOrders })).toEqual([]);
  });
});

describe("completed jobs have plausible start and complete times", () => {
  const NAME = "completed jobs have plausible start and complete times";

  it("passes for a visit that started on time and finished shortly after it ended", () => {
    expect(problems(NAME, { workOrders: [job()] })).toEqual([]);
  });

  it("fails when the job was completed with no start time", () => {
    expect(problems(NAME, { workOrders: [job({ startedAt: null })] })).toHaveLength(1);
  });

  it("fails when it finished before it started, or in under ten minutes", () => {
    const backwards = job({ completedAt: new Date("2026-11-10T14:00:00.000Z") });
    const instant = job({ completedAt: new Date("2026-11-10T14:08:00.000Z") });
    expect(problems(NAME, { workOrders: [backwards] })).not.toEqual([]);
    expect(problems(NAME, { workOrders: [instant] })).not.toEqual([]);
  });

  it("fails when it took longer than twelve hours or started long before its visit", () => {
    const long = job({
      scheduledEnd: new Date("2026-11-11T09:00:00.000Z"),
      completedAt: new Date("2026-11-11T09:30:00.000Z"),
    });
    const early = job({ startedAt: new Date("2026-11-10T09:00:00.000Z") });
    expect(problems(NAME, { workOrders: [long] }).join(" ")).toContain("twelve hours");
    expect(problems(NAME, { workOrders: [early] }).join(" ")).toContain("before its visit");
  });

  it("fails when the completion is dated in the future", () => {
    const future = job({
      scheduledStart: new Date("2026-11-20T14:00:00.000Z"),
      scheduledEnd: new Date("2026-11-20T16:00:00.000Z"),
      startedAt: new Date("2026-11-20T14:05:00.000Z"),
      completedAt: new Date("2026-11-20T16:10:00.000Z"),
    });
    expect(problems(NAME, { workOrders: [future] }).join(" ")).toContain("in the future");
  });
});

describe("references are well formed and unique", () => {
  const NAME = "references are well formed and unique";
  const request = (reference: string, id = reference) => ({
    id,
    reference,
    status: ServiceRequestStatus.SUBMITTED,
    customerId: "c1",
    submittedAt: NOW,
  });

  it("passes for well-formed, distinct references", () => {
    expect(
      problems(NAME, {
        requests: [request("FF-2026-00001"), request("FF-2026-00002")],
        quotations: [quotation()],
        workOrders: [job()],
        invoices: [invoice()],
      }),
    ).toEqual([]);
  });

  it("fails for a malformed reference and for a repeated one", () => {
    expect(problems(NAME, { requests: [request("FF-26-1")] }).join(" ")).toContain("malformed");
    expect(
      problems(NAME, {
        requests: [request("FF-2026-00001", "a"), request("FF-2026-00001", "b")],
      }).join(" "),
    ).toContain("used twice");
    expect(
      problems(NAME, { quotations: [quotation({ reference: "INV-2026-00001" })] }),
    ).not.toEqual([]);
  });

  it("does not ask a draft invoice for a number", () => {
    expect(
      problems(NAME, {
        invoices: [invoice({ status: InvoiceStatus.DRAFT, invoiceNumber: null, issuedAt: null })],
      }),
    ).toEqual([]);
  });
});

describe("every status of every entity appears", () => {
  const NAME = "every status of every entity appears";

  it("names what is missing", () => {
    const missing = problems(NAME, {});
    expect(missing).toHaveLength(4);
    expect(missing.join(" ")).toContain("SUBMITTED");
    expect(missing.join(" ")).toContain("DRAFT");
    expect(missing.join(" ")).toContain("NEEDS_RESCHEDULING");
    expect(missing.join(" ")).toContain("PARTIALLY_PAID");
  });

  it("passes when every status is present", () => {
    const requests = Object.values(ServiceRequestStatus).map((status, index) => ({
      id: `r${index}`,
      reference: `FF-2026-0000${index}`,
      status,
      customerId: "c1",
      submittedAt: NOW,
    }));
    const quotations = Object.values(QuotationStatus).map((status, index) =>
      quotation({ id: `q${index}`, status }),
    );
    const workOrders = Object.values(WorkOrderStatus).map((status, index) =>
      job({ id: `w${index}`, status }),
    );
    const invoices = Object.values(InvoiceStatus).map((status, index) =>
      invoice({ id: `i${index}`, status }),
    );
    expect(problems(NAME, { requests, quotations, workOrders, invoices })).toEqual([]);
  });
});

describe("volumes are within the ranges", () => {
  it("fails for an empty business and names each range", () => {
    const found = problems("volumes are within the ranges", {});
    expect(found).toHaveLength(7);
    expect(found.join(" ")).toContain("requests: 0, expected 18 to 22");
  });
});

describe("requests agree with their quotations and jobs", () => {
  const NAME = "requests agree with their quotations and jobs";
  const request = (status: ServiceRequestStatus) => ({
    id: "r1",
    reference: "FF-2026-00001",
    status,
    customerId: "c1",
    submittedAt: NOW,
  });

  it("fails for a converted request without a job, and a job on a request that is not converted", () => {
    expect(
      problems(NAME, { requests: [request(ServiceRequestStatus.CONVERTED_TO_JOB)] }),
    ).not.toEqual([]);
    expect(
      problems(NAME, {
        requests: [request(ServiceRequestStatus.ACCEPTED)],
        quotations: [quotation()],
        workOrders: [job()],
      }),
    ).not.toEqual([]);
  });

  it("fails for a QUOTED request with no sent quotation and a CANCELLED one with an open quotation", () => {
    expect(problems(NAME, { requests: [request(ServiceRequestStatus.QUOTED)] })).not.toEqual([]);
    expect(
      problems(NAME, {
        requests: [request(ServiceRequestStatus.CANCELLED)],
        quotations: [quotation({ status: QuotationStatus.DRAFT })],
      }),
    ).not.toEqual([]);
  });

  it("passes for requests that match what happened to them", () => {
    expect(
      problems(NAME, {
        requests: [request(ServiceRequestStatus.CONVERTED_TO_JOB)],
        quotations: [quotation()],
        workOrders: [job()],
      }),
    ).toEqual([]);
    expect(
      problems(NAME, {
        requests: [request(ServiceRequestStatus.QUOTED)],
        quotations: [quotation({ status: QuotationStatus.SENT })],
      }),
    ).toEqual([]);
  });
});

describe("invoices belong to completed jobs, one live invoice each", () => {
  const NAME = "invoices belong to completed jobs, one live invoice each";

  it("fails for an invoice on a job that is not completed", () => {
    expect(
      problems(NAME, {
        workOrders: [job({ status: WorkOrderStatus.SCHEDULED })],
        invoices: [invoice()],
      }),
    ).not.toEqual([]);
  });

  it("fails when a job has two invoices that are not void, but not when one is void", () => {
    const second = invoice({ id: "i2", invoiceNumber: "INV-2026-00002" });
    expect(
      problems(NAME, { workOrders: [job()], invoices: [invoice(), second] }).join(" "),
    ).toContain("2 invoices that are not void");
    const voided = invoice({
      id: "i2",
      invoiceNumber: "INV-2026-00002",
      status: InvoiceStatus.VOID,
      voidedAt: new Date("2026-11-11T00:00:00.000Z"),
      voidReason: "Issued in error.",
    });
    expect(problems(NAME, { workOrders: [job()], invoices: [invoice(), voided] })).toEqual([]);
  });

  it("fails for a draft with a number, an issued invoice without one, and a void without a reason", () => {
    const draft = invoice({ status: InvoiceStatus.DRAFT, issuedAt: null });
    const unnumbered = invoice({ invoiceNumber: null });
    const noReason = invoice({ status: InvoiceStatus.VOID, voidedAt: NOW, voidReason: "  " });
    expect(problems(NAME, { workOrders: [job()], invoices: [draft] })).not.toEqual([]);
    expect(problems(NAME, { workOrders: [job()], invoices: [unnumbered] })).not.toEqual([]);
    expect(problems(NAME, { workOrders: [job()], invoices: [noReason] })).not.toEqual([]);
  });
});

describe("all personal data is fictional", () => {
  const NAME = "all personal data is fictional";

  it("passes for .test addresses and 555-01xx phone numbers", () => {
    expect(
      problems(NAME, { people: [{ email: "marcus.webb@example.test", phone: "(212) 555-0104" }] }),
    ).toEqual([]);
  });

  it("fails for a real-looking address or phone number", () => {
    expect(problems(NAME, { people: [{ email: "someone@gmail.com", phone: null }] })).toHaveLength(
      1,
    );
    expect(
      problems(NAME, { people: [{ email: "a@example.test", phone: "(212) 555-0242" }] }),
    ).toHaveLength(1);
    expect(problems(NAME, { businessEmail: "hello@coolbreeze.com" })).toHaveLength(1);
  });
});

describe("emails are logged, never sent", () => {
  const NAME = "emails are logged, never sent";

  it("passes when everything was only logged", () => {
    expect(problems(NAME, { emailStatuses: { LOGGED: 103 } })).toEqual([]);
  });

  it("fails for an email that was sent or failed", () => {
    expect(problems(NAME, { emailStatuses: { LOGGED: 5, SENT: 1 } })).toHaveLength(1);
    expect(problems(NAME, { emailStatuses: { FAILED: 2 } })).toHaveLength(1);
  });
});

describe("history is in order and not in the future", () => {
  const NAME = "history is in order and not in the future";

  it("fails for an event older than its request or dated after now", () => {
    expect(problems(NAME, { eventsBeforeSubmission: 2 })).toHaveLength(1);
    expect(problems(NAME, { futureRows: 1 })).toHaveLength(1);
    expect(problems(NAME, {})).toEqual([]);
  });
});

describe("the demo script has what it needs", () => {
  const NAME = "the demo script has what it needs";

  it("lists what is missing from an empty business", () => {
    const missing = problems(NAME, {}).join(" ");
    expect(missing).toContain("waiting for a decision");
    expect(missing).toContain("IN_PROGRESS today");
    expect(missing).toContain("Jordan Lee is missing");
    expect(missing).toContain("AC Diagnostic Visit");
  });
});

describe("the report", () => {
  it("fails overall when any check fails, and says which", () => {
    const report = runDemoChecks(EMPTY, NOW);
    expect(report.ok).toBe(false);
    expect(report.checks).toHaveLength(DEMO_CHECKS.length);
    const text = formatDemoReport(report);
    expect(text).toContain("FAIL  volumes are within the ranges");
    expect(text).toMatch(/\d+ of \d+ checks failed\./);
  });

  it("lists every rule the task requires", () => {
    const names = DEMO_CHECKS.map((entry) => entry.name).join(" | ");
    for (const phrase of [
      "PAID invoices have amountPaid",
      "every amountPaid equals",
      "statuses equal the derived statuses",
      "never also declined",
      "ACCEPTED quotation",
      "no technician is booked twice",
      "plausible start and complete times",
      "references are well formed and unique",
      "every status of every entity appears",
      "volumes are within the ranges",
    ]) {
      expect(names).toContain(phrase);
    }
  });
});
