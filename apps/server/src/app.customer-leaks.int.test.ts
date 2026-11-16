import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetDemoDatabase } from "./db/reset-demo.js";
import { FakeClock } from "./lib/clock.js";
import type { PrismaClient } from "./lib/db.js";
import { signInAs } from "./test/auth-helpers.js";
import { buildTestApp } from "./test/build-test-app.js";
import { databaseName, disconnectTestPrisma, getTestPrisma } from "./test/db.js";
import { api } from "./test/http.js";
import { asBinary, printedText } from "./test/pdf-text.js";

/**
 * The customer DTO leak tests (T25, FR-094, BR-19, API-07, D-41). The showcase data is seeded by the
 * application's own services, so it holds every kind of internal record a real business would: staff
 * notes on customers and requests, internal completion notes, cancellation and void reasons, payment
 * notes and references, who recorded each payment, staff names in the history, technicians' contact
 * details, and seven other customers. Signed in as each showcase customer who can sign in, every
 * customer-facing endpoint is read for every record they own, and:
 *
 * 1. every key path of every response is on an explicit allowlist for that endpoint (a key added to
 *    a customer serializer fails here until someone decides it is safe to show);
 * 2. no internal key (`summary`, `metadata`, `internalCompletionNote`, `visibility`, `recordedByUserId`,
 *    reasons, payment notes) appears anywhere;
 * 3. none of the internal values read back from the database, and nothing of another customer,
 *    appears anywhere in the raw body (or in the text of an invoice PDF).
 */

const prisma = getTestPrisma();
const DATABASE = databaseName("TEST_DATABASE_URL", process.env.TEST_DATABASE_URL ?? "");
const PASSWORDS = {
  admin: "Leak test admin pass 2026!",
  customer: "Leak test customer pass 2026!",
};
/** A Wednesday, mid-morning in New York, so the showcase has visits behind and ahead of it. */
const NOW = new Date("2026-09-16T14:00:00.000Z");
const CUSTOMERS = ["alex.morgan@example.test", "priya.shah@example.test"] as const;

type Kind =
  | "auth.me"
  | "customers.me"
  | "customers.overview"
  | "customers.addresses"
  | "requests.list"
  | "requests.detail"
  | "quotations.list"
  | "quotations.detail"
  | "work-orders.list"
  | "work-orders.detail"
  | "invoices.list"
  | "invoices.detail"
  | "notifications.list"
  | "settings.public"
  | "services.list"
  | "services.detail";

/** `prefix` itself and `prefix.key` for each key. */
function shape(prefix: string, keys: readonly string[]): string[] {
  return [prefix, ...keys.map((key) => `${prefix}.${key}`)];
}

const PAGINATION = shape("pagination", ["page", "pageSize", "totalItems", "totalPages"]);
const POSTAL = ["line1", "line2", "city", "region", "postalCode"] as const;
/** A customer's own saved address: their access notes are theirs to read (D-36). */
const SAVED_ADDRESS = [
  ...POSTAL,
  "id",
  "label",
  "accessNotes",
  "isDefault",
  "createdAt",
  "updatedAt",
];
const BUSINESS = [
  ...shape("business", ["name", "tagline", "email", "phone", "logoKey", "logoUrl", "address"]),
  ...shape("business.address", POSTAL),
];
const DOCUMENT_LINE = [
  "id",
  "position",
  "description",
  "quantity",
  "unitPrice",
  "lineTotal",
  "taxable",
];
const TIMELINE_EVENT = ["id", "publicSummary", "toStatus", "actor", "createdAt"];
const REQUEST_ROW = [
  "id",
  "reference",
  "status",
  "statusLabel",
  "nextStep",
  "serviceName",
  "preferredDate",
  "preferredWindow",
  "submittedAt",
];
const QUOTATION_SUMMARY = [
  "id",
  "reference",
  "status",
  "statusLabel",
  "totalAmount",
  "currencyCode",
  "validUntil",
  "sentAt",
  "respondedAt",
  "replacedBy",
  "replacedBy.id",
  "replacedBy.reference",
];
const QUOTATION_ROW = [...QUOTATION_SUMMARY, "requestId", "requestReference", "serviceName"];
const JOB_ROW = [
  "id",
  "reference",
  "status",
  "statusLabel",
  "serviceName",
  "scheduledStart",
  "scheduledEnd",
  "technician",
  // A first name, nothing else (no id, phone or email).
  "technician.displayName",
  "completedAt",
];
const INVOICE_ROW = [
  "id",
  "invoiceNumber",
  "status",
  "statusLabel",
  "issueDate",
  "dueDate",
  "currencyCode",
  "totalAmount",
  "amountPaid",
  "balanceDue",
  "daysOverdue",
  "serviceName",
  "jobReference",
];
const SERVICE = [
  "id",
  "slug",
  "name",
  "category",
  "shortDescription",
  "fullDescription",
  "pricingMode",
  "startingPrice",
  "currencyCode",
  "estimatedDurationMinutes",
  "inclusions",
  "imageKey",
  "imageUrl",
];
const list = (keys: readonly string[]): string[] => [
  ...shape("data[]", keys).slice(1),
  "data",
  ...PAGINATION,
];
const section = (name: string, keys: readonly string[]): string[] => [
  ...shape(`data.${name}`, ["items", "totalItems"]),
  ...keys.map((key) => `data.${name}.items[].${key}`),
];

