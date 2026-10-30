import {
  type AdminCustomerDto,
  type AdminCustomerListItemDto,
  type AdminRequestDto,
  type AdminRequestListItemDto,
  type CustomerHistoryInvoiceDto,
  type CustomerHistoryJobDto,
  type CustomerHistoryQuotationDto,
  type CustomerHistoryRequestDto,
  REQUEST_NEXT_STEPS,
  RequestAction,
} from "@fixflow/shared";

/** Fictional records for the admin request screens' tests. */

export const REQUEST_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

export function listItem(
  overrides: Partial<AdminRequestListItemDto> = {},
): AdminRequestListItemDto {
  return {
    id: REQUEST_ID,
    reference: "FF-2026-00012",
    status: "SUBMITTED",
    statusLabel: "Submitted",
    isNew: true,
    serviceName: "AC Repair",
    customerName: "Amara Okafor",
    city: "Harbor City",
    preferredDate: "2026-11-10",
    preferredWindow: "MORNING",
    submittedAt: "2026-10-30T14:05:00.000Z",
    updatedAt: "2026-10-30T14:05:00.000Z",
    ...overrides,
  };
}

export function adminRequest(overrides: Partial<AdminRequestDto> = {}): AdminRequestDto {
  return {
    id: REQUEST_ID,
    reference: "FF-2026-00012",
    status: "SUBMITTED",
    statusLabel: "Submitted",
    nextStep: REQUEST_NEXT_STEPS.SUBMITTED,
    serviceId: "5d3c2b1a-9f8e-4d7c-8b6a-5e4d3c2b1a09",
    serviceName: "AC Repair",
    preferredDate: "2026-11-10",
    preferredWindow: "MORNING",
    submittedAt: "2026-10-30T14:05:00.000Z",
    updatedAt: "2026-10-30T14:05:00.000Z",
    description: "The unit stopped cooling.\nIt rattles when it starts.",
    address: {
      line1: "214 Larkspur Lane",
      line2: "Unit 4",
      city: "Harbor City",
      region: "NY",
      postalCode: "10001",
      accessNotes: "Gate code 4821",
    },
    preferredStart: "2026-11-10T13:00:00.000Z",
    preferredEnd: "2026-11-10T17:00:00.000Z",
    customer: {
      id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      name: "Amara Okafor",
      email: "amara.okafor@example.com",
      phone: "(212) 555-0142",
      previousRequests: [],
      totalRequests: 1,
      workOrderCount: 0,
      invoiceCount: 0,
    },
    notes: [],
    timeline: [],
    cancellation: null,
    availableActions: [RequestAction.START_REVIEW, RequestAction.CANCEL],
    ...overrides,
  };
}

// ---- Customers (T13) ------------------------------------------------------------------------

export const CUSTOMER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

export function customerListItem(
  overrides: Partial<AdminCustomerListItemDto> = {},
): AdminCustomerListItemDto {
  return {
    id: CUSTOMER_ID,
    name: "Amara Okafor",
    email: "amara.okafor@example.com",
    phone: "(212) 555-0142",
    city: "Harbor City",
    requestCount: 3,
    openJobCount: 1,
    outstandingBalance: "175.50",
    currencyCode: "USD",
    lastActivityAt: "2026-10-30T14:05:00.000Z",
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

export function adminCustomer(overrides: Partial<AdminCustomerDto> = {}): AdminCustomerDto {
  return {
    id: CUSTOMER_ID,
    name: "Amara Okafor",
    email: "amara.okafor@example.com",
    phone: "(212) 555-0142",
    customerSince: "2026-09-01T10:00:00.000Z",
    lastActivityAt: "2026-10-30T14:05:00.000Z",
    addresses: [
      {
        id: "a-1",
        label: "Home",
        line1: "214 Larkspur Lane",
        line2: "Unit 4",
        city: "Harbor City",
        region: "NY",
        postalCode: "10001",
        accessNotes: "Gate code 4821.\nDog in the yard.",
        isDefault: true,
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "a-2",
        label: "Rental",
        line1: "9 Quay Street",
        line2: null,
        city: "Port Elm",
        region: null,
        postalCode: "20002",
        accessNotes: null,
        isDefault: false,
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      },
    ],
    summary: {
      requestCount: 3,
      quotationCount: 2,
      jobCount: 2,
      openJobCount: 1,
      invoiceCount: 1,
      outstandingBalance: "175.50",
      currencyCode: "USD",
    },
    recent: { requests: [], quotations: [], jobs: [], invoices: [] },
    notes: [],
    noteCount: 0,
    ...overrides,
  };
}

const REQUEST_REF = { id: REQUEST_ID, reference: "FF-2026-00012" };

export function historyRequest(
  overrides: Partial<CustomerHistoryRequestDto> = {},
): CustomerHistoryRequestDto {
  return {
    id: REQUEST_ID,
    reference: "FF-2026-00012",
    serviceName: "AC Repair",
    status: "UNDER_REVIEW",
    preferredDate: "2026-11-10",
    preferredWindow: "MORNING",
    submittedAt: "2026-10-30T14:05:00.000Z",
    ...overrides,
  };
}

export function historyQuotation(
  overrides: Partial<CustomerHistoryQuotationDto> = {},
): CustomerHistoryQuotationDto {
  return {
    id: "q-1",
    reference: "QT-2026-00004",
    status: "SENT",
    totalAmount: "108.00",
    currencyCode: "USD",
    validUntil: "2026-12-01",
    sentAt: "2026-10-31T15:00:00.000Z",
    createdAt: "2026-10-31T14:00:00.000Z",
    request: REQUEST_REF,
    ...overrides,
  };
}

export function historyJob(overrides: Partial<CustomerHistoryJobDto> = {}): CustomerHistoryJobDto {
  return {
    id: "j-1",
    reference: "JOB-2026-00002",
    serviceName: "AC Repair",
    status: "SCHEDULED",
    scheduledStart: "2026-11-12T14:00:00.000Z",
    completedAt: null,
    createdAt: "2026-11-01T14:00:00.000Z",
    request: REQUEST_REF,
    ...overrides,
  };
}

export function historyInvoice(
  overrides: Partial<CustomerHistoryInvoiceDto> = {},
): CustomerHistoryInvoiceDto {
  return {
    id: "i-1",
    invoiceNumber: "INV-2026-00007",
    status: "PARTIALLY_PAID",
    totalAmount: "216.00",
    amountPaid: "40.50",
    balanceDue: "175.50",
    currencyCode: "USD",
    dueDate: "2026-11-14",
    issuedAt: "2026-10-31T15:00:00.000Z",
    createdAt: "2026-10-31T14:00:00.000Z",
    request: REQUEST_REF,
    ...overrides,
  };
}

/** A page of a history list, as the API answers. */
export function historyResponse<Row>(rows: Row[], totalItems = rows.length) {
  return {
    data: rows,
    pagination: { page: 1, pageSize: 10, totalItems, totalPages: Math.ceil(totalItems / 10) },
  };
}
