import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "../generated/prisma/client.js";
import { BUSINESS_SETTINGS_ID, type PrismaClient } from "../lib/db.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../test/db.js";
import { expectDbRejection, SqlState } from "../test/db-assertions.js";
import {
  createAddress,
  createAdmin,
  createBaseScenario,
  createCustomer,
  createFullScenario,
  createInvoice,
  createQuotation,
  createService,
  createServiceRequest,
  createUser,
  createWorkOrder,
} from "../test/fixtures.js";

/**
 * Every invariant here is enforced by PostgreSQL, not by application code (spec §12.3, §15.3,
 * NFR-08). Each test tries to break the rule directly with Prisma or raw SQL and asserts that the
 * database refuses, naming the constraint that fired.
 */

const prisma: PrismaClient = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const { UNIQUE_VIOLATION, CHECK_VIOLATION, FOREIGN_KEY_VIOLATION, RESTRICT_VIOLATION } = SqlState;

function settingsData(overrides: Record<string, unknown> = {}) {
  return {
    businessName: "CoolBreeze Home Services",
    contactEmail: "hello@coolbreeze.test",
    phone: "(212) 555-0142",
    addressLine1: "48 Harbor Point Road",
    city: "Harbor City",
    postalCode: "10001",
    currencyCode: "USD",
    timeZone: "America/New_York",
    defaultTaxRate: "8.00",
    quotationValidityDays: 14,
    invoiceDueDays: 14,
    ...overrides,
  };
}

describe("users", () => {
  it("rejects a second user with the same email", async () => {
    await createUser(prisma, { email: "alex.morgan@example.test" });

    await expectDbRejection(() => createUser(prisma, { email: "alex.morgan@example.test" }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "users_email_key",
    });
  });

  it.each(["Alex.Morgan@Example.test", " alex.morgan@example.test", "alex.morgan@example.test "])(
    "rejects the email %j because it is not normalized, so case or spacing cannot defeat uniqueness",
    async (email) => {
      await createUser(prisma, { email: "alex.morgan@example.test" });

      await expectDbRejection(() => createUser(prisma, { email }), {
        sqlState: CHECK_VIOLATION,
        constraint: "users_email_normalized_chk",
      });
    },
  );

  it("rejects an empty email", async () => {
    await expectDbRejection(() => createUser(prisma, { email: "" }), {
      sqlState: CHECK_VIOLATION,
      constraint: "users_email_normalized_chk",
    });
  });

  it("rejects a second user with the same Google subject", async () => {
    await createUser(prisma, { passwordHash: null, googleSubject: "google-sub-1" });

    await expectDbRejection(
      () => createUser(prisma, { passwordHash: null, googleSubject: "google-sub-1" }),
      { sqlState: UNIQUE_VIOLATION, constraint: "users_google_subject_key" },
    );
  });

  it("rejects a user with neither a password hash nor a Google subject", async () => {
    await expectDbRejection(() => createUser(prisma, { passwordHash: null }), {
      sqlState: CHECK_VIOLATION,
      constraint: "users_credential_chk",
    });
    await expectDbRejection(
      () =>
        prisma.$executeRaw`INSERT INTO users (email, name, role) VALUES ('raw@example.test', 'Raw', 'CUSTOMER')`,
      { sqlState: CHECK_VIOLATION, constraint: "users_credential_chk" },
    );
  });

  it("accepts a user with only a password, only Google, or both", async () => {
    await createUser(prisma, { passwordHash: "hash", googleSubject: null });
    await createUser(prisma, { passwordHash: null, googleSubject: "google-sub-2" });
    await createUser(prisma, { passwordHash: "hash", googleSubject: "google-sub-3" });

    expect(await prisma.user.count()).toBe(3);
  });

  it("allows many users with no Google subject (nulls do not collide)", async () => {
    await createUser(prisma);
    await createUser(prisma);

    expect(await prisma.user.count()).toBe(2);
  });
});

describe("business settings", () => {
  it("accepts the one settings row", async () => {
    const row = await prisma.businessSettings.create({ data: settingsData() });

    expect(row.id).toBe(BUSINESS_SETTINGS_ID);
  });

  it("rejects a second settings row with the same id", async () => {
    await prisma.businessSettings.create({ data: settingsData() });

    await expectDbRejection(() => prisma.businessSettings.create({ data: settingsData() }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "business_settings_pkey",
    });
  });

  it("rejects a settings row with any other id", async () => {
    await expectDbRejection(
      () =>
        prisma.businessSettings.create({
          data: settingsData({ id: "00000000-0000-4000-8000-000000000002" }),
        }),
      { sqlState: CHECK_VIOLATION, constraint: "business_settings_singleton_chk" },
    );
    // Raw SQL cannot sidestep it either, even with a freshly generated id.
    await expectDbRejection(
      () =>
        prisma.$executeRaw`INSERT INTO business_settings
          (id, business_name, contact_email, phone, address_line1, city, postal_code, currency_code, time_zone, default_tax_rate, quotation_validity_days, invoice_due_days)
          VALUES (gen_random_uuid(), 'Other', 'x@example.test', '555-0100', '1 Test St', 'City', '10001', 'USD', 'UTC', 0, 14, 14)`,
      { sqlState: CHECK_VIOLATION, constraint: "business_settings_singleton_chk" },
    );
  });

  it.each([
    ["a malformed currency code", { currencyCode: "usd" }, "business_settings_currency_code_chk"],
    ["a tax rate above 100", { defaultTaxRate: "100.01" }, "business_settings_tax_rate_chk"],
    ["a negative tax rate", { defaultTaxRate: "-1.00" }, "business_settings_tax_rate_chk"],
    [
      "zero quotation validity days",
      { quotationValidityDays: 0 },
      "business_settings_quotation_validity_days_chk",
    ],
    ["negative invoice due days", { invoiceDueDays: -1 }, "business_settings_invoice_due_days_chk"],
  ])("rejects %s", async (_what, overrides, constraint) => {
    await expectDbRejection(
      () => prisma.businessSettings.create({ data: settingsData(overrides) }),
      { sqlState: CHECK_VIOLATION, constraint },
    );
  });
});