/**
 * What each customer-facing endpoint may contain, as key paths (`a.b[].c`: key `c` of each element of
 * the array `a.b`). Reviewed key by key against the shared DTO types in T25 (`AuthMeDto`,
 * `CustomerProfileDto`, `CustomerOverviewDto`, `CustomerRequestDto`, `CustomerQuotationDto`,
 * `CustomerWorkOrderDto`, `CustomerInvoiceDto`, `NotificationDto`, `PublicSettingsDto`,
 * `PublicServiceDto`); widen only with a reason.
 */
const ALLOWED: Record<Kind, readonly string[]> = {
  "auth.me": [
    "data",
    ...shape("data.user", ["id", "name", "email", "avatarUrl", "role", "hasPassword", "hasGoogle"]),
    ...shape("data.customer", ["id", "phone"]),
  ],
  "customers.me": [
    ...shape("data", [
      "name",
      "email",
      "phone",
      "avatarUrl",
      "hasPassword",
      "hasGoogle",
      "passwordChangeLocked",
      "addresses",
    ]),
    ...SAVED_ADDRESS.map((key) => `data.addresses[].${key}`),
  ],
  "customers.addresses": ["data", ...SAVED_ADDRESS.map((key) => `data[].${key}`)],
  "customers.overview": [
    "data",
    "data.actionRequired",
    ...section("actionRequired.quotations", QUOTATION_ROW),
    ...section("actionRequired.invoices", INVOICE_ROW),
    ...section("upcomingVisits", JOB_ROW),
    ...section("recentRequests", REQUEST_ROW),
    ...shape("data.counts", ["actionRequired", "upcomingVisits", "requests"]),
  ],
  "requests.list": list(REQUEST_ROW),
  "requests.detail": [
    ...shape("data", [
      ...REQUEST_ROW,
      "description",
      "address",
      "preferredStart",
      "preferredEnd",
      "cancellation",
      "quotations",
      "job",
      "notes",
      "timeline",
    ]),
    // The request's own address copy, with the access notes the customer wrote.
    ...shape("data.address", [...POSTAL, "accessNotes"]).slice(1),
    ...shape("data.cancellation", ["cancelledAt", "message"]).slice(1),
    ...QUOTATION_SUMMARY.map((key) => `data.quotations[].${key}`),
    ...shape("data.job", ["id", "reference", "status", "statusLabel"]).slice(1),
    // Shared notes only: `{ id, body, author: "You" | business name, createdAt }`.
    ...["id", "body", "author", "createdAt"].map((key) => `data.notes[].${key}`),
    ...TIMELINE_EVENT.map((key) => `data.timeline[].${key}`),
  ],
  "quotations.list": list(QUOTATION_ROW),
  "quotations.detail": [
    ...shape("data", [
      "id",
      "reference",
      "status",
      "statusLabel",
      "requestId",
      "requestReference",
      "serviceName",
      "customerName",
      "address",
      "currencyCode",
      "taxRate",
      "subtotal",
      "discountAmount",
      "taxableBase",
      "taxAmount",
      "totalAmount",
      "validUntil",
      "terms",
      "customerNote",
      "sentAt",
      "respondedAt",
      "replacedBy",
      "preview",
      "lines",
      "business",
    ]),
    ...shape("data.address", POSTAL).slice(1),
    ...shape("data.replacedBy", ["id", "reference"]).slice(1),
    ...DOCUMENT_LINE.map((key) => `data.lines[].${key}`),
    ...BUSINESS.map((key) => `data.${key}`),
  ],
  "work-orders.list": list(JOB_ROW),
  "work-orders.detail": [
    ...shape("data", [
      ...JOB_ROW,
      "statusExplanation",
      "timeZone",
      "scopeDescription",
      "address",
      "previouslyScheduled",
      "startedAt",
      "cancelledAt",
      "completionNote",
      "request",
      "quotation",
      "invoice",
      "timeline",
    ]),
    ...shape("data.address", [...POSTAL, "accessNotes"]).slice(1),
    ...shape("data.previouslyScheduled", ["start", "end"]).slice(1),
    ...shape("data.request", ["id", "reference"]).slice(1),
    ...shape("data.quotation", ["id", "reference"]).slice(1),
    ...shape("data.invoice", ["id", "invoiceNumber", "status", "statusLabel"]).slice(1),
    ...TIMELINE_EVENT.map((key) => `data.timeline[].${key}`),
  ],
  "invoices.list": list(INVOICE_ROW),
  "invoices.detail": [
    ...shape("data", [
      ...INVOICE_ROW,
      "taxRate",
      "lines",
      "subtotal",
      "discountAmount",
      "taxableBase",
      "taxAmount",
      "customerNote",
      "business",
      "customer",
      "paymentInstructions",
      "footer",
      "job",
      "request",
      "payments",
      "paidOn",
      "voidedAt",
      "timeZone",
    ]),
    ...DOCUMENT_LINE.map((key) => `data.lines[].${key}`),
    ...BUSINESS.map((key) => `data.${key}`),
    ...shape("data.customer", ["name", "email", "address"]).slice(1),
    ...shape("data.customer.address", POSTAL).slice(1),
    ...shape("data.job", ["id", "reference"]).slice(1),
    ...shape("data.request", ["id", "reference"]).slice(1),
    // When, how and how much: no reference, notes, recorder or void reason (D-110).
    ...["id", "paymentDate", "method", "methodLabel", "amount"].map(
      (key) => `data.payments[].${key}`,
    ),
  ],
  "notifications.list": [
    ...list(["id", "type", "title", "message", "linkPath", "readAt", "createdAt"]),
    ...shape("meta", ["unreadCount", "timeZone"]),
  ],
  "settings.public": [
    ...shape("data", [
      "businessName",
      "tagline",
      "contactEmail",
      "phone",
      "address",
      "serviceAreaDescription",
      "logoKey",
      "logoUrl",
      "timeZone",
      "currencyCode",
    ]),
    ...shape("data.address", POSTAL).slice(1),
  ],
  "services.list": ["data", ...SERVICE.map((key) => `data[].${key}`)],
  "services.detail": shape("data", SERVICE),
};

