import {
  type AdminCustomerDto,
  type AdminCustomerListItemDto,
  type AdminQuotationDto,
  type AdminRequestDto,
  type AdminRequestListItemDto,
  type AdminTechnicianDto,
  type AdminTechnicianListItemDto,
  type AdminWorkOrderDto,
  type AdminWorkOrderListItemDto,
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
    quotations: [],
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

// ---- Quotations (T14) -----------------------------------------------------------------------

export const QUOTATION_ID = "6f1c7a0e-5d0b-4f55-9d52-0d8d1c3b8a11";

/** The worked example of D-19: subtotal 252.00, taxable 45.50, tax 3.64, total 255.64. */
export function adminQuotation(overrides: Partial<AdminQuotationDto> = {}): AdminQuotationDto {
  return {
    id: QUOTATION_ID,
    reference: "QT-2026-00004",
    status: "DRAFT",
    statusLabel: "Draft",
    requestId: REQUEST_ID,
    requestReference: "FF-2026-00012",
    requestStatus: "UNDER_REVIEW",
    requestStatusLabel: "Under review",
    serviceName: "AC Repair",
    customerName: "Amara Okafor",
    customer: {
      id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      name: "Amara Okafor",
      email: "amara.okafor@example.com",
      phone: "(212) 555-0142",
    },
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
    sentAt: null,
    respondedAt: null,
    createdAt: "2026-11-02T10:00:00.000Z",
    updatedAt: "2026-11-02T10:05:00.123Z",
    createdBy: { name: "Morgan Reyes" },
    sentBy: null,
    declineReason: null,
    expiredAt: null,
    voided: null,
    replaces: null,
    replacedBy: null,
    timeline: [],
    availableActions: ["EDIT", "SEND", "VOID"],
    ...overrides,
  };
}

// ---- Technicians (T16) ----------------------------------------------------------------------

export const TECHNICIAN_ID = "3c1d9e52-7a64-4f0b-8b0e-5a2f6d4c8e77";

/** A technician as the list shows them: no notes, nothing coming up. */
export function technicianListItem(
  overrides: Partial<AdminTechnicianListItemDto> = {},
): AdminTechnicianListItemDto {
  return {
    id: TECHNICIAN_ID,
    name: "Jordan Lee",
    phone: "(212) 555-0151",
    email: "jordan.lee@coolbreeze.test",
    specialties: ["Air conditioning", "Heat pumps"],
    calendarColor: "blue",
    isActive: true,
    upcomingJobCount: 0,
    nextJob: null,
    availableActions: ["EDIT", "DEACTIVATE"],
    ...overrides,
  };
}

/** One technician in full, with a week of nothing booked and nothing coming up. */
export function adminTechnician(overrides: Partial<AdminTechnicianDto> = {}): AdminTechnicianDto {
  return {
    ...technicianListItem(),
    notes: "Senior technician. Takes the diagnostic visits first thing in the morning.",
    createdAt: "2026-10-28T12:00:00.000Z",
    updatedAt: "2026-10-30T09:30:00.000Z",
    upcomingAssignments: [],
    availability: [
      { date: "2026-03-02", scheduledMinutes: 0 },
      { date: "2026-03-03", scheduledMinutes: 0 },
      { date: "2026-03-04", scheduledMinutes: 0 },
      { date: "2026-03-05", scheduledMinutes: 0 },
      { date: "2026-03-06", scheduledMinutes: 0 },
      { date: "2026-03-07", scheduledMinutes: 0 },
      { date: "2026-03-08", scheduledMinutes: 0 },
    ],
    ...overrides,
  };
}

// ---- Jobs (T17) -----------------------------------------------------------------------------

export const JOB_ID = "b4a1f5c2-3d6e-4c7a-9b8d-2e1f0a9b8c7d";

/** A job in the list: scheduled for 10:00 to 12:00 on 3 March 2026 in New York, with Jordan. */
export function jobListItem(
  overrides: Partial<AdminWorkOrderListItemDto> = {},
): AdminWorkOrderListItemDto {
  return {
    id: JOB_ID,
    reference: "JOB-2026-00007",
    status: "SCHEDULED",
    statusLabel: "Scheduled",
    serviceName: "AC Repair",
    customerName: "Amara Okafor",
    city: "Harbor City",
    scheduledStart: "2026-03-03T15:00:00.000Z",
    scheduledEnd: "2026-03-03T17:00:00.000Z",
    technician: { id: TECHNICIAN_ID, name: "Jordan Lee", calendarColor: "blue" },
    createdAt: "2026-03-01T14:05:00.000Z",
    ...overrides,
  };
}

/** A job in full. By default it is scheduled, so the page offers Reschedule. */
export function adminJob(overrides: Partial<AdminWorkOrderDto> = {}): AdminWorkOrderDto {
  return {
    id: JOB_ID,
    reference: "JOB-2026-00007",
    status: "SCHEDULED",
    statusLabel: "Scheduled",
    scopeDescription:
      "The outdoor unit hums and the house does not cool.\n\nAgreed work:\n- Diagnostic visit\n- Replace run capacitor",
    serviceId: "5d3c2b1a-9f8e-4d7c-8b6a-5e4d3c2b1a09",
    serviceName: "AC Repair",
    scheduledStart: "2026-03-03T15:00:00.000Z",
    scheduledEnd: "2026-03-03T17:00:00.000Z",
    technician: {
      id: TECHNICIAN_ID,
      name: "Jordan Lee",
      calendarColor: "blue",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      isActive: true,
    },
    customer: {
      id: CUSTOMER_ID,
      name: "Amara Okafor",
      email: "amara.okafor@example.test",
      phone: "(212) 555-0100",
    },
    address: {
      line1: "214 Larkspur Lane",
      line2: null,
      city: "Harbor City",
      region: "NY",
      postalCode: "10001",
      accessNotes: "Side gate code is 4471.",
    },
    request: { id: REQUEST_ID, reference: "FF-2026-00012" },
    quotation: {
      id: QUOTATION_ID,
      reference: "QT-2026-00009",
      currencyCode: "USD",
      subtotal: "252.00",
      discountAmount: "0.00",
      taxRate: "8.00",
      taxAmount: "3.64",
      totalAmount: "255.64",
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
          description: "Replace run capacitor",
          quantity: "1.00",
          unitPrice: "45.50",
          taxable: true,
          lineTotal: "45.50",
        },
      ],
    },
    startedAt: null,
    completedAt: null,
    createdBy: { name: "Morgan Reyes" },
    createdAt: "2026-03-01T14:05:00.000Z",
    updatedAt: "2026-03-02T09:30:00.000Z",
    timeline: [],
    availableActions: ["RESCHEDULE", "START", "MARK_NEEDS_RESCHEDULING", "CANCEL"],
    ...overrides,
  };
}

/** A job nobody has given a time yet. */
export function unscheduledJob(overrides: Partial<AdminWorkOrderDto> = {}): AdminWorkOrderDto {
  return adminJob({
    status: "PENDING_SCHEDULING",
    statusLabel: "Pending scheduling",
    scheduledStart: null,
    scheduledEnd: null,
    technician: null,
    availableActions: ["SCHEDULE", "CANCEL"],
    ...overrides,
  });
}