describe("services", () => {
  it("rejects a FIXED-price service without a starting price", async () => {
    await expectDbRejection(
      () => createService(prisma, { pricingMode: "FIXED", startingPrice: null }),
      { sqlState: CHECK_VIOLATION, constraint: "services_fixed_price_chk" },
    );
    await expectDbRejection(() => createService(prisma, { pricingMode: "FIXED" }), {
      sqlState: CHECK_VIOLATION,
      constraint: "services_fixed_price_chk",
    });
  });

  it("accepts a FIXED service with a price and a QUOTE_REQUIRED service without one", async () => {
    await createService(prisma, { pricingMode: "FIXED", startingPrice: "129.00" });
    await createService(prisma, { pricingMode: "QUOTE_REQUIRED", startingPrice: null });

    expect(await prisma.service.count()).toBe(2);
  });

  it("rejects a duplicate slug", async () => {
    await createService(prisma, { slug: "ac-diagnostic-visit" });

    await expectDbRejection(() => createService(prisma, { slug: "ac-diagnostic-visit" }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "services_slug_key",
    });
  });

  it("rejects a negative starting price and a non-positive duration", async () => {
    await expectDbRejection(
      () => createService(prisma, { pricingMode: "FIXED", startingPrice: "-1.00" }),
      { sqlState: CHECK_VIOLATION, constraint: "services_starting_price_chk" },
    );
    await expectDbRejection(() => createService(prisma, { estimatedDurationMinutes: 0 }), {
      sqlState: CHECK_VIOLATION,
      constraint: "services_estimated_duration_chk",
    });
  });
});

describe("service addresses", () => {
  it("rejects two default addresses for one customer", async () => {
    const { profile } = await createCustomer(prisma);
    await createAddress(prisma, profile.id, { isDefault: true });

    await expectDbRejection(() => createAddress(prisma, profile.id, { isDefault: true }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "service_addresses_one_default_per_customer_key",
    });
  });

  it("rejects promoting a second address to default with an update", async () => {
    const { profile } = await createCustomer(prisma);
    await createAddress(prisma, profile.id, { isDefault: true });
    const second = await createAddress(prisma, profile.id, { isDefault: false });

    await expectDbRejection(
      () => prisma.serviceAddress.update({ where: { id: second.id }, data: { isDefault: true } }),
      {
        sqlState: UNIQUE_VIOLATION,
        constraint: "service_addresses_one_default_per_customer_key",
      },
    );
  });

  it("allows one default per customer and any number of other addresses", async () => {
    const first = await createCustomer(prisma);
    const second = await createCustomer(prisma);
    await createAddress(prisma, first.profile.id, { isDefault: true });
    await createAddress(prisma, first.profile.id, { isDefault: false });
    await createAddress(prisma, first.profile.id, { isDefault: false });
    await createAddress(prisma, second.profile.id, { isDefault: true });

    expect(await prisma.serviceAddress.count()).toBe(4);
  });
});

