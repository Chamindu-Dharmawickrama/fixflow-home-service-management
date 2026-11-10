import { InvoiceStatus, PaymentMethod } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { Prisma } from "../../generated/prisma/client.js";
import {
  CUSTOMER_INVOICE_DETAIL_SELECT,
  CUSTOMER_INVOICE_LIST_SELECT,
  CUSTOMER_JOB_INVOICE_SELECT,
  type CustomerInvoiceDetailRow,
  type CustomerJobInvoiceRow,
  toCustomerInvoiceDto,
  toCustomerInvoiceListItem,
  toCustomerJobInvoiceLink,
  toInvoicePdfSnapshot,
} from "./invoices.customer.dto.js";
import type { InvoiceSettingsRow } from "./invoices.dto.js";

const D = (value: string) => new Prisma.Decimal(value);

const CONTEXT = { now: new Date("2026-03-10T15:00:00.000Z"), timeZone: "America/New_York" };

const SETTINGS: InvoiceSettingsRow = {
  businessName: "CoolBreeze Home Services",
  tagline: null,
  logoKey: "breeze",
  logoUrl: null,
  contactEmail: "hello@coolbreeze.example",
  phone: "(555) 010-2030",
  addressLine1: "100 Harbor Street",
  addressLine2: null,
  city: "Brookhaven",
  region: "NY",
  postalCode: "11719",
  timeZone: "America/New_York",
  currencyCode: "USD",
  invoiceDueDays: 14,
  invoiceFooter: "Live footer",
  paymentInstructions: "Live instructions",
};

const SNAPSHOT_ADDRESS = {
  line1: "1 Snapshot Way",
  line2: null,
  city: "Brookhaven",
  region: "NY",
  postalCode: "11719",
};

function row(overrides: Partial<CustomerInvoiceDetailRow> = {}): CustomerInvoiceDetailRow {
  return {
    id: "invoice-1",
    invoiceNumber: "INV-2026-00012",
    customerId: "customer-1",
    status: InvoiceStatus.ISSUED,
    currencyCode: "USD",
    taxRate: D("0"),
    subtotal: D("300"),
    discountAmount: D("0"),
    taxableBase: D("0"),
    taxAmount: D("0"),
    totalAmount: D("300"),
    amountPaid: D("0"),
    issueDate: new Date("2026-03-02T00:00:00.000Z"),
    dueDate: new Date("2026-03-16T00:00:00.000Z"),
    issuedAt: new Date("2026-03-02T15:00:00.000Z"),
    voidedAt: null,
    customerNote: null,
    businessSnapshot: {
      name: "Snapshot Name",
      tagline: null,
      logoKey: null,
      logoUrl: null,
      email: "snap@example.test",
      phone: "(555) 000-0000",
      address: SNAPSHOT_ADDRESS,
    },
    customerSnapshot: {
      name: "Alex Morgan",
      email: "alex@example.test",
      address: SNAPSHOT_ADDRESS,
    },
    paymentInstructionsSnapshot: "Snapshot instructions",
    footerSnapshot: "Snapshot footer",
    customer: { user: { name: "Live Name", email: "live@example.test" } },
    lineItems: [
      {
        id: "line-1",
        position: 1,
        description: "Service call",
        quantity: D("1"),
        unitPrice: D("300"),
        taxable: false,
        lineSubtotal: D("300"),
      },
    ],
    payments: [],
    workOrder: {
      id: "job-1",
      reference: "JOB-2026-00003",
      serviceNameSnapshot: "AC Repair",
      addressLine1: "9 Live Street",
      addressLine2: null,
      addressCity: "Brookhaven",
      addressRegion: "NY",
      addressPostalCode: "11719",
      request: { id: "request-1", reference: "FF-2026-00004" },
    },
    ...overrides,
  };
}

const payment = (amount: string, paymentDate: string, id = `payment-${paymentDate}`) => ({
  id,
  amount: D(amount),
  paymentDate: new Date(`${paymentDate}T00:00:00.000Z`),
  method: PaymentMethod.CASH,
});

describe("what the customer's queries read (D-41, BR-19)", () => {
  const FORBIDDEN = [
    "createdBy",
    "createdByUserId",
    "issuedBy",
    "issuedByUserId",
    "voidedBy",
    "voidedByUserId",
    "voidReason",
    "quotation",
    "quotationId",
    "createdAt",
    "updatedAt",
  ];

  it.each([
    ["the list", CUSTOMER_INVOICE_LIST_SELECT],
    ["the detail", CUSTOMER_INVOICE_DETAIL_SELECT],
    ["the job's link", CUSTOMER_JOB_INVOICE_SELECT],
  ])("%s selects no staff, no void reason and no internal column", (_name, select) => {
    for (const column of FORBIDDEN) {
      expect(Object.keys(select), column).not.toContain(column);
    }
  });

  it("reads a payment's date, method and amount, never its reference, notes, recorder or void reason", () => {
    expect(Object.keys(CUSTOMER_INVOICE_DETAIL_SELECT.payments.select).sort()).toEqual([
      "amount",
      "id",
      "method",
      "paymentDate",
    ]);
  });

  it("reads only the payments that stand: a voided payment is never fetched", () => {
    expect(CUSTOMER_INVOICE_DETAIL_SELECT.payments.where).toEqual({ voidedAt: null });
  });
});

