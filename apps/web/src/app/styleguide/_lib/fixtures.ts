import { ServiceRequestStatus } from "@fixflow/shared";

/**
 * Example data for the styleguide. Everything is fictional and mirrors the demo business in
 * `docs/DESIGN_SYSTEM.md` and the seed (CoolBreeze Home Services, New York time, US dollars).
 */

export const BUSINESS_NAME = "CoolBreeze Home Services";
export const BUSINESS_TIME_ZONE = "America/New_York";
export const CURRENCY_CODE = "USD";

/** A fixed "now" so relative times are the same on every render and in every screenshot. */
export const SAMPLE_NOW = "2026-10-28T15:00:00Z";

export const CUSTOMERS = [
  "Morgan Reyes",
  "Priya Shah",
  "Daniel Okafor",
  "Hannah Weiss",
  "Tomás Ibarra",
  "Sofia Lindqvist",
  "Marcus Bell",
  "Amara Nwosu",
] as const;

export const SERVICES = [
  "AC Diagnostic Visit",
  "AC Routine Maintenance",
  "Washing Machine Repair",
  "Electrical Safety Inspection",
  "Home Deep Cleaning",
] as const;

export interface RequestRow {
  id: string;
  reference: string;
  customer: string;
  service: string;
  status: ServiceRequestStatus;
  /** ISO 8601 instant. */
  submittedAt: string;
  /** A decimal string, or `null` until a quotation exists. */
  quoted: string | null;
}

const STATUS_CYCLE: readonly ServiceRequestStatus[] = [
  ServiceRequestStatus.SUBMITTED,
  ServiceRequestStatus.UNDER_REVIEW,
  ServiceRequestStatus.QUOTED,
  ServiceRequestStatus.ACCEPTED,
  ServiceRequestStatus.CONVERTED_TO_JOB,
  ServiceRequestStatus.SUBMITTED,
  ServiceRequestStatus.DECLINED,
  ServiceRequestStatus.CANCELLED,
  ServiceRequestStatus.QUOTED,
  ServiceRequestStatus.UNDER_REVIEW,
];

const QUOTED_AMOUNTS = ["1284.50", "189.00", "412.75", "96.00", "2340.00", "129.00", "865.20"];

const FIRST_SUBMITTED = Date.parse("2026-10-28T13:42:00Z");
const SIX_HOURS = 6 * 60 * 60 * 1000;

/** 48 requests, newest first, so list screens have enough rows to page through. */
export const REQUESTS: readonly RequestRow[] = Array.from({ length: 48 }, (_, index) => {
  const status = STATUS_CYCLE[index % STATUS_CYCLE.length] ?? ServiceRequestStatus.SUBMITTED;
  const hasQuotation =
    status !== ServiceRequestStatus.SUBMITTED && status !== ServiceRequestStatus.CANCELLED;
  return {
    id: `request-${index + 1}`,
    reference: `FF-2026-${String(125 - index).padStart(5, "0")}`,
    customer: CUSTOMERS[index % CUSTOMERS.length] ?? CUSTOMERS[0],
    service: SERVICES[(index * 3) % SERVICES.length] ?? SERVICES[0],
    status,
    submittedAt: new Date(FIRST_SUBMITTED - index * SIX_HOURS).toISOString(),
    quoted: hasQuotation ? (QUOTED_AMOUNTS[index % QUOTED_AMOUNTS.length] ?? null) : null,
  };
});

export const REQUEST_SORT_FIELDS = [
  "reference",
  "customer",
  "status",
  "submittedAt",
  "quoted",
] as const;
export type RequestSortField = (typeof REQUEST_SORT_FIELDS)[number];

export function isRequestSortField(value: string | undefined): value is RequestSortField {
  return (REQUEST_SORT_FIELDS as readonly (string | undefined)[]).includes(value);
}

export interface RequestQuery {
  sort: RequestSortField;
  order: "asc" | "desc";
  page: number;
  pageSize: number;
  status?: ServiceRequestStatus | undefined;
  search?: string | undefined;
}

export function queryRequests(query: RequestQuery) {
  const needle = query.search?.trim().toLowerCase();
  const filtered = REQUESTS.filter(
    (row) =>
      (query.status === undefined || row.status === query.status) &&
      (!needle ||
        row.customer.toLowerCase().includes(needle) ||
        row.reference.toLowerCase().includes(needle) ||
        row.service.toLowerCase().includes(needle)),
  );

  const direction = query.order === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    const left = a[query.sort] ?? "";
    const right = b[query.sort] ?? "";
    if (query.sort === "quoted") {
      return (Number(a.quoted ?? -1) - Number(b.quoted ?? -1)) * direction;
    }
    return String(left).localeCompare(String(right)) * direction;
  });

  const start = (query.page - 1) * query.pageSize;
  return { rows: sorted.slice(start, start + query.pageSize), totalItems: sorted.length };
}

export const TIMELINE_EVENTS = [
  {
    id: "t5",
    title: "Quotation QT-2026-00042 sent",
    description: "Valid until Nov 11, 2026.",
    timestamp: "2026-10-28T14:12:00Z",
    actor: "Alex Morgan",
    tone: "info",
  },
  {
    id: "t4",
    title: "Request moved to Under review",
    timestamp: "2026-10-28T13:55:00Z",
    actor: "Alex Morgan",
    tone: "info",
  },
  {
    id: "t3",
    title: "Note added for the customer",
    description: "Please make sure the unit in the garage is reachable on the day.",
    timestamp: "2026-10-27T20:30:00Z",
    actor: "Alex Morgan",
    tone: "neutral",
  },
  {
    id: "t2",
    title: "Request submitted",
    description: "AC Diagnostic Visit at 48 Maple Court, Harbor City.",
    timestamp: "2026-10-27T16:05:00Z",
    actor: "Morgan Reyes",
    tone: "success",
  },
] as const;

/**
 * Document lines as the API serializes them: every amount, including line totals and the totals
 * below, is a decimal string calculated on the server. The UI never does money arithmetic.
 */
export const DOCUMENT_LINES = [
  {
    id: "l1",
    description: "Diagnostic visit and written report",
    quantity: "1",
    unitPrice: "89.00",
    lineTotal: "89.00",
  },
  {
    id: "l2",
    description: "Replace capacitor (part and labour)",
    quantity: "1",
    unitPrice: "148.50",
    lineTotal: "148.50",
  },
  {
    id: "l3",
    description: "Refrigerant top-up, per kilogram",
    quantity: "1.5",
    unitPrice: "64.00",
    lineTotal: "96.00",
  },
] as const;

export const DOCUMENT_TOTALS = {
  subtotal: "333.50",
  taxRate: "8.00",
  tax: "26.68",
  total: "360.18",
  amountPaid: "100.00",
  balance: "260.18",
} as const;
