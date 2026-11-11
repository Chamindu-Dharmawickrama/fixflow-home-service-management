import { InvoiceStatus, WorkOrderStatus } from "@fixflow/shared";

import type { PrismaClient } from "../lib/db.js";
import { signInAs } from "./auth-helpers.js";
import type { TestAppOverrides } from "./build-test-app.js";
import { createQuotation } from "./fixtures.js";
import {
  draftInvoice,
  type InvoiceWorld,
  invoiceWorld,
  issuedInvoice,
  moveClockTo,
  paid,
  payableInvoice,
  voidInvoiceRequest,
} from "./invoice-world.js";
import { ALEX, makeRequest, PRIYA } from "./quotation-world.js";
import { at, insertJob } from "./work-order-world.js";

/**
 * A deterministic business for the dashboard, the overview and the exports (T23). The clock is fixed at
 * 12:00 in New York on Thursday 5 March 2026 (EST, UTC-5), so "today" is 2026-03-05, the next seven days
 * end on 2026-03-12, and the clocks go forward on the night of 8 March, inside that window.
 *
 * Every figure the tests assert is worked out by hand in the comments beside the rows, never by
 * running the code under test.
 *
 * Requests (all submitted at the instants shown; local = New York):
 *
 * | key       | status    | submitted (UTC)       | local                 | in today | 7d | 30d |
 * |-----------|-----------|-----------------------|-----------------------|----------|----|-----|
 * | recent    | SUBMITTED | 2026-03-05T15:00:00Z  | 5 Mar 10:00           | yes      | yes| yes |
 * | midnight  | SUBMITTED | 2026-03-05T05:00:00Z  | 5 Mar 00:00 (exactly) | yes      | yes| yes |
 * | lateEdge  | SUBMITTED | 2026-03-05T04:30:00Z  | 4 Mar 23:30 (UTC: 5th)| NO       | yes| yes |
 * | review    | UNDER_REVIEW | 2026-03-03T14:00Z  | 3 Mar                 | no       | yes| yes |
 * | quoted    | QUOTED    | 2026-03-01T14:00Z     | 1 Mar                 | no       | yes| yes |
 * | accepted  | ACCEPTED  | 2026-03-02T14:00Z     | 2 Mar                 | no       | yes| yes |
 * | declined  | DECLINED  | 2026-02-20T14:00Z     | 20 Feb                | no       | no | yes |
 * | weekStart | CANCELLED | 2026-02-27T05:00:00Z  | 27 Feb 00:00 (exactly)| no       | yes| yes |
 * | weekOut   | CANCELLED | 2026-02-27T04:59:59Z  | 26 Feb 23:59:59       | no       | NO | yes |
 * | monthStart| CANCELLED | 2026-02-04T05:00:00Z  | 4 Feb 00:00 (exactly) | no       | no | yes |
 * | monthOut  | CANCELLED | 2026-02-04T04:59:59Z  | 3 Feb 23:59:59        | no       | no | NO  |
 *
 * So "New requests" is 2 today, 7 for 7 days and 10 for 30 days, and "Requests needing action" (the
 * SUBMITTED, UNDER_REVIEW, ACCEPTED and DECLINED ones) is 3 + 1 + 1 + 1 = 6.
 */

export const DASHBOARD_NOW = "2026-03-05T17:00:00.000Z";
export const DASHBOARD_TODAY = "2026-03-05";

/** The requests of the table above: what each one's submitted instant and status are. */
export const REQUEST_ROWS = [
  ["recent", "SUBMITTED", "2026-03-05T15:00:00.000Z"],
  ["midnight", "SUBMITTED", "2026-03-05T05:00:00.000Z"],
  ["lateEdge", "SUBMITTED", "2026-03-05T04:30:00.000Z"],
  ["review", "UNDER_REVIEW", "2026-03-03T14:00:00.000Z"],
  ["quoted", "QUOTED", "2026-03-01T14:00:00.000Z"],
  ["accepted", "ACCEPTED", "2026-03-02T14:00:00.000Z"],
  ["declined", "DECLINED", "2026-02-20T14:00:00.000Z"],
  ["weekStart", "CANCELLED", "2026-02-27T05:00:00.000Z"],
  ["weekOut", "CANCELLED", "2026-02-27T04:59:59.000Z"],
  ["monthStart", "CANCELLED", "2026-02-04T05:00:00.000Z"],
  ["monthOut", "CANCELLED", "2026-02-04T04:59:59.000Z"],
] as const;

export type RequestKey = (typeof REQUEST_ROWS)[number][0];

/** A time long before every range: the requests behind the jobs and invoices are not "new". */
const LONG_AGO = new Date("2026-01-10T15:00:00.000Z");