describe("service requests", () => {
  it("rejects a preferred window that ends before it starts", async () => {
    const { customer, service } = await createBaseScenario(prisma);

    await expectDbRejection(
      () =>
        createServiceRequest(prisma, {
          customerId: customer.id,
          serviceId: service.id,
          preferredStart: new Date("2026-11-10T17:00:00.000Z"),
          preferredEnd: new Date("2026-11-10T13:00:00.000Z"),
        }),
      { sqlState: CHECK_VIOLATION, constraint: "service_requests_preferred_window_chk" },
    );
  });

  it("rejects a duplicate submission key for one customer but allows it for another", async () => {
    const { customer, service } = await createBaseScenario(prisma);
    const other = await createCustomer(prisma);
    const submissionKey = "7c1b8f0e-2c5a-4e7a-9a52-0d3a7f9f2b11";
    await createServiceRequest(prisma, {
      customerId: customer.id,
      serviceId: service.id,
      submissionKey,
    });

    await expectDbRejection(
      () =>
        createServiceRequest(prisma, {
          customerId: customer.id,
          serviceId: service.id,
          submissionKey,
        }),
      {
        sqlState: UNIQUE_VIOLATION,
        constraint: "service_requests_customer_id_submission_key_key",
      },
    );
    await createServiceRequest(prisma, {
      customerId: other.profile.id,
      serviceId: service.id,
      submissionKey,
    });
  });

  it("allows many requests without a submission key", async () => {
    const { customer, service } = await createBaseScenario(prisma);
    await createServiceRequest(prisma, { customerId: customer.id, serviceId: service.id });
    await createServiceRequest(prisma, { customerId: customer.id, serviceId: service.id });

    expect(await prisma.serviceRequest.count()).toBe(3);
  });

  it("rejects a duplicate reference", async () => {
    const { customer, service, request } = await createBaseScenario(prisma);

    await expectDbRejection(
      () =>
        createServiceRequest(prisma, {
          customerId: customer.id,
          serviceId: service.id,
          reference: request.reference,
        }),
      { sqlState: UNIQUE_VIOLATION, constraint: "service_requests_reference_key" },
    );
  });

  it("keeps the request and its address snapshot when the saved address is deleted (D-36)", async () => {
    const { customer, service } = await createBaseScenario(prisma);
    const address = await createAddress(prisma, customer.id);
    const request = await createServiceRequest(prisma, {
      customerId: customer.id,
      serviceId: service.id,
      serviceAddressId: address.id,
    });

    await prisma.serviceAddress.delete({ where: { id: address.id } });

    const after = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.serviceAddressId).toBeNull();
    expect(after.addressLine1).toBe("214 Larkspur Lane");
  });
});

