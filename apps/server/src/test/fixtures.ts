import { DEMO_SETTINGS } from "../db/seed-data.js";
import type { Prisma } from "../generated/prisma/client.js";
import { BUSINESS_SETTINGS_ID, type PrismaClient } from "../lib/db.js";

/**
 * Minimal valid rows for integration tests. Each builder fills every required column with
 * fictional values and accepts overrides for the field a test is about. Rows are inserted
 * directly with Prisma (never through production code), as CLAUDE.md §11 asks for fixtures.
 */

let counter = 0;
/** A number that is unique within the test process, for unique columns. */
function next(): number {
  counter += 1;
  return counter;
}

const pad = (value: number): string => String(value).padStart(5, "0");

export const FIXTURE_TIME_ZONE = "America/New_York";

/** The one business-settings row, filled with the demo business unless a test overrides a field. */
export function createBusinessSettings(
  prisma: PrismaClient,
  overrides: Partial<Omit<Prisma.BusinessSettingsUncheckedCreateInput, "id">> = {},
) {
  return prisma.businessSettings.create({
    data: { id: BUSINESS_SETTINGS_ID, ...DEMO_SETTINGS, ...overrides },
  });
}

export function createUser(
  prisma: PrismaClient,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  const n = next();
  return prisma.user.create({
    data: {
      email: `user-${n}@example.test`,
      name: `Test User ${n}`,
      role: "CUSTOMER",
      passwordHash: "$argon2id$placeholder-not-a-real-hash",
      ...overrides,
    },
  });
}

export function createAdmin(
  prisma: PrismaClient,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  return createUser(prisma, { role: "BUSINESS_ADMIN", name: "Test Admin", ...overrides });
}

/** A customer user with its profile. */
export async function createCustomer(
  prisma: PrismaClient,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  const user = await createUser(prisma, { role: "CUSTOMER", ...overrides });
  const profile = await prisma.customerProfile.create({
    data: { userId: user.id, phone: "(212) 555-0100" },
  });
  return { user, profile };
}

export function createAddress(
  prisma: PrismaClient,
  customerId: string,
  overrides: Partial<Prisma.ServiceAddressUncheckedCreateInput> = {},
) {
  const n = next();
  return prisma.serviceAddress.create({
    data: {
      customerId,
      label: `Address ${n}`,
      line1: `${100 + n} Fixture Lane`,
      city: "Harbor City",
      region: "NY",
      postalCode: "10001",
      ...overrides,
    },
  });
}

export function createService(
  prisma: PrismaClient,
  overrides: Partial<Prisma.ServiceUncheckedCreateInput> = {},
) {
  const n = next();
  return prisma.service.create({
    data: {
      name: `Fixture Service ${n}`,
      slug: `fixture-service-${n}`,
      category: "General",
      shortDescription: "A fixture service.",
      fullDescription: "A fixture service used only by tests.",
      pricingMode: "QUOTE_REQUIRED",
      isPublished: true,
      ...overrides,
    },
  });
}

const ADDRESS_SNAPSHOT = {
  addressLine1: "214 Larkspur Lane",
  addressCity: "Harbor City",
  addressRegion: "NY",
  addressPostalCode: "10001",
} as const;

export function createServiceRequest(
  prisma: PrismaClient,
  input: {
    customerId: string;
    serviceId: string;
  } & Partial<Prisma.ServiceRequestUncheckedCreateInput>,
) {
  const n = next();
  return prisma.serviceRequest.create({
    data: {
      reference: `FF-2026-${pad(n)}`,
      serviceNameSnapshot: "Fixture Service",
      ...ADDRESS_SNAPSHOT,
      description: "The unit stopped cooling and makes a rattling noise when it starts.",
      preferredDate: new Date("2026-11-10"),
      preferredWindow: "MORNING",
      preferredStart: new Date("2026-11-10T13:00:00.000Z"),
      preferredEnd: new Date("2026-11-10T17:00:00.000Z"),
      ...input,
    },
  });
}

export function createQuotation(
  prisma: PrismaClient,
  input: {
    requestId: string;
    customerId: string;
    createdByUserId: string;
  } & Partial<Prisma.QuotationUncheckedCreateInput>,
) {
  const n = next();
  return prisma.quotation.create({
    data: {
      reference: `QT-2026-${pad(n)}`,
      currencyCode: "USD",
      taxRate: "8.00",
      subtotal: "100.00",
      discountAmount: "0.00",
      taxableBase: "100.00",
      taxAmount: "8.00",
      totalAmount: "108.00",
      validUntil: new Date("2026-12-01"),
      ...input,
    },
  });
}

export function createWorkOrder(
  prisma: PrismaClient,
  input: {
    requestId: string;
    quotationId: string;
    customerId: string;
    serviceId: string;
    createdByUserId: string;
  } & Partial<Prisma.WorkOrderUncheckedCreateInput>,
) {
  const n = next();
  return prisma.workOrder.create({
    data: {
      reference: `JOB-2026-${pad(n)}`,
      serviceNameSnapshot: "Fixture Service",
      ...ADDRESS_SNAPSHOT,
      scopeDescription: "Diagnose the fault and repair or quote the parts needed.",
      ...input,
    },
  });
}

export function createInvoice(
  prisma: PrismaClient,
  input: {
    workOrderId: string;
    customerId: string;
    createdByUserId: string;
  } & Partial<Prisma.InvoiceUncheckedCreateInput>,
) {
  return prisma.invoice.create({
    data: {
      currencyCode: "USD",
      taxRate: "8.00",
      subtotal: "100.00",
      discountAmount: "0.00",
      taxableBase: "100.00",
      taxAmount: "8.00",
      totalAmount: "108.00",
      ...input,
    },
  });
}

export function createTechnician(
  prisma: PrismaClient,
  overrides: Partial<Prisma.TechnicianUncheckedCreateInput> = {},
) {
  const n = next();
  return prisma.technician.create({
    data: { name: `Fixture Technician ${n}`, calendarColor: "blue", ...overrides },
  });
}

/** The graph most constraint tests start from: an admin, a customer, a service and a request. */
export async function createBaseScenario(prisma: PrismaClient) {
  const admin = await createAdmin(prisma);
  const { user: customerUser, profile: customer } = await createCustomer(prisma);
  const service = await createService(prisma);
  const request = await createServiceRequest(prisma, {
    customerId: customer.id,
    serviceId: service.id,
  });
  return { admin, customerUser, customer, service, request };
}

/** `base` plus a SENT quotation, an accepted quotation, a work order and an invoice for it. */
export async function createFullScenario(prisma: PrismaClient) {
  const base = await createBaseScenario(prisma);
  const quotation = await createQuotation(prisma, {
    requestId: base.request.id,
    customerId: base.customer.id,
    createdByUserId: base.admin.id,
    status: "ACCEPTED",
    sentAt: new Date("2026-11-01T15:00:00.000Z"),
  });
  const workOrder = await createWorkOrder(prisma, {
    requestId: base.request.id,
    quotationId: quotation.id,
    customerId: base.customer.id,
    serviceId: base.service.id,
    createdByUserId: base.admin.id,
  });
  const invoice = await createInvoice(prisma, {
    workOrderId: workOrder.id,
    customerId: base.customer.id,
    createdByUserId: base.admin.id,
  });
  return { ...base, quotation, workOrder, invoice };
}