export async function dashboardWorld(prisma: PrismaClient, options: TestAppOverrides = {}) {
  const w = await invoiceWorld(prisma, { logLevel: "info", ...options });
  const { jordan, sam } = w;

  // ---- Invoices, made at the world's starting clock (2 March) and then aged in the database. ----
  // p1: ISSUED, total 300.00, nothing paid                      -> balance 300.00, due 16 Mar
  const p1 = await payableInvoice(w, { total: "300.00" });
  // p2: PARTIALLY_PAID, total 200.00, 50.00 paid                -> balance 150.00, due 16 Mar
  const p2 = await payableInvoice(w, { total: "200.00" });
  await paid(w, p2.invoice.id, "50.00");
  // p3: partly paid, total 120.00, 20.00 paid, due 27 Feb      -> OVERDUE, balance 100.00, 6 days
  const p3 = await payableInvoice(w, { total: "120.00" });
  await paid(w, p3.invoice.id, "20.00");
  // p4: ISSUED, total 80.00, due 1 Mar                          -> OVERDUE, balance 80.00, 4 days
  const p4 = await payableInvoice(w, { total: "80.00" });
  // p5: PAID, total 150.00                                      -> owes nothing
  const p5 = await payableInvoice(w, { total: "150.00" });
  await paid(w, p5.invoice.id, "150.00");
  // priya: ISSUED, total 60.00 (the other customer's)           -> balance 60.00, due 16 Mar
  const priyaInvoice = await payableInvoice(w, { total: "60.00", owner: "priya" });
  // A voided invoice: its job is back to waiting for an invoice.
  const voided = await issuedInvoice(w);
  const voidResponse = await voidInvoiceRequest(w, voided.invoice.id, {
    reason: "Issued to the wrong customer.",
    expectedStatus: InvoiceStatus.ISSUED,
  });
  if (voidResponse.status !== 200) {
    throw new Error(`Voiding failed with ${voidResponse.status}.`);
  }
  // A draft: its job already has an invoice, so it is not waiting for one.
  const draft = await draftInvoice(w);

  await prisma.invoice.update({
    where: { id: p3.invoice.id },
    data: { issueDate: new Date("2026-02-10"), dueDate: new Date("2026-02-27") },
  });
  await prisma.invoice.update({
    where: { id: p4.invoice.id },
    data: { issueDate: new Date("2026-02-10"), dueDate: new Date("2026-03-01") },
  });

  // ---- Jobs (inserted in exact states; NY is UTC-5 until 8 March, UTC-4 after) ----
  // today: 5 March. j1 09:00, j2 11:00 in progress, j3 15:00.
  const j1 = await insertJob(w, {
    status: WorkOrderStatus.SCHEDULED,
    technicianId: jordan.id,
    start: at("2026-03-05", "09:00"),
    end: at("2026-03-05", "11:00"),
  });
  const j2 = await insertJob(w, {
    status: WorkOrderStatus.IN_PROGRESS,
    technicianId: sam.id,
    start: at("2026-03-05", "11:00"),
    end: at("2026-03-05", "13:00"),
  });
  const j3 = await insertJob(w, {
    status: WorkOrderStatus.SCHEDULED,
    technicianId: jordan.id,
    start: at("2026-03-05", "15:00"),
    end: at("2026-03-05", "16:00"),
  });
  // next days: 6 March, and 12 March 23:00 (EDT, UTC-4) which is the last minute of the window.
  const j4 = await insertJob(w, {
    status: WorkOrderStatus.SCHEDULED,
    technicianId: jordan.id,
    start: at("2026-03-06", "09:00"),
    end: at("2026-03-06", "10:00"),
  });
  const j5 = await insertJob(w, {
    status: WorkOrderStatus.SCHEDULED,
    technicianId: sam.id,
    start: at("2026-03-12", "22:30"),
    end: at("2026-03-12", "23:30"),
  });
  // 13 March 00:00 local is the first minute after the window; 4 March is before today.
  const j6 = await insertJob(w, {
    status: WorkOrderStatus.SCHEDULED,
    technicianId: jordan.id,
    start: at("2026-03-13", "00:00"),
    end: at("2026-03-13", "01:00"),
  });
  const j7 = await insertJob(w, {
    status: WorkOrderStatus.SCHEDULED,
    technicianId: sam.id,
    start: at("2026-03-04", "09:00"),
    end: at("2026-03-04", "10:00"),
  });
  // Needs a time, and needs a new time (which keeps its old appointment as a reference, D-106).
  const j8 = await insertJob(w, { status: WorkOrderStatus.PENDING_SCHEDULING });
  const j9 = await insertJob(w, {
    status: WorkOrderStatus.NEEDS_RESCHEDULING,
    start: at("2026-03-06", "13:00"),
    end: at("2026-03-06", "14:00"),
  });
  // Completed with no invoice (awaiting one), and a cancelled job (neither).
  const j10 = await insertJob(w, { status: WorkOrderStatus.COMPLETED });
  const j14 = await insertJob(w, { status: WorkOrderStatus.CANCELLED });
  // How long each has waited, as the queue says it (the rows' own clocks are the machine's):
  // j8 for two days, j9 for one hour; j10 finished four days ago, the voided invoice's job three.
  await prisma.workOrder.update({
    where: { id: j8.id },
    data: { updatedAt: new Date("2026-03-03T17:00:00.000Z") },
  });
  await prisma.workOrder.update({
    where: { id: j9.id },
    data: { updatedAt: new Date("2026-03-05T16:00:00.000Z") },
  });
  await prisma.workOrder.update({
    where: { id: j10.id },
    data: { completedAt: new Date("2026-03-01T12:00:00.000Z") },
  });

  // ---- Requests of the table ----
  const requests = {} as Record<RequestKey, { id: string; reference: string }>;
  for (const [key, status, submittedAt] of REQUEST_ROWS) {
    const row = await makeRequest(w, { status, submittedAt: new Date(submittedAt) });
    requests[key] = { id: row.id, reference: row.reference };
  }
  // The quotation the QUOTED request has out, valid to 6 March: it runs out tomorrow.
  const sentQuote = await createQuotation(prisma, {
    requestId: requests.quoted.id,
    customerId: w.alex.profile.id,
    createdByUserId: w.admin.id,
    status: "SENT",
    sentAt: new Date("2026-03-02T15:00:00.000Z"),
    sentByUserId: w.admin.id,
    validUntil: new Date("2026-03-06"),
  });
  // A second sent quotation that runs out in two days (the edge) and one in three days (outside).
  const edgeRequest = await makeRequest(w, {
    owner: "priya",
    status: "QUOTED",
    // A day after the rows behind the jobs, so Priya's newest request is always this one.
    submittedAt: new Date("2026-01-11T15:00:00.000Z"),
  });
  const edgeQuote = await createQuotation(prisma, {
    requestId: edgeRequest.id,
    customerId: w.priya.profile.id,
    createdByUserId: w.admin.id,
    status: "SENT",
    sentAt: new Date("2026-03-02T15:00:00.000Z"),
    sentByUserId: w.admin.id,
    validUntil: new Date("2026-03-07"),
  });
  const farRequest = await makeRequest(w, { status: "QUOTED", submittedAt: LONG_AGO });
  await createQuotation(prisma, {
    requestId: farRequest.id,
    customerId: w.alex.profile.id,
    createdByUserId: w.admin.id,
    status: "SENT",
    sentAt: new Date("2026-03-02T15:00:00.000Z"),
    sentByUserId: w.admin.id,
    validUntil: new Date("2026-03-08"),
  });
  // The accepted request's quotation, answered yesterday at noon local (17:00 UTC on the 4th).
  await createQuotation(prisma, {
    requestId: requests.accepted.id,
    customerId: w.alex.profile.id,
    createdByUserId: w.admin.id,
    status: "ACCEPTED",
    sentAt: new Date("2026-03-02T15:00:00.000Z"),
    respondedAt: new Date("2026-03-04T17:00:00.000Z"),
  });

  // Every request that is not in the table (the ones behind the jobs and invoices) was made long ago.
  const tableIds = [
    ...Object.values(requests).map((request) => request.id),
    edgeRequest.id,
    farRequest.id,
  ];
  await prisma.serviceRequest.updateMany({
    where: { id: { notIn: tableIds } },
    data: { submittedAt: LONG_AGO },
  });

  // ---- Move to the day, and sign everyone in again (a session does not outlive days of fake time). ----
  await moveClockTo(w, DASHBOARD_NOW);
  w.alexCookie = await signInAs(w.app, ALEX);
  w.priyaCookie = await signInAs(w.app, PRIYA);

  return {
    ...w,
    requests,
    edgeRequest,
    farRequest,
    sentQuote,
    edgeQuote,
    invoices: { p1, p2, p3, p4, p5, priya: priyaInvoice, voided, draft },
    jobs: { j1, j2, j3, j4, j5, j6, j7, j8, j9, j10, j14 },
  };
}

export type DashboardWorld = Awaited<ReturnType<typeof dashboardWorld>>;

export type { InvoiceWorld };
