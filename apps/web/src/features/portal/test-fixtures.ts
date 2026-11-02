import type {
  CustomerQuotationDto,
  CustomerQuotationListItemDto,
  CustomerQuotationSummaryDto,
} from "@fixflow/shared";

/** Shared test data for the customer's quotation screens (T15). All of it is fictional. */

export const PORTAL_REQUEST_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";
export const PORTAL_QUOTATION_ID = "6f1c7a0e-5d0b-4f55-9d52-0d8d1c3b8a11";
export const PORTAL_TIME_ZONE = "America/New_York";
/** 12 November 2026, 10:00 in New York: five days before the default `validUntil`. */
export const PORTAL_NOW = new Date("2026-11-12T15:00:00.000Z");

/** The worked example of D-19: subtotal 252.00, taxable 45.50, tax 3.64, total 255.64. */
export function customerQuotation(
  overrides: Partial<CustomerQuotationDto> = {},
): CustomerQuotationDto {
  return {
    id: PORTAL_QUOTATION_ID,
    reference: "QT-2026-00004",
    status: "SENT",
    statusLabel: "Sent",
    requestId: PORTAL_REQUEST_ID,
    requestReference: "FF-2026-00012",
    serviceName: "AC Repair",
    customerName: "Alex Morgan",
    address: {
      line1: "214 Larkspur Lane",
      line2: "Unit 4",
      city: "Harbor City",
      region: "NY",
      postalCode: "10001",
    },
    business: {
      name: "CoolBreeze Home Services",
      tagline: "Home comfort and repairs, done properly the first time.",
      logoKey: null,
      logoUrl: null,
      email: "hello@coolbreeze.test",
      phone: "(212) 555-0142",
      address: {
        line1: "48 Harbor Point Road",
        line2: "Unit 3",
        city: "Harbor City",
        region: "NY",
        postalCode: "10999",
      },
    },
    currencyCode: "USD",
    taxRate: "8.00",
    lines: [
      {
        id: "line-1",
        position: 1,
        description: "Diagnostic visit",
        quantity: "1.00",
        unitPrice: "79.00",
        taxable: false,
        lineTotal: "79.00",
      },
      {
        id: "line-2",
        position: 2,
        description: "Run capacitor",
        quantity: "1.00",
        unitPrice: "45.50",
        taxable: true,
        lineTotal: "45.50",
      },
      {
        id: "line-3",
        position: 3,
        description: "Labour",
        quantity: "1.50",
        unitPrice: "85.00",
        taxable: false,
        lineTotal: "127.50",
      },
    ],
    subtotal: "252.00",
    discountAmount: "0.00",
    taxableBase: "45.50",
    taxAmount: "3.64",
    totalAmount: "255.64",
    validUntil: "2026-11-17",
    terms: "Prices are valid until the date shown.",
    customerNote: null,
    sentAt: "2026-11-03T15:00:00.000Z",
    respondedAt: null,
    replacedBy: null,
    preview: false,
    ...overrides,
  };
}

export function quotationSummary(
  overrides: Partial<CustomerQuotationSummaryDto> = {},
): CustomerQuotationSummaryDto {
  return {
    id: PORTAL_QUOTATION_ID,
    reference: "QT-2026-00004",
    status: "SENT",
    statusLabel: "Sent",
    totalAmount: "255.64",
    currencyCode: "USD",
    validUntil: "2026-11-17",
    sentAt: "2026-11-03T15:00:00.000Z",
    respondedAt: null,
    replacedBy: null,
    ...overrides,
  };
}

export function quotationListItem(
  overrides: Partial<CustomerQuotationListItemDto> = {},
): CustomerQuotationListItemDto {
  return {
    ...quotationSummary(),
    requestId: PORTAL_REQUEST_ID,
    requestReference: "FF-2026-00012",
    serviceName: "AC Repair",
    ...overrides,
  };
}