describe("quotations", () => {
  async function scenario() {
    const base = await createBaseScenario(prisma);
    const make = (overrides: Partial<Prisma.QuotationUncheckedCreateInput>) =>
      createQuotation(prisma, {
        requestId: base.request.id,
        customerId: base.customer.id,
        createdByUserId: base.admin.id,
        ...overrides,
      });
    return { ...base, make };
  }

  it("rejects a second SENT quotation for a request", async () => {
    const { make } = await scenario();
    await make({ status: "SENT", sentAt: new Date() });

    await expectDbRejection(() => make({ status: "SENT", sentAt: new Date() }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "quotations_one_sent_per_request_key",
    });
  });

  it("rejects a second DRAFT quotation for a request", async () => {
    const { make } = await scenario();
    await make({ status: "DRAFT" });

    await expectDbRejection(() => make({ status: "DRAFT" }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "quotations_one_draft_per_request_key",
    });
  });

  it("rejects a second ACCEPTED quotation for a request", async () => {
    const { make } = await scenario();
    await make({ status: "ACCEPTED", sentAt: new Date() });

    await expectDbRejection(() => make({ status: "ACCEPTED", sentAt: new Date() }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "quotations_one_accepted_per_request_key",
    });
  });

  it("rejects moving a second quotation into SENT with an update", async () => {
    const { make } = await scenario();
    await make({ status: "SENT", sentAt: new Date() });
    const draft = await make({ status: "DRAFT" });

    await expectDbRejection(
      () =>
        prisma.quotation.update({
          where: { id: draft.id },
          data: { status: "SENT", sentAt: new Date() },
        }),
      { sqlState: UNIQUE_VIOLATION, constraint: "quotations_one_sent_per_request_key" },
    );
  });

  it("allows one DRAFT, one SENT and any number of closed quotations per request", async () => {
    const { make } = await scenario();
    await make({ status: "SENT", sentAt: new Date() });
    await make({ status: "DRAFT" });
    await make({ status: "DECLINED", sentAt: new Date() });
    await make({ status: "EXPIRED", sentAt: new Date() });
    await make({ status: "DECLINED", sentAt: new Date() });
    await make({
      status: "VOID",
      sentAt: new Date(),
      voidedAt: new Date(),
      voidReason: "Replaced by a revised offer",
    });

    expect(await prisma.quotation.count()).toBe(6);
  });

  it("allows a SENT quotation on each of two requests", async () => {
    const { make, customer, service, admin } = await scenario();
    const otherRequest = await createServiceRequest(prisma, {
      customerId: customer.id,
      serviceId: service.id,
    });
    await make({ status: "SENT", sentAt: new Date() });
    await createQuotation(prisma, {
      requestId: otherRequest.id,
      customerId: customer.id,
      createdByUserId: admin.id,
      status: "SENT",
      sentAt: new Date(),
    });

    expect(await prisma.quotation.count({ where: { status: "SENT" } })).toBe(2);
  });

  it("allows a replacement to be replaced only once, and never by itself", async () => {
    const { make } = await scenario();
    const original = await make({
      status: "VOID",
      sentAt: new Date(),
      voidedAt: new Date(),
      voidReason: "Customer asked for changes",
    });
    await make({ status: "SENT", sentAt: new Date(), replacesQuotationId: original.id });

    await expectDbRejection(
      () => make({ status: "DECLINED", sentAt: new Date(), replacesQuotationId: original.id }),
      { sqlState: UNIQUE_VIOLATION, constraint: "quotations_replaces_quotation_id_key" },
    );
    await expectDbRejection(
      () =>
        prisma.quotation.update({
          where: { id: original.id },
          data: { replacesQuotationId: original.id },
        }),
      { sqlState: CHECK_VIOLATION, constraint: "quotations_not_self_replacement_chk" },
    );
  });

  it.each([
    ["a negative subtotal", { subtotal: "-0.01" }, "quotations_amounts_nonnegative_chk"],
    ["a negative tax amount", { taxAmount: "-1.00" }, "quotations_amounts_nonnegative_chk"],
    ["a negative total", { totalAmount: "-5.00" }, "quotations_amounts_nonnegative_chk"],
    ["a negative discount", { discountAmount: "-1.00" }, "quotations_amounts_nonnegative_chk"],
    [
      "a discount above the subtotal",
      { discountAmount: "100.01" },
      "quotations_discount_within_subtotal_chk",
    ],
    ["a tax rate above 100", { taxRate: "100.01" }, "quotations_tax_rate_chk"],
    ["a malformed currency code", { currencyCode: "US" }, "quotations_currency_code_chk"],
  ])("rejects %s", async (_what, overrides, constraint) => {
    const { make } = await scenario();

    await expectDbRejection(() => make(overrides), { sqlState: CHECK_VIOLATION, constraint });
  });

  it("requires a void quotation to record when and why it was voided", async () => {
    const { make } = await scenario();

    await expectDbRejection(() => make({ status: "VOID" }), {
      sqlState: CHECK_VIOLATION,
      constraint: "quotations_void_audit_chk",
    });
    await expectDbRejection(() => make({ status: "VOID", voidedAt: new Date() }), {
      sqlState: CHECK_VIOLATION,
      constraint: "quotations_void_audit_chk",
    });
  });

  it("rejects a duplicate reference", async () => {
    const { make } = await scenario();
    const first = await make({ status: "DECLINED", sentAt: new Date() });

    await expectDbRejection(
      () => make({ status: "DECLINED", sentAt: new Date(), reference: first.reference }),
      {
        sqlState: UNIQUE_VIOLATION,
        constraint: "quotations_reference_key",
      },
    );
  });

  describe("line items", () => {
    it.each([
      ["zero", "0.00"],
      ["a negative number", "-1.00"],
    ])("rejects a quantity of %s", async (_what, quantity) => {
      const { make } = await scenario();
      const quotation = await make({});

      await expectDbRejection(
        () =>
          prisma.quotationLineItem.create({
            data: {
              quotationId: quotation.id,
              position: 1,
              description: "Labour",
              quantity,
              unitPrice: "50.00",
              lineSubtotal: "0.00",
            },
          }),
        { sqlState: CHECK_VIOLATION, constraint: "quotation_line_items_quantity_chk" },
      );
    });

    it("rejects a negative unit price and a negative line subtotal", async () => {
      const { make } = await scenario();
      const quotation = await make({});

      await expectDbRejection(
        () =>
          prisma.quotationLineItem.create({
            data: {
              quotationId: quotation.id,
              position: 1,
              description: "Labour",
              quantity: "1.00",
              unitPrice: "-0.01",
              lineSubtotal: "0.00",
            },
          }),
        { sqlState: CHECK_VIOLATION, constraint: "quotation_line_items_unit_price_chk" },
      );
      await expectDbRejection(
        () =>
          prisma.quotationLineItem.create({
            data: {
              quotationId: quotation.id,
              position: 1,
              description: "Labour",
              quantity: "1.00",
              unitPrice: "1.00",
              lineSubtotal: "-1.00",
            },
          }),
        { sqlState: CHECK_VIOLATION, constraint: "quotation_line_items_line_subtotal_chk" },
      );
    });

    it("rejects two lines in the same position and removes lines with their quotation", async () => {
      const { make } = await scenario();
      const quotation = await make({});
      const line = {
        quotationId: quotation.id,
        position: 1,
        description: "Labour",
        quantity: "2.50",
        unitPrice: "40.00",
        lineSubtotal: "100.00",
      };
      await prisma.quotationLineItem.create({ data: line });

      await expectDbRejection(() => prisma.quotationLineItem.create({ data: line }), {
        sqlState: UNIQUE_VIOLATION,
        constraint: "quotation_line_items_quotation_id_position_key",
      });

      await prisma.quotation.delete({ where: { id: quotation.id } });
      expect(await prisma.quotationLineItem.count()).toBe(0);
    });
  });
});

