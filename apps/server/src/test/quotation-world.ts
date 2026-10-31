import type {
  AdminQuotationDto,
  AdminRequestDto,
  QuotationLineBody,
  UpdateQuotationBody,
} from "@fixflow/shared";

import type { PrismaClient } from "../lib/db.js";
import { createLocalAdmin, createLocalCustomer, signInAs } from "./auth-helpers.js";
import { buildTestApp, type TestAppOverrides } from "./build-test-app.js";
import { createBusinessSettings, createService, createServiceRequest } from "./fixtures.js";
import { api } from "./http.js";

/**
 * A business with two customers, an admin, two services and a request, everyone signed in: what
 * the quotation integration tests start from. The clock starts at `TEST_START_TIME`
 * (2 March 2026, 04:00 in New York), so a new draft is valid until 16 March.
 */

export const ALEX = "alex.morgan@example.test";
export const PRIYA = "priya.shah@example.test";
export const ADMIN_QUOTATIONS = "/api/v1/admin/quotations";
export const ADMIN_REQUESTS = "/api/v1/admin/requests";
export const CUSTOMER_QUOTATIONS = "/api/v1/quotations";
export const MISSING_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

/** The three lines of the worked examples in D-19: subtotal 252.00, taxable 45.50. */
export const EXAMPLE_LINES: QuotationLineBody[] = [
  { description: "Diagnostic visit", quantity: "1", unitPrice: "79.00", taxable: false },
  { description: "Run capacitor", quantity: "1", unitPrice: "45.50", taxable: true },
  { description: "Labour", quantity: "1.5", unitPrice: "85.00", taxable: false },
];

/** An internal sentence that must never reach a customer, in any shape. */
export const INTERNAL_VOID_REASON = "Priced the wrong unit: the internal margin was far too low.";

export async function quotationWorld(prisma: PrismaClient, options: TestAppOverrides = {}) {
  await createBusinessSettings(prisma);
  const test = buildTestApp({ prisma, ...options });
  const alex = await createLocalCustomer(prisma, { email: ALEX, name: "Alex Morgan" });
  const priya = await createLocalCustomer(prisma, { email: PRIYA, name: "Priya Shah" });
  const admin = await createLocalAdmin(prisma);
  await prisma.user.update({ where: { id: admin.id }, data: { name: "Morgan Reyes" } });
  const service = await createService(prisma, { name: "AC Repair", slug: "ac-repair" });
  const fixedService = await createService(prisma, {
    name: "Gutter Cleaning",
    slug: "gutter-cleaning",
    pricingMode: "FIXED",
    startingPrice: "89.50",
  });
  const world = {
    ...test,
    prisma,
    client: api(test.app),
    alex,
    priya,
    admin,
    service,
    fixedService,
    alexCookie: await signInAs(test.app, ALEX),
    priyaCookie: await signInAs(test.app, PRIYA),
    adminCookie: await signInAs(test.app, admin.email),
  };
  return world;
}

export type QuotationWorld = Awaited<ReturnType<typeof quotationWorld>>;

let sequence = 0;

/** A request inserted directly, so a test can choose its status and owner. Under review by default. */
export function makeRequest(
  w: QuotationWorld,
  overrides: Partial<Parameters<typeof createServiceRequest>[1]> & {
    owner?: "alex" | "priya";
  } = {},
) {
  sequence += 1;
  const { owner = "alex", ...rest } = overrides;
  return createServiceRequest(w.prisma, {
    customerId: w[owner].profile.id,
    serviceId: w.service.id,
    serviceNameSnapshot: "AC Repair",
    reference: `FF-2026-8${String(sequence).padStart(4, "0")}`,
    status: "UNDER_REVIEW",
    ...rest,
  });
}

export const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

