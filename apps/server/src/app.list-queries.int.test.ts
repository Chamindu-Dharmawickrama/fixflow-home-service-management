import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetDemoDatabase } from "./db/reset-demo.js";
import { FakeClock } from "./lib/clock.js";
import type { PrismaClient } from "./lib/db.js";
import { signInAs } from "./test/auth-helpers.js";
import { buildTestApp } from "./test/build-test-app.js";
import { databaseName, disconnectTestPrisma, getTestPrisma } from "./test/db.js";
import { api } from "./test/http.js";

/**
 * Performance sanity of the lists (T25, NFR-04, spec §16 "use pagination and avoid loading unbounded
 * record sets"), on the showcase data: every list endpoint, admin and customer, is paginated (a page
 * of 1 holds 1 row, `pageSize` above 100 is refused) and asks the database **the same questions for
 * a page of 1 row as for a page of 50** — a serializer that looked something up per row (N+1) would
 * add one query per row.
 */

const prisma = getTestPrisma();
const DATABASE = databaseName("TEST_DATABASE_URL", process.env.TEST_DATABASE_URL ?? "");
const PASSWORDS = { admin: "List query admin pass 2026!", customer: "List query customer 2026!" };
const NOW = new Date("2026-09-16T14:00:00.000Z");

const operations: string[] = [];
const counting = prisma.$extends({
  query: {
    $allOperations({ model, operation, args, query }) {
      operations.push(`${model ?? "raw"}.${operation}`);
      return query(args);
    },
  },
}) as unknown as PrismaClient;

let app: Express;
let adminCookie: string;
let customerCookie: string;

beforeAll(async () => {
  await resetDemoDatabase(prisma, { expectedDatabase: DATABASE, passwords: PASSWORDS, now: NOW });
  app = buildTestApp({ prisma: counting, clock: new FakeClock(NOW.toISOString()) }).app;
  adminCookie = await signInAs(app, "admin@demo.fixflow.test", PASSWORDS.admin);
  customerCookie = await signInAs(app, "alex.morgan@example.test", PASSWORDS.customer);

  // Alex has one invoice in the showcase; a page of one and a page of fifty would hold the same rows.
  // Give Alex a second, through the screens' own endpoints: withdraw the open invoice and issue a
  // new one for the same job (the withdrawn one stays in Alex's list, as the history it is).
  const open = await prisma.invoice.findFirstOrThrow({
    where: { status: "ISSUED", customer: { user: { email: "alex.morgan@example.test" } } },
    select: { id: true, workOrderId: true },
  });
  const client = api(app);
  const voided = await client
    .post(`/api/v1/admin/invoices/${open.id}/void`, { cookie: adminCookie })
    .send({ reason: "Issued with the wrong due date; replaced.", expectedStatus: "ISSUED" });
  expect(voided.status, JSON.stringify(voided.body)).toBe(200);
  const draft = await client
    .post(`/api/v1/admin/work-orders/${open.workOrderId}/invoice`, { cookie: adminCookie })
    .send({});
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const draftId = (draft.body as { data: { id: string } }).data.id;
  const issued = await client
    .post(`/api/v1/admin/invoices/${draftId}/issue`, { cookie: adminCookie })
    .send({ expectedStatus: "DRAFT" });
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
}, 120_000);

afterAll(async () => {
  await disconnectTestPrisma();
});

/**
 * `stretches`: two customer lists are read in ordered stretches (T15: the quotations awaiting an
 * answer, then the rest; T18: upcoming visits, jobs waiting for a time, then past ones). A larger page
 * may reach a later stretch and read it with one more `findMany`: one per stretch, never one per row.
 */
const LISTS: {
  path: string;
  who: "admin" | "customer";
  atLeast: number;
  stretches?: { model: string; count: number };
}[] = [
  { path: "/api/v1/admin/requests", who: "admin", atLeast: 3 },
  { path: "/api/v1/admin/work-orders", who: "admin", atLeast: 3 },
  { path: "/api/v1/admin/invoices", who: "admin", atLeast: 3 },
  { path: "/api/v1/admin/customers", who: "admin", atLeast: 3 },
  { path: "/api/v1/admin/technicians", who: "admin", atLeast: 3 },
  { path: "/api/v1/admin/services", who: "admin", atLeast: 3 },
  { path: "/api/v1/requests/me", who: "customer", atLeast: 3 },
  {
    path: "/api/v1/quotations/me",
    who: "customer",
    atLeast: 2,
    stretches: { model: "Quotation", count: 2 },
  },
  {
    path: "/api/v1/work-orders/me",
    who: "customer",
    atLeast: 2,
    stretches: { model: "WorkOrder", count: 3 },
  },
  { path: "/api/v1/invoices/me", who: "customer", atLeast: 2 },
  { path: "/api/v1/notifications/me", who: "customer", atLeast: 3 },
];

async function read(path: string, who: "admin" | "customer") {
  const response = await api(app).get(path, {
    cookie: who === "admin" ? adminCookie : customerCookie,
  });
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(200);
  return response.body as { data: unknown[]; pagination: { totalItems: number; pageSize: number } };
}

/** What `a` holds that `b` does not, counting repeats. */
function minus(a: readonly string[], b: readonly string[]): string[] {
  const rest = [...b];
  return a.filter((item) => {
    const index = rest.indexOf(item);
    if (index === -1) return true;
    rest.splice(index, 1);
    return false;
  });
}

describe.each(LISTS)("$path", ({ path, who, atLeast, stretches }) => {
  it("is paginated and refuses a page larger than 100", async () => {
    const small = await read(`${path}?pageSize=1`, who);
    expect(small.pagination.totalItems).toBeGreaterThanOrEqual(atLeast);
    expect(small.data.length).toBe(1);
    expect(small.pagination.pageSize).toBe(1);
    const tooLarge = await api(app).get(`${path}?pageSize=101`, {
      cookie: who === "admin" ? adminCookie : customerCookie,
    });
    expect(tooLarge.status).toBe(422);
  });

  it("asks the database the same questions for a page of 1 as for a page of 50 (no N+1)", async () => {
    operations.length = 0;
    const small = await read(`${path}?pageSize=1`, who);
    const forSmall = [...operations];
    operations.length = 0;
    const large = await read(`${path}?pageSize=50`, who);
    const forLarge = [...operations];

    // The larger page really holds more rows, so a per-row lookup would show.
    expect(large.data.length).toBeGreaterThan(small.data.length);
    if (stretches === undefined) {
      expect(forLarge).toEqual(forSmall);
      return;
    }
    // Everything the small page asked is asked again; the only extra is a later stretch's read.
    expect(minus(forSmall, forLarge)).toEqual([]);
    const stretchRead = `${stretches.model}.findMany`;
    expect(minus(forLarge, forSmall).every((operation) => operation === stretchRead)).toBe(true);
    expect(forLarge.filter((operation) => operation === stretchRead).length).toBeLessThanOrEqual(
      stretches.count,
    );
  });
});