describe("work orders", () => {
  async function scenario() {
    const base = await createBaseScenario(prisma);
    const quotation = await createQuotation(prisma, {
      requestId: base.request.id,
      customerId: base.customer.id,
      createdByUserId: base.admin.id,
      status: "ACCEPTED",
      sentAt: new Date(),
    });
    const make = (overrides: Partial<Prisma.WorkOrderUncheckedCreateInput> = {}) =>
      createWorkOrder(prisma, {
        requestId: base.request.id,
        quotationId: quotation.id,
        customerId: base.customer.id,
        serviceId: base.service.id,
        createdByUserId: base.admin.id,
        ...overrides,
      });
    return { ...base, quotation, make };
  }

  it("rejects a second work order for the same quotation", async () => {
    const { make, customer, service } = await scenario();
    await make();
    const otherRequest = await createServiceRequest(prisma, {
      customerId: customer.id,
      serviceId: service.id,
    });

    await expectDbRejection(() => make({ requestId: otherRequest.id }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "work_orders_quotation_id_key",
    });
  });

  it("rejects a second work order for the same request", async () => {
    const { make, request, customer, admin } = await scenario();
    await make();
    const otherQuotation = await createQuotation(prisma, {
      requestId: request.id,
      customerId: customer.id,
      createdByUserId: admin.id,
      status: "DRAFT",
    });

    await expectDbRejection(() => make({ quotationId: otherQuotation.id }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "work_orders_request_id_key",
    });
  });

  it("accepts a schedule that ends after it starts, or no schedule at all", async () => {
    const { make } = await scenario();

    const scheduled = await make({
      scheduledStart: new Date("2026-11-12T14:00:00.000Z"),
      scheduledEnd: new Date("2026-11-12T15:30:00.000Z"),
      status: "SCHEDULED",
    });

    expect(scheduled.scheduledEnd?.toISOString()).toBe("2026-11-12T15:30:00.000Z");
  });

  it("accepts a work order with no schedule yet", async () => {
    const { make } = await scenario();

    const pending = await make();

    expect(pending.scheduledStart).toBeNull();
    expect(pending.status).toBe("PENDING_SCHEDULING");
  });

  it.each([
    ["ends at the moment it starts", "2026-11-12T14:00:00.000Z", "2026-11-12T14:00:00.000Z"],
    ["ends before it starts", "2026-11-12T14:00:00.000Z", "2026-11-12T13:59:59.999Z"],
  ])("rejects an appointment that %s", async (_what, start, end) => {
    const { make } = await scenario();

    await expectDbRejection(
      () => make({ scheduledStart: new Date(start), scheduledEnd: new Date(end) }),
      { sqlState: CHECK_VIOLATION, constraint: "work_orders_schedule_chk" },
    );
  });

  it("rejects an appointment with only one of its two times", async () => {
    const { make } = await scenario();

    await expectDbRejection(() => make({ scheduledStart: new Date("2026-11-12T14:00:00.000Z") }), {
      sqlState: CHECK_VIOLATION,
      constraint: "work_orders_schedule_chk",
    });
    await expectDbRejection(() => make({ scheduledEnd: new Date("2026-11-12T14:00:00.000Z") }), {
      sqlState: CHECK_VIOLATION,
      constraint: "work_orders_schedule_chk",
    });
  });

  it("rejects rescheduling an existing work order to an invalid interval", async () => {
    const { make } = await scenario();
    const order = await make({
      scheduledStart: new Date("2026-11-12T14:00:00.000Z"),
      scheduledEnd: new Date("2026-11-12T15:00:00.000Z"),
    });

    await expectDbRejection(
      () =>
        prisma.workOrder.update({
          where: { id: order.id },
          data: { scheduledEnd: new Date("2026-11-12T13:00:00.000Z") },
        }),
      { sqlState: CHECK_VIOLATION, constraint: "work_orders_schedule_chk" },
    );
  });

  it("requires a cancelled work order to record when and why it was cancelled", async () => {
    const { make } = await scenario();

    await expectDbRejection(() => make({ status: "CANCELLED" }), {
      sqlState: CHECK_VIOLATION,
      constraint: "work_orders_cancel_audit_chk",
    });
    await expectDbRejection(() => make({ status: "CANCELLED", cancelledAt: new Date() }), {
      sqlState: CHECK_VIOLATION,
      constraint: "work_orders_cancel_audit_chk",
    });
  });
});

