import {
  type CustomerQuotationDto,
  type CustomerQuotationListItemDto,
  type CustomerQuotationSummaryDto,
  type CustomerWorkOrderDto,
  type CustomerWorkOrderListItemDto,
  workOrderCustomerExplanation,
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

// ---- Jobs (T18) ---------------------------------------------------------------------------------

export const PORTAL_JOB_ID = "b4a1f5c2-3d6e-4c7a-9b8d-2e1f0a9b8c7d";

/** A scheduled job on the customer's list: 3 March 2026, 10:00 to 12:00 in New York, with Jordan. */
export function customerJobListItem(
  overrides: Partial<CustomerWorkOrderListItemDto> = {},
): CustomerWorkOrderListItemDto {
  return {
    id: PORTAL_JOB_ID,
    reference: "JOB-2026-00007",
    status: "SCHEDULED",
    statusLabel: "Scheduled",
    serviceName: "AC Repair",
    scheduledStart: "2026-03-03T15:00:00.000Z",
    scheduledEnd: "2026-03-03T17:00:00.000Z",
    technician: { displayName: "Jordan" },
    completedAt: null,
    ...overrides,
  };
}

/** A job in full, as its customer sees it. Scheduled by default. */
export function customerJob(overrides: Partial<CustomerWorkOrderDto> = {}): CustomerWorkOrderDto {
  const status = overrides.status ?? "SCHEDULED";
  return {
    ...customerJobListItem(),
    statusExplanation: workOrderCustomerExplanation(status),
    timeZone: PORTAL_TIME_ZONE,
    scopeDescription:
      "The outdoor unit hums and the house does not cool.\n\nAgreed work:\n- Diagnostic visit\n- Replace run capacitor",
    address: {
      line1: "214 Larkspur Lane",
      line2: "Unit 4",
      city: "Harbor City",
      region: "NY",
      postalCode: "10001",
      accessNotes: "Side gate code is 4471.",
    },
    previouslyScheduled: null,
    startedAt: null,
    cancelledAt: null,
    completionNote: null,
    request: { id: PORTAL_REQUEST_ID, reference: "FF-2026-00012" },
    quotation: { id: PORTAL_QUOTATION_ID, reference: "QT-2026-00004" },
    invoice: null,
    timeline: [
      {
        id: "event-1",
        publicSummary: "We created job JOB-2026-00007 for your request.",
        toStatus: "PENDING_SCHEDULING",
        actor: "CoolBreeze Home Services",
        createdAt: "2026-03-01T14:05:00.000Z",
      },
      {
        id: "event-2",
        publicSummary: "We scheduled your visit for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST.",
        toStatus: "SCHEDULED",
        actor: "CoolBreeze Home Services",
        createdAt: "2026-03-01T15:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

/** A job under way. */
export function startedCustomerJob(overrides: Partial<CustomerWorkOrderDto> = {}) {
  return customerJob({
    status: "IN_PROGRESS",
    statusLabel: "In progress",
    startedAt: "2026-03-03T15:05:00.000Z",
    ...overrides,
  });
}

/** A finished job, with the summary written for the customer. */
export function completedCustomerJob(overrides: Partial<CustomerWorkOrderDto> = {}) {
  return customerJob({
    status: "COMPLETED",
    statusLabel: "Completed",
    startedAt: "2026-03-03T15:05:00.000Z",
    completedAt: "2026-03-03T16:40:00.000Z",
    completionNote:
      "Replaced the run capacitor and checked the cooling.\nThe unit now reaches 68 degrees.",
    ...overrides,
  });
}

/** A job that needs a new time: no booked visit, the old one shown as history. */
export function needsTimeCustomerJob(overrides: Partial<CustomerWorkOrderDto> = {}) {
  return customerJob({
    status: "NEEDS_RESCHEDULING",
    statusLabel: "Needs rescheduling",
    scheduledStart: null,
    scheduledEnd: null,
    technician: null,
    previouslyScheduled: {
      start: "2026-03-03T15:00:00.000Z",
      end: "2026-03-03T17:00:00.000Z",
    },
    ...overrides,
  });
}

/** A cancelled job. */
export function cancelledCustomerJob(overrides: Partial<CustomerWorkOrderDto> = {}) {
  return customerJob({
    status: "CANCELLED",
    statusLabel: "Cancelled",
    scheduledStart: null,
    scheduledEnd: null,
    technician: null,
    cancelledAt: "2026-03-02T18:00:00.000Z",
    previouslyScheduled: {
      start: "2026-03-03T15:00:00.000Z",
      end: "2026-03-03T17:00:00.000Z",
    },
    ...overrides,
  });
}