/** Keys that must never be in a customer's payload, at any depth. */
const FORBIDDEN_KEYS = [
  "summary",
  "metadata",
  "internalCompletionNote",
  "internalNote",
  "internalNotes",
  "visibility",
  "recordedByUserId",
  "recordedBy",
  "cancelReason",
  "voidReason",
  "declineReason",
  "passwordHash",
  "customerId",
  "technicianId",
  "actorUserId",
  "availableActions",
] as const;

/** Every key path of a JSON value: object keys joined with dots, array elements as `[]`. */
function keyPaths(value: unknown, prefix = "", into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keyPaths(item, `${prefix}[]`, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      into.add(path);
      keyPaths(child, path, into);
    }
  }
  return into;
}

/** The internal values the seed wrote, read back from the database. */
async function internalValues(db: PrismaClient): Promise<string[]> {
  const values: (string | null | undefined)[] = [];
  for (const note of await db.customerNote.findMany({ select: { body: true } })) {
    values.push(note.body);
  }
  for (const note of await db.requestNote.findMany({
    where: { visibility: "INTERNAL" },
    select: { body: true },
  })) {
    values.push(note.body);
  }
  for (const request of await db.serviceRequest.findMany({ select: { cancelReason: true } })) {
    values.push(request.cancelReason);
  }
  for (const quotation of await db.quotation.findMany({ select: { voidReason: true } })) {
    values.push(quotation.voidReason);
  }
  for (const technician of await db.technician.findMany({
    select: { name: true, phone: true, email: true, notes: true },
  })) {
    // Customers see a technician's first name only.
    values.push(technician.name, technician.phone, technician.email, technician.notes);
  }
  for (const job of await db.workOrder.findMany({
    select: { internalCompletionNote: true, cancelReason: true },
  })) {
    values.push(job.internalCompletionNote, job.cancelReason);
  }
  for (const invoice of await db.invoice.findMany({ select: { voidReason: true } })) {
    values.push(invoice.voidReason);
  }
  for (const payment of await db.paymentRecord.findMany({
    select: { notes: true, reference: true, voidReason: true, recordedByUserId: true },
  })) {
    values.push(payment.notes, payment.reference, payment.voidReason, payment.recordedByUserId);
  }
  const events = await db.activityEvent.findMany({
    select: { summary: true, publicSummary: true },
  });
  const publicSummaries = new Set(events.map((event) => event.publicSummary));
  for (const event of events) {
    // The staff sentence ("Morgan Reyes sent quotation …"), unless it happens to be the public one.
    if (!publicSummaries.has(event.summary)) values.push(event.summary);
  }
  for (const admin of await db.user.findMany({
    where: { role: "BUSINESS_ADMIN" },
    select: { id: true, name: true, email: true },
  })) {
    values.push(admin.id, admin.name, admin.email);
  }
  return [...new Set(values.filter((value): value is string => (value ?? "").length >= 6))];
}