describe("invoices", () => {
  it("rejects a second non-VOID invoice for a work order", async () => {
    const { workOrder, customer, admin } = await createFullScenario(prisma);

    await expectDbRejection(
      () =>
        createInvoice(prisma, {
          workOrderId: workOrder.id,
          customerId: customer.id,
          createdByUserId: admin.id,
        }),
      { sqlState: UNIQUE_VIOLATION, constraint: "invoices_one_active_per_work_order_key" },
    );
  });

  it("rejects a second invoice in any live status, including a paid one", async () => {
    const { workOrder, customer, admin, invoice } = await createFullScenario(prisma);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        invoiceNumber: "INV-2026-00001",
        issuedAt: new Date(),
        issueDate: new Date("2026-11-20"),
        dueDate: new Date("2026-12-04"),
        amountPaid: "108.00",
      },
    });

    await expectDbRejection(
      () =>
        createInvoice(prisma, {
          workOrderId: workOrder.id,
          customerId: customer.id,
          createdByUserId: admin.id,
        }),
      { sqlState: UNIQUE_VIOLATION, constraint: "invoices_one_active_per_work_order_key" },
    );
  });

  it("allows a new draft once the earlier invoice is void", async () => {
    const { workOrder, customer, admin, invoice } = await createFullScenario(prisma);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: "Wrong line items" },
    });

    const replacement = await createInvoice(prisma, {
      workOrderId: workOrder.id,
      customerId: customer.id,
      createdByUserId: admin.id,
    });

    expect(replacement.status).toBe("DRAFT");
    expect(await prisma.invoice.count({ where: { workOrderId: workOrder.id } })).toBe(2);
  });

  it("allows any number of void invoices for one work order", async () => {
    const { workOrder, customer, admin, invoice } = await createFullScenario(prisma);
    const voidFields = {
      status: "VOID",
      voidedAt: new Date(),
      voidReason: "Issued in error",
    } as const;
    await prisma.invoice.update({ where: { id: invoice.id }, data: voidFields });
    await createInvoice(prisma, {
      workOrderId: workOrder.id,
      customerId: customer.id,
      createdByUserId: admin.id,
      ...voidFields,
    });
    await createInvoice(prisma, {
      workOrderId: workOrder.id,
      customerId: customer.id,
      createdByUserId: admin.id,
      ...voidFields,
    });

    expect(await prisma.invoice.count({ where: { workOrderId: workOrder.id } })).toBe(3);
  });

  it("rejects reviving a void invoice while another live one exists", async () => {
    const { workOrder, customer, admin, invoice } = await createFullScenario(prisma);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: "Wrong customer" },
    });
    await createInvoice(prisma, {
      workOrderId: workOrder.id,
      customerId: customer.id,
      createdByUserId: admin.id,
    });

    await expectDbRejection(
      () => prisma.invoice.update({ where: { id: invoice.id }, data: { status: "DRAFT" } }),
      { sqlState: UNIQUE_VIOLATION, constraint: "invoices_one_active_per_work_order_key" },
    );
  });

  it("rejects an amount paid above the invoice total", async () => {
    const { invoice } = await createFullScenario(prisma);

    await expectDbRejection(
      () => prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: "108.01" } }),
      { sqlState: CHECK_VIOLATION, constraint: "invoices_amount_paid_within_total_chk" },
    );
    // Paying exactly the total is fine.
    await prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: "108.00" } });
  });

  it.each([
    ["a negative subtotal", { subtotal: "-1.00" }],
    ["a negative tax amount", { taxAmount: "-0.01" }],
    ["a negative amount paid", { amountPaid: "-1.00" }],
  ])("rejects %s", async (_what, data) => {
    const { invoice } = await createFullScenario(prisma);

    await expectDbRejection(() => prisma.invoice.update({ where: { id: invoice.id }, data }), {
      sqlState: CHECK_VIOLATION,
      constraint: "invoices_amounts_nonnegative_chk",
    });
  });

  it("rejects a negative total (several rules apply; PostgreSQL reports the first by name)", async () => {
    const { invoice } = await createFullScenario(prisma);

    await expectDbRejection(
      () => prisma.invoice.update({ where: { id: invoice.id }, data: { totalAmount: "-108.00" } }),
      {
        sqlState: CHECK_VIOLATION,
        constraint: ["invoices_amount_paid_within_total_chk", "invoices_amounts_nonnegative_chk"],
      },
    );
    await expectDbRejection(
      () =>
        prisma.invoice.update({
          where: { id: invoice.id },
          data: { totalAmount: "-108.00", amountPaid: "-108.00" },
        }),
      { sqlState: CHECK_VIOLATION, constraint: "invoices_amounts_nonnegative_chk" },
    );
  });

  it("rejects a discount above the subtotal, a tax rate above 100 and a bad currency", async () => {
    const { invoice } = await createFullScenario(prisma);

    await expectDbRejection(
      () =>
        prisma.invoice.update({ where: { id: invoice.id }, data: { discountAmount: "100.01" } }),
      { sqlState: CHECK_VIOLATION, constraint: "invoices_discount_within_subtotal_chk" },
    );
    await expectDbRejection(
      () => prisma.invoice.update({ where: { id: invoice.id }, data: { taxRate: "100.01" } }),
      { sqlState: CHECK_VIOLATION, constraint: "invoices_tax_rate_chk" },
    );
    await expectDbRejection(
      () => prisma.invoice.update({ where: { id: invoice.id }, data: { currencyCode: "usd" } }),
      { sqlState: CHECK_VIOLATION, constraint: "invoices_currency_code_chk" },
    );
  });

  it("requires an issued invoice to carry its number and dates, and a sensible due date", async () => {
    const { invoice } = await createFullScenario(prisma);

    await expectDbRejection(
      () => prisma.invoice.update({ where: { id: invoice.id }, data: { status: "ISSUED" } }),
      { sqlState: CHECK_VIOLATION, constraint: "invoices_issued_fields_chk" },
    );
    await expectDbRejection(
      () =>
        prisma.invoice.update({
          where: { id: invoice.id },
          data: { issueDate: new Date("2026-11-20"), dueDate: new Date("2026-11-19") },
        }),
      { sqlState: CHECK_VIOLATION, constraint: "invoices_due_date_chk" },
    );
    const issued = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "ISSUED",
        invoiceNumber: "INV-2026-00001",
        issuedAt: new Date("2026-11-20T15:00:00.000Z"),
        issueDate: new Date("2026-11-20"),
        dueDate: new Date("2026-12-04"),
      },
    });
    expect(issued.status).toBe("ISSUED");
  });

  it("rejects a duplicate invoice number but allows many drafts without one", async () => {
    const first = await createFullScenario(prisma);
    const second = await createFullScenario(prisma);
    const issue = {
      status: "ISSUED",
      invoiceNumber: "INV-2026-00007",
      issuedAt: new Date(),
      issueDate: new Date("2026-11-20"),
      dueDate: new Date("2026-12-04"),
    } as const;
    await prisma.invoice.update({ where: { id: first.invoice.id }, data: issue });

    await expectDbRejection(
      () => prisma.invoice.update({ where: { id: second.invoice.id }, data: issue }),
      { sqlState: UNIQUE_VIOLATION, constraint: "invoices_invoice_number_key" },
    );
    expect(await prisma.invoice.count({ where: { invoiceNumber: null } })).toBe(1);
  });

  it("requires a void invoice to record when and why it was voided", async () => {
    const { invoice } = await createFullScenario(prisma);

    await expectDbRejection(
      () => prisma.invoice.update({ where: { id: invoice.id }, data: { status: "VOID" } }),
      { sqlState: CHECK_VIOLATION, constraint: "invoices_void_audit_chk" },
    );
  });

  describe("line items", () => {
    it.each([
      ["zero", "0.00"],
      ["a negative number", "-3.00"],
    ])("rejects a quantity of %s", async (_what, quantity) => {
      const { invoice } = await createFullScenario(prisma);

      await expectDbRejection(
        () =>
          prisma.invoiceLineItem.create({
            data: {
              invoiceId: invoice.id,
              position: 1,
              description: "Parts",
              quantity,
              unitPrice: "10.00",
              lineSubtotal: "0.00",
            },
          }),
        { sqlState: CHECK_VIOLATION, constraint: "invoice_line_items_quantity_chk" },
      );
    });

    it("rejects a negative unit price", async () => {
      const { invoice } = await createFullScenario(prisma);

      await expectDbRejection(
        () =>
          prisma.invoiceLineItem.create({
            data: {
              invoiceId: invoice.id,
              position: 1,
              description: "Parts",
              quantity: "1.00",
              unitPrice: "-10.00",
              lineSubtotal: "0.00",
            },
          }),
        { sqlState: CHECK_VIOLATION, constraint: "invoice_line_items_unit_price_chk" },
      );
    });
  });
});

