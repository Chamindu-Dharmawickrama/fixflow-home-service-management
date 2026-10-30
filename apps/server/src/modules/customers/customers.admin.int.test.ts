import {
  type AdminCustomerDto,
  type AdminCustomerListResponse,
  type AdminCustomerNoteDto,
  CUSTOMER_HISTORY_TYPES,
  CUSTOMER_NOTES_SHOWN,
  CUSTOMER_RECENT_COUNT,
  type CustomerHistoryInvoiceDto,
  type CustomerHistoryJobDto,
  type CustomerHistoryRequestDto,
  type CustomerHistoryResponse,
  type CustomerHistoryType,
  ErrorCode,
  type InvoiceStatus,
  LIMITS,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/db.js";
import { createLocalAdmin, createLocalCustomer, signInAs } from "../../test/auth-helpers.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import {
  createAddress,
  createBusinessSettings,
  createInvoice,
  createQuotation,
  createService,
  createServiceRequest,
  createWorkOrder,
} from "../../test/fixtures.js";
import { api, bodyOf, expectApiError } from "../../test/http.js";
import { listAdminCustomers } from "./customers.admin.service.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const ALEX = "alex.morgan@example.test";
const PRIYA = "priya.shah@example.test";
const ADMIN_CUSTOMERS = "/api/v1/admin/customers";
const MISSING_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

const detailPath = (id: string) => `${ADMIN_CUSTOMERS}/${id}`;
const historyPath = (id: string, query = "") => `${ADMIN_CUSTOMERS}/${id}/history${query}`;
const notesPath = (id: string) => `${ADMIN_CUSTOMERS}/${id}/notes`;

type Owner = "alex" | "priya";

/** An admin, two customers with a phone and a default address each, a service, everyone signed in. */
async function world(options: Parameters<typeof buildTestApp>[0] = {}) {
  await createBusinessSettings(prisma);
  const test = buildTestApp({ prisma, ...options });
  const alex = await createLocalCustomer(prisma, { email: ALEX, name: "Alex Morgan" });
  const priya = await createLocalCustomer(prisma, { email: PRIYA, name: "Priya Shah" });
  await prisma.customerProfile.update({
    where: { id: alex.profile.id },
    data: { phone: "(212) 555-0142" },
  });
  await prisma.customerProfile.update({
    where: { id: priya.profile.id },
    data: { phone: "+1 646 555 0188" },
  });
  const admin = await createLocalAdmin(prisma);
  await prisma.user.update({ where: { id: admin.id }, data: { name: "Morgan Reyes" } });
  const service = await createService(prisma, { name: "AC Repair", slug: "ac-repair" });
  const alexHome = await createAddress(prisma, alex.profile.id, {
    label: "Home",
    line1: "214 Larkspur Lane",
    city: "Harbor City",
    accessNotes: "Gate code 4821. Dog in the yard.",
    isDefault: true,
  });
  await createAddress(prisma, alex.profile.id, {
    label: "Rental",
    line1: "9 Quay Street",
    city: "Port Elm",
    isDefault: false,
  });
  await createAddress(prisma, priya.profile.id, {
    label: "Flat",
    line1: "88 Mill Road",
    city: "Brookfield",
    isDefault: true,
  });
  return {
    ...test,
    client: api(test.app),
    alex,
    priya,
    alexHome,
    admin,
    service,
    alexCookie: await signInAs(test.app, ALEX),
    priyaCookie: await signInAs(test.app, PRIYA),
    adminCookie: await signInAs(test.app, admin.email),
  };
}

type World = Awaited<ReturnType<typeof world>>;

let sequence = 0;
const nextNumber = () => {
  sequence += 1;
  return sequence;
};

function makeRequest(
  w: World,
  owner: Owner = "alex",
  overrides: Partial<Prisma.ServiceRequestUncheckedCreateInput> = {},
) {
  return createServiceRequest(prisma, {
    customerId: w[owner].profile.id,
    serviceId: w.service.id,
    serviceNameSnapshot: "AC Repair",
    reference: `FF-2026-9${String(nextNumber()).padStart(4, "0")}`,
    ...overrides,
  });
}

/** A request with its accepted quotation and a job: the chain the database requires. */
async function makeJob(
  w: World,
  owner: Owner = "alex",
  job: Partial<Prisma.WorkOrderUncheckedCreateInput> = {},
) {
  const customerId = w[owner].profile.id;
  const request = await makeRequest(w, owner, { status: "CONVERTED_TO_JOB" });
  const quotation = await createQuotation(prisma, {
    requestId: request.id,
    customerId,
    createdByUserId: w.admin.id,
    status: "ACCEPTED",
    sentAt: new Date("2026-10-20T15:00:00.000Z"),
    reference: `QT-2026-9${String(nextNumber()).padStart(4, "0")}`,
  });
  const workOrder = await createWorkOrder(prisma, {
    requestId: request.id,
    quotationId: quotation.id,
    customerId,
    serviceId: w.service.id,
    createdByUserId: w.admin.id,
    reference: `JOB-2026-9${String(nextNumber()).padStart(4, "0")}`,
    serviceNameSnapshot: "AC Repair",
    ...job,
  });
  return { request, quotation, workOrder };
}

/** A job with an invoice for it, with the fields an issued invoice must carry. */
async function makeInvoice(
  w: World,
  owner: Owner,
  invoice: Omit<Partial<Prisma.InvoiceUncheckedCreateInput>, "status"> & {
    status: InvoiceStatus;
  },
) {
  const chain = await makeJob(w, owner, { status: "COMPLETED", completedAt: new Date() });
  const issued = invoice.status !== "DRAFT" && invoice.status !== "VOID";
  const row = await createInvoice(prisma, {
    workOrderId: chain.workOrder.id,
    customerId: w[owner].profile.id,
    createdByUserId: w.admin.id,
    ...(issued && {
      invoiceNumber: `INV-2026-9${String(nextNumber()).padStart(4, "0")}`,
      issuedAt: new Date("2026-10-25T15:00:00.000Z"),
      issueDate: new Date("2026-10-25"),
      dueDate: new Date("2026-11-08"),
    }),
    ...(invoice.status === "VOID" && { voidedAt: new Date(), voidReason: "Raised by mistake." }),
    ...invoice,
  });
  return { ...chain, invoice: row };
}

const listOf = (response: { body: unknown }) => response.body as AdminCustomerListResponse;
const customerOf = (response: { body: unknown }) =>
  (response.body as { data: AdminCustomerDto }).data;
const noteOf = (response: { body: unknown }) =>
  (response.body as { data: AdminCustomerNoteDto }).data;
const namesOf = (response: { body: unknown }) => listOf(response).data.map((item) => item.name);

function getList(w: World, query = "", cookie = w.adminCookie) {
  return w.client.get(`${ADMIN_CUSTOMERS}${query}`, { cookie });
}

function getHistory(w: World, id: string, type: string, extra = "", cookie = w.adminCookie) {
  return w.client.get(historyPath(id, `?type=${type}${extra}`), { cookie });
}