/** Starts a draft through the API and returns it. */
export async function startDraft(
  w: QuotationWorld,
  requestId: string,
  body: Record<string, unknown> = {},
): Promise<AdminQuotationDto> {
  const response = await w.client
    .post(`${ADMIN_REQUESTS}/${requestId}/quotations`, { cookie: w.adminCookie })
    .send(body);
  if (response.status !== 201) {
    throw new Error(
      `Creating a draft failed with ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  return dataOf<AdminQuotationDto>(response);
}

/** The body that saves `quotation` as it stands, with `overrides` on top. */
export function saveBody(
  quotation: Pick<
    AdminQuotationDto,
    "lines" | "discountAmount" | "taxRate" | "validUntil" | "terms" | "customerNote" | "updatedAt"
  >,
  overrides: Partial<UpdateQuotationBody> = {},
): UpdateQuotationBody {
  return {
    lines: quotation.lines.map(({ description, quantity, unitPrice, taxable }) => ({
      description,
      quantity,
      unitPrice,
      taxable,
    })),
    discountAmount: quotation.discountAmount,
    taxRate: quotation.taxRate,
    validUntil: quotation.validUntil,
    terms: quotation.terms,
    customerNote: quotation.customerNote,
    expectedUpdatedAt: quotation.updatedAt,
    ...overrides,
  };
}

/** Saves a draft through the API and returns it. */
export async function saveDraft(
  w: QuotationWorld,
  quotation: AdminQuotationDto,
  overrides: Partial<UpdateQuotationBody> = {},
): Promise<AdminQuotationDto> {
  const response = await w.client
    .patch(`${ADMIN_QUOTATIONS}/${quotation.id}`, { cookie: w.adminCookie })
    .send(saveBody(quotation, overrides));
  if (response.status !== 200) {
    throw new Error(
      `Saving a draft failed with ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  return dataOf<AdminQuotationDto>(response);
}

/** A draft with the example lines, ready to send. */
export async function readyDraft(
  w: QuotationWorld,
  requestId: string,
  overrides: Partial<UpdateQuotationBody> = {},
): Promise<AdminQuotationDto> {
  const draft = await startDraft(w, requestId);
  return saveDraft(w, draft, { lines: EXAMPLE_LINES, ...overrides });
}

export function sendRequest(w: QuotationWorld, id: string, cookie = w.adminCookie) {
  return w.client
    .post(`${ADMIN_QUOTATIONS}/${id}/send`, { cookie })
    .send({ expectedStatus: "DRAFT" });
}

/** A draft with the example lines, sent. */
export async function sentQuotation(
  w: QuotationWorld,
  requestId: string,
  overrides: Partial<UpdateQuotationBody> = {},
): Promise<AdminQuotationDto> {
  const draft = await readyDraft(w, requestId, overrides);
  const response = await sendRequest(w, draft.id);
  if (response.status !== 200) {
    throw new Error(`Sending failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
  await w.deps.emailDispatcher.idle();
  return dataOf<AdminQuotationDto>(response);
}

export function voidRequest(
  w: QuotationWorld,
  id: string,
  body: Record<string, unknown>,
  cookie = w.adminCookie,
) {
  return w.client.post(`${ADMIN_QUOTATIONS}/${id}/void`, { cookie }).send(body);
}

export async function getAdminRequest(
  w: QuotationWorld,
  requestId: string,
): Promise<AdminRequestDto> {
  const response = await w.client.get(`${ADMIN_REQUESTS}/${requestId}`, { cookie: w.adminCookie });
  return dataOf<AdminRequestDto>(response);
}

/** The stored rows of a quotation and its lines, as text, to prove a refusal changed nothing. */
export async function quotationSnapshot(prisma: PrismaClient, id: string): Promise<string> {
  const [row, lines] = await Promise.all([
    prisma.quotation.findUniqueOrThrow({ where: { id } }),
    prisma.quotationLineItem.findMany({ where: { quotationId: id }, orderBy: { position: "asc" } }),
  ]);
  return JSON.stringify({ row, lines });
}

/** Everything a quotation action may create, to prove a refusal left nothing behind. */
export async function footprint(w: Pick<QuotationWorld, "prisma" | "emails">) {
  const [quotations, lines, events, notifications, deliveries] = await Promise.all([
    w.prisma.quotation.count(),
    w.prisma.quotationLineItem.count(),
    w.prisma.activityEvent.count(),
    w.prisma.notification.count(),
    w.prisma.emailDeliveryLog.count(),
  ]);
  return { quotations, lines, events, notifications, deliveries, sent: w.emails.sent.length };
}