/** Everything that identifies another customer: their account, profile, addresses and records. */
async function otherCustomersValues(db: PrismaClient, email: string): Promise<string[]> {
  const others = await db.user.findMany({
    where: { role: "CUSTOMER", NOT: { email } },
    select: {
      id: true,
      name: true,
      email: true,
      customerProfile: {
        select: {
          id: true,
          phone: true,
          addresses: { select: { id: true, line1: true, accessNotes: true } },
          serviceRequests: {
            select: {
              id: true,
              reference: true,
              description: true,
              addressLine1: true,
              quotations: { select: { id: true, reference: true } },
              workOrder: {
                select: {
                  id: true,
                  reference: true,
                  invoices: { select: { id: true, invoiceNumber: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  const values: (string | null | undefined)[] = [];
  for (const other of others) {
    values.push(other.id, other.name, other.email);
    const profile = other.customerProfile;
    if (profile === null) continue;
    values.push(profile.id, profile.phone);
    for (const address of profile.addresses) {
      values.push(address.id, address.line1, address.accessNotes);
    }
    for (const request of profile.serviceRequests) {
      values.push(request.id, request.reference, request.description, request.addressLine1);
      for (const quotation of request.quotations) values.push(quotation.id, quotation.reference);
      if (request.workOrder !== null) {
        values.push(request.workOrder.id, request.workOrder.reference);
        for (const invoice of request.workOrder.invoices) {
          values.push(invoice.id, invoice.invoiceNumber);
        }
      }
    }
  }
  return [...new Set(values.filter((value): value is string => (value ?? "").length >= 6))];
}

interface Captured {
  kind: Kind;
  path: string;
  body: unknown;
  text: string;
}

let app: Express;
let internal: string[];
const captured = new Map<string, Captured[]>();
const pdfTexts = new Map<string, { path: string; text: string }[]>();

async function read(kind: Kind, path: string, cookie?: string): Promise<unknown> {
  const response = await api(app).get(path, { cookie });
  expect(response.status, `${path} answered ${String(response.status)}`).toBe(200);
  const body: unknown = response.body;
  return { kind, path, body, text: response.text };
}

/** Reads every customer-facing endpoint for everything one customer owns. */
async function crawl(email: string): Promise<Captured[]> {
  const cookie = await signInAs(app, email, PASSWORDS.customer);
  const out: Captured[] = [];
  const get = async (kind: Kind, path: string): Promise<unknown> => {
    const item = (await read(kind, path, cookie)) as Captured;
    out.push(item);
    return item.body;
  };
  const idsOf = (body: unknown): string[] =>
    ((body as { data: { id: string }[] }).data ?? []).map((row) => row.id);

  await get("auth.me", "/api/v1/auth/me");
  await get("customers.me", "/api/v1/customers/me");
  await get("customers.overview", "/api/v1/customers/me/overview");
  await get("customers.addresses", "/api/v1/customers/me/addresses");
  await get("notifications.list", "/api/v1/notifications/me?pageSize=100");

  for (const id of idsOf(await get("requests.list", "/api/v1/requests/me?pageSize=100"))) {
    await get("requests.detail", `/api/v1/requests/${id}`);
  }
  for (const id of idsOf(await get("quotations.list", "/api/v1/quotations/me?pageSize=100"))) {
    await get("quotations.detail", `/api/v1/quotations/${id}`);
  }
  for (const id of idsOf(await get("work-orders.list", "/api/v1/work-orders/me?pageSize=100"))) {
    await get("work-orders.detail", `/api/v1/work-orders/${id}`);
  }
  const pdfs: { path: string; text: string }[] = [];
  for (const id of idsOf(await get("invoices.list", "/api/v1/invoices/me?pageSize=100"))) {
    await get("invoices.detail", `/api/v1/invoices/${id}`);
    const path = `/api/v1/invoices/${id}/pdf`;
    const response = await asBinary(api(app).get(path, { cookie }));
    expect(response.status, path).toBe(200);
    pdfs.push({ path, text: await printedText(response.body as Buffer) });
  }
  pdfTexts.set(email, pdfs);
  return out;
}

beforeAll(async () => {
  await resetDemoDatabase(prisma, { expectedDatabase: DATABASE, passwords: PASSWORDS, now: NOW });
  app = buildTestApp({ prisma, clock: new FakeClock(NOW.toISOString()) }).app;
  internal = await internalValues(prisma);

  const publicReads: Captured[] = [];
  publicReads.push((await read("settings.public", "/api/v1/settings/public")) as Captured);
  const services = (await read("services.list", "/api/v1/services")) as Captured;
  publicReads.push(services);
  for (const service of (services.body as { data: { slug: string }[] }).data) {
    publicReads.push(
      (await read("services.detail", `/api/v1/services/slug/${service.slug}`)) as Captured,
    );
  }
  captured.set("public", publicReads);
  for (const email of CUSTOMERS) {
    captured.set(email, await crawl(email));
  }
}, 180_000);

afterAll(async () => {
  await disconnectTestPrisma();
});

describe("the data under test", () => {
  it("holds internal records of every kind, and records for each customer", () => {
    // If the seed stopped writing these, the searches below would pass without meaning anything.
    expect(internal.length).toBeGreaterThan(60);
    for (const email of CUSTOMERS) {
      const kinds = new Set((captured.get(email) ?? []).map((item) => item.kind));
      for (const kind of [
        "requests.detail",
        "quotations.detail",
        "work-orders.detail",
        "invoices.detail",
      ] as const) {
        expect(kinds.has(kind), `${email} has a ${kind}`).toBe(true);
      }
      expect((pdfTexts.get(email) ?? []).length, `${email} has an invoice PDF`).toBeGreaterThan(0);
    }
  });
});

describe.each(["public", ...CUSTOMERS])("what %s is sent", (who) => {
  const items = (): Captured[] => captured.get(who) ?? [];

  it("has only allowlisted keys in every response", () => {
    const unexpected = new Map<Kind, Set<string>>();
    for (const item of items()) {
      const allowed = new Set(ALLOWED[item.kind]);
      for (const path of keyPaths(item.body)) {
        if (!allowed.has(path)) {
          const set = unexpected.get(item.kind) ?? new Set<string>();
          set.add(path);
          unexpected.set(item.kind, set);
        }
      }
    }
    expect(
      Object.fromEntries([...unexpected].map(([kind, paths]) => [kind, [...paths].sort()])),
    ).toEqual({});
  });

  it("never has an internal key, at any depth", () => {
    const found: string[] = [];
    for (const item of items()) {
      for (const path of keyPaths(item.body)) {
        const key = path.split(".").at(-1)?.replace(/\[\]$/, "") ?? "";
        if ((FORBIDDEN_KEYS as readonly string[]).includes(key))
          found.push(`${item.path}: ${path}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("never contains an internal value", () => {
    const found: string[] = [];
    for (const item of items()) {
      for (const value of internal) {
        if (item.text.includes(value)) found.push(`${item.path}: ${value.slice(0, 60)}`);
      }
    }
    for (const pdf of who === "public" ? [] : (pdfTexts.get(who) ?? [])) {
      for (const value of internal) {
        if (pdf.text.includes(value)) found.push(`${pdf.path}: ${value.slice(0, 60)}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe.each(CUSTOMERS)("what %s is sent about other customers", (email) => {
  it("contains nothing that identifies another customer or their records", async () => {
    const others = await otherCustomersValues(prisma, email);
    expect(others.length).toBeGreaterThan(20);
    const found: string[] = [];
    for (const item of captured.get(email) ?? []) {
      for (const value of others) {
        if (item.text.includes(value)) found.push(`${item.path}: ${value.slice(0, 60)}`);
      }
    }
    for (const pdf of pdfTexts.get(email) ?? []) {
      for (const value of others) {
        if (pdf.text.includes(value)) found.push(`${pdf.path}: ${value.slice(0, 60)}`);
      }
    }
    expect(found).toEqual([]);
  });
});