describe("toCustomerInvoiceDto", () => {
  it("builds the customer's invoice from the issue-time snapshot, not the live records", () => {
    const dto = toCustomerInvoiceDto({ row: row(), context: CONTEXT, settings: SETTINGS });
    expect(dto.business.name).toBe("Snapshot Name");
    expect(dto.customer.address.line1).toBe("1 Snapshot Way");
    expect(dto.paymentInstructions).toBe("Snapshot instructions");
    expect(dto.footer).toBe("Snapshot footer");
    expect(dto).toMatchObject({
      invoiceNumber: "INV-2026-00012",
      issueDate: "2026-03-02",
      dueDate: "2026-03-16",
      status: InvoiceStatus.ISSUED,
      balanceDue: "300.00",
      serviceName: "AC Repair",
      jobReference: "JOB-2026-00003",
      job: { id: "job-1", reference: "JOB-2026-00003" },
      request: { id: "request-1", reference: "FF-2026-00004" },
    });
  });

  it("falls back to the live details when a snapshot cannot be read, rather than failing", () => {
    const dto = toCustomerInvoiceDto({
      row: row({ businessSnapshot: { unexpected: true }, customerSnapshot: null }),
      context: CONTEXT,
      settings: SETTINGS,
    });
    expect(dto.business.name).toBe("CoolBreeze Home Services");
    expect(dto.customer).toMatchObject({ name: "Live Name", email: "live@example.test" });
    expect(dto.paymentInstructions).toBe("Live instructions");
  });

  it("works out the balance from the total and what has been paid", () => {
    const dto = toCustomerInvoiceDto({
      row: row({ amountPaid: D("100"), status: InvoiceStatus.PARTIALLY_PAID }),
      context: CONTEXT,
      settings: SETTINGS,
    });
    expect(dto).toMatchObject({
      status: InvoiceStatus.PARTIALLY_PAID,
      amountPaid: "100.00",
      balanceDue: "200.00",
    });
  });

  it("derives Overdue from the due date in the business zone, counting the days", () => {
    // 10 March 2026 is 6 days after the due date of 4 March.
    const dto = toCustomerInvoiceDto({
      row: row({ dueDate: new Date("2026-03-04T00:00:00.000Z") }),
      context: CONTEXT,
      settings: SETTINGS,
    });
    expect(dto).toMatchObject({
      status: InvoiceStatus.OVERDUE,
      statusLabel: "Overdue",
      daysOverdue: 6,
    });
  });

  it("lists the payments that stand, oldest first, and gives the day of the last as paidOn once paid", () => {
    const dto = toCustomerInvoiceDto({
      row: row({
        amountPaid: D("300"),
        status: InvoiceStatus.PAID,
        payments: [payment("100", "2026-03-04"), payment("200", "2026-03-06")],
      }),
      context: CONTEXT,
      settings: SETTINGS,
    });
    expect(dto.status).toBe(InvoiceStatus.PAID);
    expect(dto.payments.map((entry) => entry.paymentDate)).toEqual(["2026-03-04", "2026-03-06"]);
    expect(dto.paidOn).toBe("2026-03-06");
    expect(dto.payments[0]).toEqual({
      id: "payment-2026-03-04",
      paymentDate: "2026-03-04",
      method: "CASH",
      methodLabel: "Cash",
      amount: "100.00",
    });
  });

  it("has no paidOn while money is still owed", () => {
    const dto = toCustomerInvoiceDto({
      row: row({
        amountPaid: D("100"),
        status: InvoiceStatus.PARTIALLY_PAID,
        payments: [payment("100", "2026-03-04")],
      }),
      context: CONTEXT,
      settings: SETTINGS,
    });
    expect(dto.paidOn).toBeNull();
  });

  it("says when the business withdrew the invoice, and nothing of why", () => {
    const dto = toCustomerInvoiceDto({
      row: row({ voidedAt: new Date("2026-03-05T12:00:00.000Z"), status: InvoiceStatus.VOID }),
      context: CONTEXT,
      settings: SETTINGS,
    });
    expect(dto.status).toBe(InvoiceStatus.VOID);
    expect(dto.voidedAt).toBe("2026-03-05T12:00:00.000Z");
    expect(JSON.stringify(dto)).not.toMatch(/reason/i);
  });

  it("is a fresh object built field by field: a column added to the row cannot reach it", () => {
    const withExtra = {
      ...row(),
      voidReason: "INTERNAL: priced the wrong unit",
      createdBy: { name: "Morgan Reyes" },
    } as CustomerInvoiceDetailRow;
    const text = JSON.stringify(
      toCustomerInvoiceDto({ row: withExtra, context: CONTEXT, settings: SETTINGS }),
    );
    expect(text).not.toContain("INTERNAL");
    expect(text).not.toContain("Morgan Reyes");
  });
});