describe("payment records", () => {
  async function scenario() {
    const full = await createFullScenario(prisma);
    const payment = (overrides: Record<string, unknown> = {}) =>
      prisma.paymentRecord.create({
        data: {
          invoiceId: full.invoice.id,
          amount: "50.00",
          paymentDate: new Date("2026-11-25"),
          method: "BANK_TRANSFER",
          recordedByUserId: full.admin.id,
          ...overrides,
        },
      });
    return { ...full, payment };
  }

  it.each([
    ["zero", "0.00"],
    ["a negative amount", "-10.00"],
  ])("rejects a payment of %s", async (_what, amount) => {
    const { payment } = await scenario();

    await expectDbRejection(() => payment({ amount }), {
      sqlState: CHECK_VIOLATION,
      constraint: "payment_records_amount_chk",
    });
  });

  it("accepts a positive payment", async () => {
    const { payment } = await scenario();

    expect((await payment({ amount: "0.01" })).amount.toFixed(2)).toBe("0.01");
  });

  it("requires a void to record who, when and why together", async () => {
    const { payment, admin } = await scenario();
    const recorded = await payment();
    const audit = {
      voidedAt: new Date(),
      voidedByUserId: admin.id,
      voidReason: "Recorded against the wrong invoice",
    };

    for (const partial of [
      { voidedAt: audit.voidedAt },
      { voidReason: audit.voidReason },
      { voidedByUserId: audit.voidedByUserId },
      { voidedAt: audit.voidedAt, voidedByUserId: audit.voidedByUserId },
    ]) {
      await expectDbRejection(
        () => prisma.paymentRecord.update({ where: { id: recorded.id }, data: partial }),
        { sqlState: CHECK_VIOLATION, constraint: "payment_records_void_audit_chk" },
      );
    }
    const voided = await prisma.paymentRecord.update({ where: { id: recorded.id }, data: audit });
    expect(voided.voidReason).toBe(audit.voidReason);
  });
});