function postNote(w: World, id: string, body: Record<string, unknown>, cookie = w.adminCookie) {
  return w.client.post(notesPath(id), { cookie }).send(body);
}

/** Counts of everything a failed or forbidden call could have written. */
async function footprint() {
  const [notes, events, notifications, emails] = await Promise.all([
    prisma.customerNote.count(),
    prisma.activityEvent.count(),
    prisma.notification.count(),
    prisma.emailDeliveryLog.count(),
  ]);
  return { notes, events, notifications, emails };
}

// ---------------------------------------------------------------------------------------------

describe("authentication and roles", () => {
  it("answers 401 to every endpoint without a session", async () => {
    const { app } = buildTestApp({ prisma });
    const client = api(app);

    for (const response of [
      await client.get(ADMIN_CUSTOMERS),
      await client.get(detailPath(MISSING_ID)),
      await client.get(historyPath(MISSING_ID, "?type=requests")),
      await client.post(notesPath(MISSING_ID)).send({ body: "Hello" }),
    ]) {
      expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
    }
  });

  it("answers a customer 403 on every endpoint and changes nothing (G.1)", async () => {
    const w = await world();
    const before = await footprint();

    const responses = [
      await getList(w, "", w.alexCookie),
      await w.client.get(detailPath(w.alex.profile.id), { cookie: w.alexCookie }),
      // A customer cannot read another customer's record by naming it, nor their own through here.
      await w.client.get(detailPath(w.priya.profile.id), { cookie: w.alexCookie }),
      await getHistory(w, w.alex.profile.id, "requests", "", w.alexCookie),
      await postNote(w, w.alex.profile.id, { body: "Hello" }, w.alexCookie),
    ];

    for (const response of responses) {
      expectApiError(response, { status: 403, code: ErrorCode.FORBIDDEN });
    }
    expect(await footprint()).toEqual(before);
  });

  it("answers an admin who has left the allowlist 403", async () => {
    const w = await world();
    const former = await createLocalAdmin(prisma, { email: "former.admin@demo.fixflow.test" });
    const cookie = await signInAs(w.app, former.email);

    expectApiError(await getList(w, "", cookie), { status: 403, code: ErrorCode.FORBIDDEN });
    expectApiError(await postNote(w, w.alex.profile.id, { body: "Hello" }, cookie), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
    expect(await prisma.customerNote.count()).toBe(0);
  });

  it("refuses a note from another origin (CSRF) and writes nothing", async () => {
    const w = await world();
    const response = await w.client
      .post(notesPath(w.alex.profile.id), { cookie: w.adminCookie, origin: "https://evil.example" })
      .send({ body: "Hello" });
    expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expect(await prisma.customerNote.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe("GET /admin/customers: the directory (FR-031)", () => {
  it("lists every customer, by name from A to Z, with the page details", async () => {
    const w = await world();
    const response = await getList(w);

    expect(response.status).toBe(200);
    expect(namesOf(response)).toEqual(["Alex Morgan", "Priya Shah"]);
    expect(listOf(response).pagination).toEqual({
      page: 1,
      pageSize: 20,
      totalItems: 2,
      totalPages: 1,
    });
  });

  it("never lists the business's own team", async () => {
    const w = await world();
    const names = namesOf(await getList(w));
    expect(names).not.toContain("Morgan Reyes");
    expect(await prisma.user.count()).toBe(3);
  });

  it("gives each customer's contact details, default city and signup date", async () => {
    const w = await world();
    const alex = listOf(await getList(w)).data[0];
    expect(alex).toMatchObject({
      id: w.alex.profile.id,
      name: "Alex Morgan",
      email: ALEX,
      phone: "(212) 555-0142",
      // The default address's city, not the other address's.
      city: "Harbor City",
      currencyCode: "USD",
      requestCount: 0,
      openJobCount: 0,
      outstandingBalance: "0.00",
    });
    expect(alex?.createdAt).toBe(w.alex.profile.createdAt.toISOString());
    // With no activity recorded, the last activity is when the customer signed up.
    expect(alex?.lastActivityAt).toBe(w.alex.profile.createdAt.toISOString());
  });

  it("has no city for a customer without an address, and no phone when none was given", async () => {
    const w = await world();
    const dana = await createLocalCustomer(prisma, {
      email: "dana@example.test",
      name: "Dana Fox",
    });
    await prisma.customerProfile.update({ where: { id: dana.profile.id }, data: { phone: null } });

    const item = listOf(await getList(w, "?q=dana")).data[0];
    expect(item).toMatchObject({ name: "Dana Fox", city: null, phone: null });
  });

  it("carries only the documented fields of a customer", async () => {
    const w = await world();
    const item = listOf(await getList(w)).data[0];
    expect(Object.keys(item ?? {}).sort()).toEqual(
      [
        "city",
        "createdAt",
        "currencyCode",
        "email",
        "id",
        "lastActivityAt",
        "name",
        "openJobCount",
        "outstandingBalance",
        "phone",
        "requestCount",
      ].sort(),
    );
    const text = JSON.stringify(listOf(await getList(w)));
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("argon2id");
    expect(text).not.toContain("Gate code");
  });

  describe("search", () => {
    async function searchWorld() {
      const w = await world();
      const dana = await createLocalCustomer(prisma, {
        email: "dana.fox@example.test",
        name: "Dana Fox",
      });
      await prisma.customerProfile.update({
        where: { id: dana.profile.id },
        data: { phone: null },
      });
      return { w, dana };
    }

    const search = (w: World, q: string) =>
      w.client.get(ADMIN_CUSTOMERS, { cookie: w.adminCookie }).query({ q });

    it.each([
      ["alex", ["Alex Morgan"]],
      ["ALEX", ["Alex Morgan"]],
      ["  alex  ", ["Alex Morgan"]],
      ["lex mor", ["Alex Morgan"]],
      ["alex     morgan", ["Alex Morgan"]],
      ["shah", ["Priya Shah"]],
      ["dana.fox@EXAMPLE.test", ["Dana Fox"]],
      ["example.test", ["Alex Morgan", "Dana Fox", "Priya Shah"]],
      ["nobody", []],
    ])("finds %j by name or email, whatever its case", async (q, expected) => {
      const { w } = await searchWorld();
      expect(namesOf(await search(w, q))).toEqual(expected);
    });

    it.each([
      ["212", ["Alex Morgan"]],
      ["(212) 555-0142", ["Alex Morgan"]],
      ["212-555-0142", ["Alex Morgan"]],
      ["212.555.0142", ["Alex Morgan"]],
      ["2125550142", ["Alex Morgan"]],
      ["555 0188", ["Priya Shah"]],
      ["+1 646", ["Priya Shah"]],
      ["555", ["Alex Morgan", "Priya Shah"]],
      // Two digits are too few to be a phone search, and nothing else holds them.
      ["21", []],
      ["999", []],
    ])("finds %j by phone, ignoring punctuation", async (q, expected) => {
      const { w } = await searchWorld();
      expect(namesOf(await search(w, q))).toEqual(expected);
    });

    it("does not find a customer who gave no phone by the digits of anyone's phone", async () => {
      const { w } = await searchWorld();
      expect(namesOf(await search(w, "555"))).not.toContain("Dana Fox");
    });

    it("takes the characters of a SQL pattern literally", async () => {
      const { w } = await searchWorld();
      // Unescaped, `%` would match everyone and `_` any single letter.
      expect(namesOf(await search(w, "%"))).toEqual([]);
      expect(namesOf(await search(w, "_"))).toEqual([]);
      expect(namesOf(await search(w, "a_e"))).toEqual([]);
      expect(namesOf(await search(w, "al%x"))).toEqual([]);
      expect(namesOf(await search(w, "\\"))).toEqual([]);
    });

    it("treats SQL in the search as text and damages nothing", async () => {
      const { w } = await searchWorld();
      const users = await prisma.user.count();
      for (const q of [
        "' OR '1'='1",
        "x'); DROP TABLE users; --",
        '" OR ""="',
        "alex' --",
        "1; SELECT pg_sleep(5)",
      ]) {
        const response = await search(w, q);
        expect(response.status, q).toBe(200);
        expect(namesOf(response), q).toEqual([]);
      }
      expect(await prisma.user.count()).toBe(users);
    });

    it("counts only the matches and pages them", async () => {
      const { w } = await searchWorld();
      const response = await w.client
        .get(ADMIN_CUSTOMERS, { cookie: w.adminCookie })
        .query({ q: "example.test", pageSize: "2", page: "2" });
      expect(namesOf(response)).toEqual(["Priya Shah"]);
      expect(listOf(response).pagination).toEqual({
        page: 2,
        pageSize: 2,
        totalItems: 3,
        totalPages: 2,
      });
    });

    it("treats a blank search as none", async () => {
      const { w } = await searchWorld();
      expect(namesOf(await search(w, "   "))).toHaveLength(3);
    });

    it("does not search the text of requests or notes", async () => {
      const { w } = await searchWorld();
      await makeRequest(w, "alex", { description: "Zebra-striped compressor needs replacing." });
      await prisma.customerNote.create({
        data: { customerId: w.alex.profile.id, authorUserId: w.admin.id, body: "Quokka lover." },
      });
      expect(namesOf(await search(w, "zebra"))).toEqual([]);
      expect(namesOf(await search(w, "quokka"))).toEqual([]);
    });

    it("refuses a search that is too long or given twice", async () => {
      const w = await world();
      expectApiError(await search(w, "a".repeat(101)), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expectApiError(await getList(w, "?q=a&q=b"), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe("sort and pages", () => {
    async function manyCustomers(count: number) {
      const w = await world();
      const created = [];
      for (let index = 0; index < count; index += 1) {
        created.push(
          await createLocalCustomer(prisma, {
            email: `customer${index}@example.test`,
            name: `Customer ${String(index).padStart(2, "0")}`,
          }),
        );
      }
      return { w, created };
    }

    it("sorts by name, ignoring case, in either direction", async () => {
      const w = await world();
      await createLocalCustomer(prisma, { email: "bob@example.test", name: "bob lowercase" });
      await createLocalCustomer(prisma, { email: "zed@example.test", name: "Zed Upper" });

      expect(namesOf(await getList(w, "?sort=name&order=asc"))).toEqual([
        "Alex Morgan",
        "bob lowercase",
        "Priya Shah",
        "Zed Upper",
      ]);
      expect(namesOf(await getList(w, "?sort=name&order=desc"))).toEqual([
        "Zed Upper",
        "Priya Shah",
        "bob lowercase",
        "Alex Morgan",
      ]);
    });

    it("sorts by the day the customer signed up", async () => {
      const w = await world();
      await prisma.customerProfile.update({
        where: { id: w.alex.profile.id },
        data: { createdAt: new Date("2026-03-01T09:00:00.000Z") },
      });
      await prisma.customerProfile.update({
        where: { id: w.priya.profile.id },
        data: { createdAt: new Date("2026-01-15T09:00:00.000Z") },
      });
      expect(namesOf(await getList(w, "?sort=createdAt&order=asc"))).toEqual([
        "Priya Shah",
        "Alex Morgan",
      ]);
      expect(namesOf(await getList(w, "?sort=createdAt&order=desc"))).toEqual([
        "Alex Morgan",
        "Priya Shah",
      ]);
    });

    it("sorts by the latest activity, and a customer with none counts from signup", async () => {
      const w = await world();
      const dana = await createLocalCustomer(prisma, {
        email: "dana@example.test",
        name: "Dana Fox",
      });
      await prisma.customerProfile.update({
        where: { id: w.alex.profile.id },
        data: { createdAt: new Date("2026-01-01T09:00:00.000Z") },
      });
      await prisma.customerProfile.update({
        where: { id: w.priya.profile.id },
        data: { createdAt: new Date("2026-01-01T09:00:00.000Z") },
      });
      await prisma.customerProfile.update({
        where: { id: dana.profile.id },
        data: { createdAt: new Date("2026-10-10T09:00:00.000Z") },
      });
      const event = (customerId: string, createdAt: string, action = "request.submitted") =>
        prisma.activityEvent.create({
          data: {
            actorUserId: w.admin.id,
            entityType: "SERVICE_REQUEST",
            entityId: MISSING_ID,
            customerId,
            action,
            summary: "Something happened.",
            createdAt: new Date(createdAt),
          },
        });
      // Alex: an old event and then a newer one. Priya: one in between. Dana: none.
      await event(w.alex.profile.id, "2026-10-01T10:00:00.000Z");
      await event(w.alex.profile.id, "2026-10-20T10:00:00.000Z", "request.review_started");
      await event(w.priya.profile.id, "2026-10-05T10:00:00.000Z");

      const desc = await getList(w, "?sort=lastActivityAt&order=desc");
      expect(namesOf(desc)).toEqual(["Alex Morgan", "Dana Fox", "Priya Shah"]);
      expect(listOf(desc).data.map((item) => item.lastActivityAt)).toEqual([
        "2026-10-20T10:00:00.000Z",
        "2026-10-10T09:00:00.000Z",
        "2026-10-05T10:00:00.000Z",
      ]);
      expect(namesOf(await getList(w, "?sort=lastActivityAt&order=asc"))).toEqual([
        "Priya Shah",
        "Dana Fox",
        "Alex Morgan",
      ]);
    });

    it("does not count another customer's events", async () => {
      const w = await world();
      await prisma.activityEvent.create({
        data: {
          actorUserId: w.admin.id,
          entityType: "SETTINGS",
          entityId: MISSING_ID,
          customerId: null,
          action: "settings.updated",
          summary: "Changed the settings.",
          createdAt: new Date("2030-01-01T00:00:00.000Z"),
        },
      });
      const items = listOf(await getList(w)).data;
      for (const item of items) {
        expect(item.lastActivityAt).toBe(item.createdAt);
      }
    });

    it.each(["name", "createdAt", "lastActivityAt"] as const)(
      "shows every customer exactly once across the pages when sorted by %s",
      async (sort) => {
        const { w, created } = await manyCustomers(7);
        // Every sort value equal: only the tie-break keeps the pages disjoint.
        await prisma.customerProfile.updateMany({
          data: { createdAt: new Date("2026-02-02T02:02:02.000Z") },
        });
        await prisma.user.updateMany({ where: { role: "CUSTOMER" }, data: { name: "Same Name" } });

        const total = created.length + 2;
        const seen: string[] = [];
        for (const page of [1, 2, 3, 4]) {
          const response = await getList(w, `?sort=${sort}&pageSize=3&page=${page}`);
          expect(listOf(response).pagination.totalItems).toBe(total);
          expect(listOf(response).pagination.totalPages).toBe(Math.ceil(total / 3));
          seen.push(...listOf(response).data.map((item) => item.id));
        }
        expect(seen).toHaveLength(total);
        expect(new Set(seen).size).toBe(total);
      },
    );

    it("answers a page past the end with no rows and the real total", async () => {
      const w = await world();
      const response = await getList(w, "?page=9");
      expect(response.status).toBe(200);
      expect(listOf(response).data).toEqual([]);
      expect(listOf(response).pagination).toMatchObject({ page: 9, totalItems: 2, totalPages: 1 });
    });

    it.each([
      ["a sort field that is not offered", "?sort=email"],
      ["a sort field of another table", "?sort=requestCount"],
      ["a sort written in other capitals", "?sort=NAME"],
      ["SQL as the sort", "?sort=name;DROP%20TABLE%20users"],
      ["a direction that is not one", "?order=sideways"],
      ["a page below 1", "?page=0"],
      ["a page that is not a number", "?page=abc"],
      ["a page size above 100", "?pageSize=101"],
      ["a page size of 0", "?pageSize=0"],
    ])("answers %s with 422", async (_name, query) => {
      const w = await world();
      expectApiError(await getList(w, query), { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(await prisma.user.count()).toBe(3);
    });
  });

  describe("counts and balance", () => {
    /** Alex has a mixed history; Priya has a small one, so a leak between them would show. */
    async function mixedWorld() {
      const w = await world();
      // Alex: 3 requests on top of the ones the jobs below bring.
      await makeRequest(w, "alex", { status: "SUBMITTED" });
      await makeRequest(w, "alex", { status: "UNDER_REVIEW" });
      await makeRequest(w, "alex", { status: "CANCELLED" });
      // Jobs: three open, two closed.
      await makeJob(w, "alex", { status: "PENDING_SCHEDULING" });
      await makeJob(w, "alex", {
        status: "SCHEDULED",
        scheduledStart: new Date("2026-11-12T14:00:00.000Z"),
        scheduledEnd: new Date("2026-11-12T16:00:00.000Z"),
      });
      await makeJob(w, "alex", { status: "NEEDS_RESCHEDULING" });
      await makeJob(w, "alex", { status: "COMPLETED", completedAt: new Date() });
      await makeJob(w, "alex", {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: "Customer moved away.",
      });
      // Invoices (each also brings a completed job and a request). Owed: 108 + (216 − 100.50) + 54.
      await makeInvoice(w, "alex", { status: "ISSUED", totalAmount: "108.00", amountPaid: "0.00" });
      await makeInvoice(w, "alex", {
        status: "PARTIALLY_PAID",
        totalAmount: "216.00",
        amountPaid: "100.50",
      });
      await makeInvoice(w, "alex", { status: "OVERDUE", totalAmount: "54.00", amountPaid: "0.00" });
      // Owed nothing, or not yet: paid, draft, void, and one in another currency.
      await makeInvoice(w, "alex", { status: "PAID", totalAmount: "500.00", amountPaid: "500.00" });
      await makeInvoice(w, "alex", { status: "DRAFT", totalAmount: "77.00" });
      await makeInvoice(w, "alex", { status: "VOID", totalAmount: "999.00" });
      await makeInvoice(w, "alex", {
        status: "ISSUED",
        totalAmount: "300.00",
        currencyCode: "EUR",
      });

      // Priya: one request, one open job, one issued invoice of 20.00.
      await makeJob(w, "priya", { status: "IN_PROGRESS", startedAt: new Date() });
      await makeInvoice(w, "priya", { status: "ISSUED", totalAmount: "20.00", amountPaid: "0.00" });
      return w;
    }

    it("counts each customer's requests, open jobs and what they still owe (G.2)", async () => {
      const w = await mixedWorld();
      const items = listOf(await getList(w)).data;
      const alex = items.find((item) => item.name === "Alex Morgan");
      const priya = items.find((item) => item.name === "Priya Shah");

      // Requests: 3 plain + 5 jobs + 7 invoices' jobs (each job and invoice chain has its own).
      expect(alex).toMatchObject({
        requestCount: 3 + 5 + 7,
        openJobCount: 3,
        outstandingBalance: "277.50",
        currencyCode: "USD",
      });
      // Priya's own: a job and the job behind her invoice.
      expect(priya).toMatchObject({
        requestCount: 2,
        openJobCount: 1,
        outstandingBalance: "20.00",
      });
    });

    it("agrees with the rows in the database, whatever the page size", async () => {
      const w = await mixedWorld();
      const alexRequests = await prisma.serviceRequest.count({
        where: { customerId: w.alex.profile.id },
      });
      for (const pageSize of [1, 2, 20]) {
        const items = listOf(await getList(w, `?pageSize=${pageSize}&page=1`)).data;
        const alex = items.find((item) => item.name === "Alex Morgan");
        if (alex !== undefined) {
          expect(alex.requestCount).toBe(alexRequests);
          expect(alex.outstandingBalance).toBe("277.50");
        }
      }
    });

    it("owes nothing to a customer with no issued invoice", async () => {
      const w = await world();
      await makeInvoice(w, "alex", { status: "DRAFT", totalAmount: "77.00" });
      await makeInvoice(w, "alex", { status: "PAID", totalAmount: "50.00", amountPaid: "50.00" });
      const alex = listOf(await getList(w)).data.find((item) => item.name === "Alex Morgan");
      expect(alex?.outstandingBalance).toBe("0.00");
    });

    it("adds balances exactly, cent by cent", async () => {
      const w = await world();
      await makeInvoice(w, "alex", { status: "ISSUED", totalAmount: "0.30", amountPaid: "0.10" });
      await makeInvoice(w, "alex", { status: "ISSUED", totalAmount: "0.20", amountPaid: "0.00" });
      await makeInvoice(w, "alex", {
        status: "PARTIALLY_PAID",
        totalAmount: "1234567.89",
        amountPaid: "0.01",
      });
      const alex = listOf(await getList(w)).data.find((item) => item.name === "Alex Morgan");
      // 0.20 + 0.20 + 1234567.88
      expect(alex?.outstandingBalance).toBe("1234568.28");
    });

    it("runs the same number of queries for one customer or many (no query per row)", async () => {
      await mixedWorld();
      for (let index = 0; index < 12; index += 1) {
        await createLocalCustomer(prisma, {
          email: `more${index}@example.test`,
          name: `More ${index}`,
        });
      }

      const operations: string[][] = [];
      for (const pageSize of [1, 5, 14]) {
        const seen: string[] = [];
        const counting = prisma.$extends({
          query: {
            $allOperations({ model, operation, args, query }) {
              seen.push(`${model ?? "raw"}.${operation}`);
              return query(args);
            },
          },
        });
        const result = await listAdminCustomers(
          { prisma: counting as unknown as PrismaClient },
          { page: 1, pageSize, sort: "name", order: "asc" },
        );
        expect(result.data).toHaveLength(pageSize);
        operations.push(seen);
      }

      expect(operations[1]).toHaveLength(operations[0]?.length ?? -1);
      expect(operations[2]).toHaveLength(operations[0]?.length ?? -1);
      expect(operations[0]?.length).toBeLessThanOrEqual(8);
    });
  });
});

// ---------------------------------------------------------------------------------------------

describe("GET /admin/customers/:id: one customer (FR-030, FR-031)", () => {
  it("gives the contact details, every address with its access notes, and the dates", async () => {
    const w = await world();
    const response = await w.client.get(detailPath(w.alex.profile.id), { cookie: w.adminCookie });

    expect(response.status).toBe(200);
    const customer = customerOf(response);
    expect(customer).toMatchObject({
      id: w.alex.profile.id,
      name: "Alex Morgan",
      email: ALEX,
      phone: "(212) 555-0142",
      customerSince: w.alex.profile.createdAt.toISOString(),
      lastActivityAt: w.alex.profile.createdAt.toISOString(),
    });
    // The default first, then the other; the business sees the access notes (they are for the visit).
    expect(customer.addresses.map((address) => address.label)).toEqual(["Home", "Rental"]);
    expect(customer.addresses[0]).toMatchObject({
      id: w.alexHome.id,
      line1: "214 Larkspur Lane",
      city: "Harbor City",
      accessNotes: "Gate code 4821. Dog in the yard.",
      isDefault: true,
    });
    expect(customer.addresses[1]).toMatchObject({ city: "Port Elm", isDefault: false });
  });

  it("has exactly the documented fields", async () => {
    const w = await world();
    const customer = customerOf(
      await w.client.get(detailPath(w.alex.profile.id), { cookie: w.adminCookie }),
    );
    expect(Object.keys(customer).sort()).toEqual(
      [
        "addresses",
        "customerSince",
        "email",
        "id",
        "lastActivityAt",
        "name",
        "noteCount",
        "notes",
        "phone",
        "recent",
        "summary",
      ].sort(),
    );
    expect(Object.keys(customer.recent).sort()).toEqual([
      "invoices",
      "jobs",
      "quotations",
      "requests",
    ]);
    const text = JSON.stringify(customer);
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("googleSubject");
    expect(text).not.toContain(w.alex.user.id);
  });

  it("counts the customer's records and what they owe (G.2)", async () => {
    const w = await world();
    await makeRequest(w, "alex");
    await makeJob(w, "alex", { status: "SCHEDULED" });
    await makeJob(w, "alex", { status: "COMPLETED", completedAt: new Date() });
    await makeInvoice(w, "alex", {
      status: "PARTIALLY_PAID",
      totalAmount: "216.00",
      amountPaid: "100.50",
    });
    await makeInvoice(w, "alex", { status: "PAID", totalAmount: "50.00", amountPaid: "50.00" });

    const { summary } = customerOf(
      await w.client.get(detailPath(w.alex.profile.id), { cookie: w.adminCookie }),
    );
    expect(summary).toEqual({
      // 1 plain + 2 jobs + 2 invoices' jobs, each with its request and its accepted quotation.
      requestCount: 5,
      quotationCount: 4,
      jobCount: 4,
      openJobCount: 1,
      invoiceCount: 2,
      outstandingBalance: "115.50",
      currencyCode: "USD",
    });
  });

  it("carries the latest few of each kind, newest first", async () => {
    const w = await world();
    for (let index = 0; index < 7; index += 1) {
      await makeRequest(w, "alex", {
        submittedAt: new Date(`2026-10-0${index + 1}T10:00:00.000Z`),
        reference: `FF-2026-8000${index}`,
      });
    }
    const customer = customerOf(
      await w.client.get(detailPath(w.alex.profile.id), { cookie: w.adminCookie }),
    );

    expect(customer.recent.requests).toHaveLength(CUSTOMER_RECENT_COUNT);
    expect(customer.recent.requests.map((request) => request.reference)).toEqual([
      "FF-2026-80006",
      "FF-2026-80005",
      "FF-2026-80004",
      "FF-2026-80003",
      "FF-2026-80002",
    ]);
    expect(customer.summary.requestCount).toBe(7);
    expect(customer.recent.quotations).toEqual([]);
  });

  it("carries the same rows as the first page of each history", async () => {
    const w = await world();
    for (let index = 0; index < 3; index += 1) {
      await makeInvoice(w, "alex", { status: "ISSUED", totalAmount: `${index + 1}0.00` });
    }
    await makeJob(w, "alex", { status: "SCHEDULED" });
    const customer = customerOf(
      await w.client.get(detailPath(w.alex.profile.id), { cookie: w.adminCookie }),
    );

    for (const type of CUSTOMER_HISTORY_TYPES) {
      const history = bodyOf<CustomerHistoryResponse>(
        await getHistory(w, w.alex.profile.id, type, `&pageSize=${CUSTOMER_RECENT_COUNT}`),
      );
      expect(customer.recent[type], type).toEqual(history.data);
    }
  });

  it("answers 404 for a customer that does not exist, and 422 for something that is not an id", async () => {
    const w = await world();
    const missing = expectApiError(
      await w.client.get(detailPath(MISSING_ID), { cookie: w.adminCookie }),
      { status: 404, code: ErrorCode.NOT_FOUND },
    );
    expect(missing.message).toBeTruthy();
    for (const bad of ["alex", "FF-2026-00012", w.alex.user.id.slice(0, 20)]) {
      expectApiError(await w.client.get(detailPath(bad), { cookie: w.adminCookie }), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    }
  });

  it("answers an admin's own id 404: only customers have a customer page", async () => {
    const w = await world();
    expectApiError(await w.client.get(detailPath(w.admin.id), { cookie: w.adminCookie }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });

  it("shows only that customer's records, never another's (G.2)", async () => {
    const w = await world();
    const alexRequest = await makeRequest(w, "alex");
    const alexJob = await makeJob(w, "alex", { status: "SCHEDULED" });
    const alexInvoice = await makeInvoice(w, "alex", { status: "ISSUED", totalAmount: "108.00" });
    const priyaRequest = await makeRequest(w, "priya");
    const priyaJob = await makeJob(w, "priya", { status: "IN_PROGRESS" });
    const priyaInvoice = await makeInvoice(w, "priya", { status: "ISSUED", totalAmount: "999.00" });
    await prisma.customerNote.create({
      data: { customerId: w.priya.profile.id, authorUserId: w.admin.id, body: "Priya-only note." },
    });

    const alex = await w.client.get(detailPath(w.alex.profile.id), { cookie: w.adminCookie });
    const text = JSON.stringify(alex.body);
    const priyaIds = [
      priyaRequest.id,
      priyaJob.request.id,
      priyaJob.quotation.id,
      priyaJob.workOrder.id,
      priyaInvoice.invoice.id,
      priyaInvoice.request.id,
      w.priya.profile.id,
      w.priya.user.id,
    ];
    for (const id of priyaIds) {
      expect(text).not.toContain(id);
    }
    for (const priyaText of ["Priya", PRIYA, "Brookfield", "88 Mill Road", "999.00"]) {
      expect(text).not.toContain(priyaText);
    }
    // And Alex's own records are all there.
    expect(text).toContain(alexRequest.id);
    expect(text).toContain(alexJob.workOrder.id);
    expect(text).toContain(alexInvoice.invoice.id);
    expect(customerOf(alex).noteCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe("GET /admin/customers/:id/history: one kind of record at a time (FR-031)", () => {
  it("pages the requests, newest first", async () => {
    const w = await world();
    for (let index = 0; index < 5; index += 1) {
      await makeRequest(w, "alex", {
        submittedAt: new Date(`2026-10-0${index + 1}T10:00:00.000Z`),
        reference: `FF-2026-7000${index}`,
        status: index % 2 === 0 ? "SUBMITTED" : "UNDER_REVIEW",
      });
    }

    const first = bodyOf<CustomerHistoryResponse<"requests">>(
      await getHistory(w, w.alex.profile.id, "requests", "&pageSize=2"),
    );
    expect(first.data.map((request) => request.reference)).toEqual([
      "FF-2026-70004",
      "FF-2026-70003",
    ]);
    expect(first.pagination).toEqual({ page: 1, pageSize: 2, totalItems: 5, totalPages: 3 });
    expect(first.data[0]).toEqual<CustomerHistoryRequestDto>({
      id: expect.any(String) as string,
      reference: "FF-2026-70004",
      serviceName: "AC Repair",
      status: "SUBMITTED",
      preferredDate: "2026-11-10",
      preferredWindow: "MORNING",
      submittedAt: "2026-10-05T10:00:00.000Z",
    });

    const last = bodyOf<CustomerHistoryResponse<"requests">>(
      await getHistory(w, w.alex.profile.id, "requests", "&pageSize=2&page=3"),
    );
    expect(last.data.map((request) => request.reference)).toEqual(["FF-2026-70000"]);
  });

  it("lists quotations with their money and a link to the request", async () => {
    const w = await world();
    const chain = await makeJob(w, "alex");
    const history = bodyOf<CustomerHistoryResponse<"quotations">>(
      await getHistory(w, w.alex.profile.id, "quotations"),
    );
    expect(history.data).toHaveLength(1);
    expect(history.data[0]).toMatchObject({
      id: chain.quotation.id,
      reference: chain.quotation.reference,
      status: "ACCEPTED",
      totalAmount: "108.00",
      currencyCode: "USD",
      validUntil: "2026-12-01",
      sentAt: "2026-10-20T15:00:00.000Z",
      request: { id: chain.request.id, reference: chain.request.reference },
    });
  });

  it("lists jobs, scheduled or not, with a link to the request", async () => {
    const w = await world();
    const waiting = await makeJob(w, "alex", { status: "PENDING_SCHEDULING" });
    const booked = await makeJob(w, "alex", {
      status: "SCHEDULED",
      scheduledStart: new Date("2026-11-12T14:00:00.000Z"),
      scheduledEnd: new Date("2026-11-12T16:00:00.000Z"),
    });
    const history = bodyOf<CustomerHistoryResponse<"jobs">>(
      await getHistory(w, w.alex.profile.id, "jobs"),
    );
    const byId = new Map<string, CustomerHistoryJobDto>(history.data.map((job) => [job.id, job]));

    expect(history.pagination.totalItems).toBe(2);
    expect(byId.get(waiting.workOrder.id)).toMatchObject({
      status: "PENDING_SCHEDULING",
      scheduledStart: null,
      completedAt: null,
      serviceName: "AC Repair",
      request: { id: waiting.request.id, reference: waiting.request.reference },
    });
    expect(byId.get(booked.workOrder.id)).toMatchObject({
      status: "SCHEDULED",
      scheduledStart: "2026-11-12T14:00:00.000Z",
    });
  });

  it("lists invoices with what is paid and what is owed, drafts without a number", async () => {
    const w = await world();
    const part = await makeInvoice(w, "alex", {
      status: "PARTIALLY_PAID",
      totalAmount: "216.00",
      amountPaid: "100.50",
    });
    const draft = await makeInvoice(w, "alex", { status: "DRAFT", totalAmount: "77.00" });
    const paid = await makeInvoice(w, "alex", {
      status: "PAID",
      totalAmount: "50.00",
      amountPaid: "50.00",
    });

    const history = bodyOf<CustomerHistoryResponse<"invoices">>(
      await getHistory(w, w.alex.profile.id, "invoices"),
    );
    const byId = new Map<string, CustomerHistoryInvoiceDto>(
      history.data.map((invoice) => [invoice.id, invoice]),
    );

    expect(byId.get(part.invoice.id)).toMatchObject({
      invoiceNumber: part.invoice.invoiceNumber,
      status: "PARTIALLY_PAID",
      totalAmount: "216.00",
      amountPaid: "100.50",
      balanceDue: "115.50",
      currencyCode: "USD",
      dueDate: "2026-11-08",
      request: { id: part.request.id, reference: part.request.reference },
    });
    expect(byId.get(draft.invoice.id)).toMatchObject({
      invoiceNumber: null,
      status: "DRAFT",
      balanceDue: "0.00",
      dueDate: null,
      issuedAt: null,
    });
    expect(byId.get(paid.invoice.id)).toMatchObject({ status: "PAID", balanceDue: "0.00" });
  });

  it("answers an empty tab with no rows and a total of zero", async () => {
    const w = await world();
    for (const type of CUSTOMER_HISTORY_TYPES) {
      const response = await getHistory(w, w.alex.profile.id, type);
      expect(response.status, type).toBe(200);
      expect(bodyOf<CustomerHistoryResponse>(response)).toEqual({
        data: [],
        pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      });
    }
  });

  it("shows only that customer's records in every kind, even when both have some (G.2)", async () => {
    const w = await world();
    const alex = {
      request: await makeRequest(w, "alex"),
      job: await makeJob(w, "alex", { status: "SCHEDULED" }),
      invoice: await makeInvoice(w, "alex", { status: "ISSUED" }),
    };
    const priya = {
      request: await makeRequest(w, "priya"),
      job: await makeJob(w, "priya", { status: "SCHEDULED" }),
      invoice: await makeInvoice(w, "priya", { status: "ISSUED" }),
    };

    const idsOf = async (id: string, type: CustomerHistoryType) =>
      bodyOf<CustomerHistoryResponse>(await getHistory(w, id, type, "&pageSize=100")).data.map(
        (row) => row.id,
      );

    expect(await idsOf(w.alex.profile.id, "requests")).toEqual(
      expect.arrayContaining([alex.request.id, alex.job.request.id, alex.invoice.request.id]),
    );
    for (const type of CUSTOMER_HISTORY_TYPES) {
      const alexRows = await idsOf(w.alex.profile.id, type);
      const priyaRows = await idsOf(w.priya.profile.id, type);
      expect(alexRows.length, type).toBeGreaterThan(0);
      expect(priyaRows.length, type).toBeGreaterThan(0);
      expect(
        alexRows.filter((id) => priyaRows.includes(id)),
        type,
      ).toEqual([]);
    }
    // The totals are theirs too: a count over every customer would not equal the rows shown.
    for (const type of CUSTOMER_HISTORY_TYPES) {
      for (const owner of [w.alex, w.priya]) {
        const body = bodyOf<CustomerHistoryResponse>(
          await getHistory(w, owner.profile.id, type, "&pageSize=100"),
        );
        expect(body.pagination.totalItems, type).toBe(body.data.length);
      }
    }
    const everyPriyaId = [
      priya.request.id,
      priya.job.workOrder.id,
      priya.job.quotation.id,
      priya.invoice.invoice.id,
    ];
    const alexEverything = JSON.stringify([
      await idsOf(w.alex.profile.id, "requests"),
      await idsOf(w.alex.profile.id, "quotations"),
      await idsOf(w.alex.profile.id, "jobs"),
      await idsOf(w.alex.profile.id, "invoices"),
    ]);
    for (const id of everyPriyaId) {
      expect(alexEverything).not.toContain(id);
    }
  });

  it("answers 404 for a customer that does not exist", async () => {
    const w = await world();
    expectApiError(await getHistory(w, MISSING_ID, "requests"), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });

  it.each([
    ["no type", ""],
    ["an unknown type", "?type=payments"],
    ["a type in capitals", "?type=REQUESTS"],
    ["two types", "?type=requests&type=jobs"],
    ["a page size above 100", "?type=jobs&pageSize=101"],
    ["a page below 1", "?type=jobs&page=0"],
  ])("answers %s with 422", async (_name, query) => {
    const w = await world();
    expectApiError(
      await w.client.get(historyPath(w.alex.profile.id, query), { cookie: w.adminCookie }),
      { status: 422, code: ErrorCode.VALIDATION_ERROR },
    );
  });

  it("answers a customer id that is not an id with 422", async () => {
    const w = await world();
    expectApiError(
      await w.client.get(historyPath("alex", "?type=jobs"), { cookie: w.adminCookie }),
      { status: 422, code: ErrorCode.VALIDATION_ERROR },
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("POST /admin/customers/:id/notes: internal notes (FR-033, SEC-DATA-03)", () => {
  it("adds a note, answers with its author and time, and lists it on the customer", async () => {
    const w = await world();
    const response = await postNote(w, w.alex.profile.id, {
      body: "  Prefers calls after 5pm.\nDo not text.  ",
    });

    expect(response.status).toBe(201);
    const note = noteOf(response);
    expect(note).toEqual({
      id: expect.any(String) as string,
      body: "Prefers calls after 5pm.\nDo not text.",
      author: { name: "Morgan Reyes" },
      createdAt: expect.any(String) as string,
    });
    expect(Number.isNaN(Date.parse(note.createdAt))).toBe(false);

    const customer = customerOf(
      await w.client.get(detailPath(w.alex.profile.id), { cookie: w.adminCookie }),
    );
    expect(customer.noteCount).toBe(1);
    expect(customer.notes).toEqual([note]);
  });

  it("lists the notes newest first, each with its author", async () => {
    const w = await world();
    const second = await createLocalAdmin(prisma, { email: "second.admin@demo.fixflow.test" });
    await prisma.user.update({ where: { id: second.id }, data: { name: "Jordan Lee" } });
    await prisma.customerNote.create({
      data: {
        customerId: w.alex.profile.id,
        authorUserId: w.admin.id,
        body: "First.",
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
      },
    });
    await prisma.customerNote.create({
      data: {
        customerId: w.alex.profile.id,
        authorUserId: second.id,
        body: "Second.",
        createdAt: new Date("2026-10-02T10:00:00.000Z"),
      },
    });

    const { notes } = customerOf(
      await w.client.get(detailPath(w.alex.profile.id), { cookie: w.adminCookie }),
    );
    expect(notes.map((note) => [note.body, note.author.name])).toEqual([
      ["Second.", "Jordan Lee"],
      ["First.", "Morgan Reyes"],
    ]);
  });

  it("carries the latest notes only, and says how many there are", async () => {
    const w = await world();
    await prisma.customerNote.createMany({
      data: Array.from({ length: CUSTOMER_NOTES_SHOWN + 3 }, (_unused, index) => ({
        customerId: w.alex.profile.id,
        authorUserId: w.admin.id,
        body: `Note ${index}`,
        createdAt: new Date(Date.UTC(2026, 9, 1, 10, index)),
      })),
    });
    const customer = customerOf(
      await w.client.get(detailPath(w.alex.profile.id), { cookie: w.adminCookie }),
    );
    expect(customer.notes).toHaveLength(CUSTOMER_NOTES_SHOWN);
    expect(customer.noteCount).toBe(CUSTOMER_NOTES_SHOWN + 3);
    expect(customer.notes[0]?.body).toBe(`Note ${CUSTOMER_NOTES_SHOWN + 2}`);
  });

  it("keeps one customer's notes off another's page", async () => {
    const w = await world();
    await postNote(w, w.alex.profile.id, { body: "About Alex only." });
    const priya = customerOf(
      await w.client.get(detailPath(w.priya.profile.id), { cookie: w.adminCookie }),
    );
    expect(priya.notes).toEqual([]);
    expect(priya.noteCount).toBe(0);
  });

  it("records an internal activity event without the text of the note (G.3)", async () => {
    const w = await world();
    const text = "Owes us a favour. Handle with care.";
    const note = noteOf(await postNote(w, w.alex.profile.id, { body: text }));

    const events = await prisma.activityEvent.findMany();
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({
      actorUserId: w.admin.id,
      entityType: "CUSTOMER",
      entityId: w.alex.profile.id,
      customerId: w.alex.profile.id,
      requestId: null,
      action: "customer.note_added",
      fromStatus: null,
      toStatus: null,
      // Staff-only: with no customer summary no customer timeline can show it.
      publicSummary: null,
      metadata: {},
    });
    expect(event?.summary).toBe("Morgan Reyes added an internal note about Alex Morgan.");
    expect(JSON.stringify(event)).not.toContain(text);
    expect(JSON.stringify(event)).not.toContain(note.id);
  });

  it("notifies no one and sends no email", async () => {
    const w = await world();
    await postNote(w, w.alex.profile.id, { body: "Private." });
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.emailDeliveryLog.count()).toBe(0);
  });

  it("answers 404 for a customer that does not exist and writes nothing", async () => {
    const w = await world();
    expectApiError(await postNote(w, MISSING_ID, { body: "Hello" }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expect(await footprint()).toEqual({ notes: 0, events: 0, notifications: 0, emails: 0 });
  });

  it("answers an id that is not an id with 422 and writes nothing", async () => {
    const w = await world();
    expectApiError(await postNote(w, "alex", { body: "Hello" }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(await footprint()).toEqual({ notes: 0, events: 0, notifications: 0, emails: 0 });
  });

  it.each([
    ["no body at all", {}, "body"],
    ["a blank note", { body: "   \n  " }, "body"],
    ["a note that is not text", { body: 42 }, "body"],
    ["a note over the limit", { body: "a".repeat(LIMITS.notes.maxLength + 1) }, "body"],
    ["a note with a control character", { body: "bad\u0000note" }, "body"],
  ])("answers %s with 422 and field errors, and writes nothing", async (_name, body, field) => {
    const w = await world();
    const error = expectApiError(await postNote(w, w.alex.profile.id, body), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(error.fieldErrors).toHaveProperty(field);
    expect(await footprint()).toEqual({ notes: 0, events: 0, notifications: 0, emails: 0 });
  });

  it.each([
    ["a visibility", { visibility: "CUSTOMER_VISIBLE" }],
    ["an author", { authorUserId: MISSING_ID }],
    ["a customer", { customerId: MISSING_ID }],
    ["a time", { createdAt: "2020-01-01T00:00:00.000Z" }],
  ])("refuses %s in the body and writes nothing", async (_name, extra) => {
    const w = await world();
    expectApiError(await postNote(w, w.alex.profile.id, { body: "A fine note.", ...extra }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(await footprint()).toEqual({ notes: 0, events: 0, notifications: 0, emails: 0 });
  });

  it("takes the author and the customer from the session and the address, not the body", async () => {
    const w = await world();
    const note = noteOf(await postNote(w, w.alex.profile.id, { body: "Mine." }));
    const stored = await prisma.customerNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(stored.authorUserId).toBe(w.admin.id);
    expect(stored.customerId).toBe(w.alex.profile.id);
  });

  it("is not limited to one note", async () => {
    const w = await world();
    for (const body of ["One.", "Two.", "Three."]) {
      expect((await postNote(w, w.alex.profile.id, { body })).status).toBe(201);
    }
    expect(await prisma.customerNote.count({ where: { customerId: w.alex.profile.id } })).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------

describe("internal customer notes never reach the customer (SEC-DATA-03, G.3)", () => {
  const SECRET = "ZEBRA-PRIVATE-NOTE-Do-not-serve-after-the-March-dispute";

  it("appears in no endpoint the customer can call", async () => {
    const w = await world();
    const request = await makeRequest(w, "alex");
    await postNote(w, w.alex.profile.id, { body: SECRET });
    expect(await prisma.customerNote.count()).toBe(1);

    const responses = {
      "/auth/me": await w.client.get("/api/v1/auth/me", { cookie: w.alexCookie }),
      "/customers/me": await w.client.get("/api/v1/customers/me", { cookie: w.alexCookie }),
      "/customers/me/addresses": await w.client.get("/api/v1/customers/me/addresses", {
        cookie: w.alexCookie,
      }),
      "/requests/me": await w.client.get("/api/v1/requests/me", { cookie: w.alexCookie }),
      "/requests/:id": await w.client.get(`/api/v1/requests/${request.id}`, {
        cookie: w.alexCookie,
      }),
      "/notifications/me": await w.client.get("/api/v1/notifications/me", { cookie: w.alexCookie }),
    };

    for (const [path, response] of Object.entries(responses)) {
      expect(response.status, path).toBe(200);
      expect(JSON.stringify(response.body), path).not.toContain(SECRET);
      expect(JSON.stringify(response.body), path).not.toContain("customer.note_added");
    }
    // Nor does the note show up as an event on the customer's own request history.
    const timeline = bodyOf<{ data: { timeline: unknown[] } }>(responses["/requests/:id"]).data
      .timeline;
    expect(JSON.stringify(timeline)).not.toContain("internal note");
  });

  it("leaves the customer's own views exactly as they were before the note", async () => {
    const w = await world();
    const request = await makeRequest(w, "alex");
    const paths = [
      "/api/v1/auth/me",
      "/api/v1/customers/me",
      "/api/v1/requests/me",
      `/api/v1/requests/${request.id}`,
      "/api/v1/notifications/me",
    ];
    const read = async () =>
      Promise.all(
        paths.map(
          async (path) => (await w.client.get(path, { cookie: w.alexCookie })).body as unknown,
        ),
      );

    const before = await read();
    await postNote(w, w.alex.profile.id, { body: SECRET });
    expect(await read()).toEqual(before);
  });

  it("does not reach the other customer either", async () => {
    const w = await world();
    await postNote(w, w.alex.profile.id, { body: SECRET });
    for (const path of [
      "/api/v1/customers/me",
      "/api/v1/requests/me",
      "/api/v1/notifications/me",
    ]) {
      const response = await w.client.get(path, { cookie: w.priyaCookie });
      expect(JSON.stringify(response.body), path).not.toContain(SECRET);
    }
  });

  it("does not let a customer read or write notes through the admin endpoints", async () => {
    const w = await world();
    await postNote(w, w.alex.profile.id, { body: SECRET });
    const read = await w.client.get(detailPath(w.alex.profile.id), { cookie: w.alexCookie });
    expectApiError(read, { status: 403, code: ErrorCode.FORBIDDEN });
    expect(JSON.stringify(read.body)).not.toContain(SECRET);
    expect(await prisma.customerNote.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the request page links to the customer (G.4)", () => {
  it("gives a customer id that opens the customer's page", async () => {
    const w = await world();
    const request = await makeRequest(w, "alex");

    const detail = bodyOf<{ data: { customer: { id: string; totalRequests: number } } }>(
      await w.client.get(`/api/v1/admin/requests/${request.id}`, { cookie: w.adminCookie }),
    ).data;
    expect(detail.customer.id).toBe(w.alex.profile.id);

    const customer = customerOf(
      await w.client.get(detailPath(detail.customer.id), { cookie: w.adminCookie }),
    );
    expect(customer.name).toBe("Alex Morgan");
    expect(customer.summary.requestCount).toBe(detail.customer.totalRequests);
    expect(customer.recent.requests.map((row) => row.id)).toContain(request.id);
  });
});