describe("toCustomerInvoiceListItem", () => {
  it("has the row's figures, the service and the job", () => {
    const base = row();
    const item = toCustomerInvoiceListItem(
      {
        id: base.id,
        invoiceNumber: base.invoiceNumber,
        status: base.status,
        currencyCode: base.currencyCode,
        totalAmount: base.totalAmount,
        amountPaid: base.amountPaid,
        issueDate: base.issueDate,
        dueDate: base.dueDate,
        issuedAt: base.issuedAt,
        voidedAt: base.voidedAt,
        workOrder: { reference: "JOB-2026-00003", serviceNameSnapshot: "AC Repair" },
      },
      CONTEXT,
    );
    expect(Object.keys(item).sort()).toEqual(
      [
        "amountPaid",
        "balanceDue",
        "currencyCode",
        "daysOverdue",
        "dueDate",
        "id",
        "invoiceNumber",
        "issueDate",
        "jobReference",
        "serviceName",
        "status",
        "statusLabel",
        "totalAmount",
      ].sort(),
    );
    expect(item.balanceDue).toBe("300.00");
  });
});

describe("toCustomerJobInvoiceLink", () => {
  const linkRow = (overrides: Partial<CustomerJobInvoiceRow> = {}): CustomerJobInvoiceRow => ({
    id: "invoice-1",
    invoiceNumber: "INV-2026-00012",
    issuedAt: new Date("2026-03-02T15:00:00.000Z"),
    voidedAt: null,
    totalAmount: D("300"),
    amountPaid: D("0"),
    dueDate: new Date("2026-03-16T00:00:00.000Z"),
    ...overrides,
  });

  it("is the number, status and id of an issued invoice", () => {
    expect(toCustomerJobInvoiceLink(linkRow(), CONTEXT)).toEqual({
      id: "invoice-1",
      invoiceNumber: "INV-2026-00012",
      status: "ISSUED",
      statusLabel: "Issued",
    });
  });

  it("is nothing for a draft, and nothing for an invoice the business withdrew", () => {
    expect(
      toCustomerJobInvoiceLink(linkRow({ invoiceNumber: null, issuedAt: null }), CONTEXT),
    ).toBeNull();
    expect(
      toCustomerJobInvoiceLink(
        linkRow({ voidedAt: new Date("2026-03-05T00:00:00.000Z") }),
        CONTEXT,
      ),
    ).toBeNull();
  });
});

describe("toInvoicePdfSnapshot", () => {
  it("agrees with the customer's page on every figure, label and party", () => {
    const source = row({
      amountPaid: D("100"),
      status: InvoiceStatus.PARTIALLY_PAID,
      payments: [payment("100", "2026-03-04")],
    });
    const dto = toCustomerInvoiceDto({ row: source, context: CONTEXT, settings: SETTINGS });
    const pdf = toInvoicePdfSnapshot({ row: source, context: CONTEXT, settings: SETTINGS });

    expect(pdf).toMatchObject({
      invoiceNumber: dto.invoiceNumber,
      status: dto.status,
      statusLabel: dto.statusLabel,
      currencyCode: dto.currencyCode,
      taxRate: dto.taxRate,
      subtotal: dto.subtotal,
      discountAmount: dto.discountAmount,
      taxAmount: dto.taxAmount,
      totalAmount: dto.totalAmount,
      amountPaid: dto.amountPaid,
      balanceDue: dto.balanceDue,
      issueDate: dto.issueDate,
      dueDate: dto.dueDate,
      business: dto.business,
      customer: dto.customer,
      paymentInstructions: dto.paymentInstructions,
      footer: dto.footer,
      serviceName: dto.serviceName,
      jobReference: dto.jobReference,
      requestReference: dto.request.reference,
      paidOn: dto.paidOn,
    });
    expect(pdf.payments).toEqual(
      dto.payments.map(({ paymentDate, method, methodLabel, amount }) => ({
        paymentDate,
        method,
        methodLabel,
        amount,
      })),
    );
  });

  it("describes a draft, which has no number or dates yet, from the live details", () => {
    const pdf = toInvoicePdfSnapshot({
      row: row({
        status: InvoiceStatus.DRAFT,
        invoiceNumber: null,
        issueDate: null,
        issuedAt: null,
        businessSnapshot: null,
        customerSnapshot: null,
      }),
      context: CONTEXT,
      settings: SETTINGS,
    });
    expect(pdf).toMatchObject({
      invoiceNumber: null,
      status: InvoiceStatus.DRAFT,
      issueDate: null,
      paymentInstructions: "Live instructions",
    });
    expect(pdf.business.name).toBe("CoolBreeze Home Services");
    expect(pdf.customer.name).toBe("Live Name");
  });

  it("carries no field that is internal", () => {
    const text = JSON.stringify(
      toInvoicePdfSnapshot({
        row: {
          ...row(),
          voidReason: "INTERNAL: reason",
          createdBy: { name: "Morgan Reyes" },
        } as CustomerInvoiceDetailRow,
        context: CONTEXT,
        settings: SETTINGS,
      }),
    );
    expect(text).not.toContain("INTERNAL");
    expect(text).not.toContain("Morgan Reyes");
  });
});