describe("notifications, activity and references", () => {
  it.each([
    "https://evil.example.com/phish",
    "//evil.example.com",
    "/\\evil.example.com",
    "javascript:alert(1)",
    "app/requests/1",
    "",
  ])(
    "rejects the notification link %j because it is not a path inside the app",
    async (linkPath) => {
      const { customerUser } = await createBaseScenario(prisma);

      await expectDbRejection(
        () =>
          prisma.notification.create({
            data: {
              recipientUserId: customerUser.id,
              type: "QUOTATION_SENT",
              title: "Quotation ready",
              message: "Your quotation is ready to review.",
              linkPath,
            },
          }),
        { sqlState: CHECK_VIOLATION, constraint: "notifications_link_path_chk" },
      );
    },
  );

  it("accepts relative app paths", async () => {
    const { customerUser } = await createBaseScenario(prisma);

    for (const linkPath of ["/", "/portal/requests/abc", "/app/requests/abc?tab=notes"]) {
      await prisma.notification.create({
        data: {
          recipientUserId: customerUser.id,
          type: "QUOTATION_SENT",
          title: "Quotation ready",
          message: "Your quotation is ready to review.",
          linkPath,
        },
      });
    }
    expect(await prisma.notification.count()).toBe(3);
  });

  it("rejects activity metadata that is not a JSON object", async () => {
    const { admin, request } = await createBaseScenario(prisma);

    await expectDbRejection(
      () =>
        prisma.$executeRaw`INSERT INTO activity_events (actor_user_id, entity_type, entity_id, action, summary, metadata)
          VALUES (${admin.id}::uuid, 'SERVICE_REQUEST', ${request.id}::uuid, 'request.submitted', 'x', '[1,2]'::jsonb)`,
      { sqlState: CHECK_VIOLATION, constraint: "activity_events_metadata_object_chk" },
    );
  });

  it("rejects a reference counter that is not positive", async () => {
    await expectDbRejection(
      () => prisma.referenceCounter.create({ data: { type: "REQUEST", year: 2026, value: 0 } }),
      { sqlState: CHECK_VIOLATION, constraint: "reference_counters_value_chk" },
    );
  });

  it("rejects a second counter row for the same type and year", async () => {
    await prisma.referenceCounter.create({ data: { type: "REQUEST", year: 2026, value: 1 } });

    await expectDbRejection(
      () => prisma.referenceCounter.create({ data: { type: "REQUEST", year: 2026, value: 5 } }),
      { sqlState: UNIQUE_VIOLATION, constraint: "reference_counters_pkey" },
    );
    await prisma.referenceCounter.create({ data: { type: "REQUEST", year: 2027, value: 1 } });
    await prisma.referenceCounter.create({ data: { type: "QUOTATION", year: 2026, value: 1 } });
  });
});

describe("referential integrity", () => {
  it("refuses to delete a customer who has requests", async () => {
    const { customer } = await createBaseScenario(prisma);

    await expectDbRejection(() => prisma.customerProfile.delete({ where: { id: customer.id } }), {
      sqlState: RESTRICT_VIOLATION,
      constraint: "service_requests_customer_id_fkey",
    });
  });

  it("refuses to delete a user who authored history", async () => {
    const { admin } = await createFullScenario(prisma);

    await expectDbRejection(() => prisma.user.delete({ where: { id: admin.id } }), {
      sqlState: RESTRICT_VIOLATION,
      constraint: "quotations_created_by_user_id_fkey",
    });
  });

  it("refuses to delete a quotation that has a work order, or a work order that has an invoice", async () => {
    const { quotation, workOrder } = await createFullScenario(prisma);

    await expectDbRejection(() => prisma.quotation.delete({ where: { id: quotation.id } }), {
      sqlState: RESTRICT_VIOLATION,
      constraint: "work_orders_quotation_id_fkey",
    });
    await expectDbRejection(() => prisma.workOrder.delete({ where: { id: workOrder.id } }), {
      sqlState: RESTRICT_VIOLATION,
      constraint: "invoices_work_order_id_fkey",
    });
  });

  it("rejects a record that points at a missing parent", async () => {
    const { admin, customer } = await createBaseScenario(prisma);

    await expectDbRejection(
      () =>
        createQuotation(prisma, {
          requestId: "00000000-0000-4000-8000-0000000000ff",
          customerId: customer.id,
          createdByUserId: admin.id,
        }),
      { sqlState: FOREIGN_KEY_VIOLATION, constraint: "quotations_request_id_fkey" },
    );
  });

  it("removes sessions and reset tokens together with their user", async () => {
    const user = await createUser(prisma);
    await prisma.session.create({
      data: { tokenHash: "session-hash", userId: user.id, expiresAt: new Date("2030-01-01") },
    });
    await prisma.passwordResetToken.create({
      data: { tokenHash: "reset-hash", userId: user.id, expiresAt: new Date("2030-01-01") },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("rejects a duplicate session token hash", async () => {
    const user = await createUser(prisma);
    const data = { tokenHash: "same-hash", userId: user.id, expiresAt: new Date("2030-01-01") };
    await prisma.session.create({ data });

    await expectDbRejection(() => prisma.session.create({ data }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "sessions_token_hash_key",
    });
  });

  it("gives a customer exactly one profile", async () => {
    const { user } = await createCustomer(prisma);

    await expectDbRejection(() => prisma.customerProfile.create({ data: { userId: user.id } }), {
      sqlState: UNIQUE_VIOLATION,
      constraint: "customer_profiles_user_id_key",
    });
  });
});

describe("test fixtures", () => {
  it("create independent graphs, so tests cannot interfere through shared rows", async () => {
    await createFullScenario(prisma);
    await createFullScenario(prisma);

    expect(await prisma.workOrder.count()).toBe(2);
    expect(await prisma.invoice.count()).toBe(2);
    expect((await createAdmin(prisma)).role).toBe("BUSINESS_ADMIN");
    expect((await createService(prisma)).slug).toMatch(/^fixture-service-/);
  });
});
