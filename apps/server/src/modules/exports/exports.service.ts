import {
  type AdminInvoiceListItemDto,
  type AdminRequestListItemDto,
  type AdminWorkOrderListItemDto,
  dateOnlyInTimeZone,
  type ExportKind,
  instantToWallClock,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import { INVOICE_LIST_SELECT, toAdminInvoiceListItem } from "../invoices/invoices.dto.js";
import type { AdminInvoicesQuery } from "../invoices/invoices.schemas.js";
import {
  filtersWhere as invoiceFilters,
  loadSettings as loadInvoiceSettings,
  orderByOf as invoiceOrderBy,
  syncOverdueInvoicesIfDue,
  withStatus as invoiceWithStatus,
} from "../invoices/invoices.service.js";
import { syncExpiredQuotationsIfDue } from "../quotations/quotations.service.js";
import {
  ADMIN_LIST_SELECT as REQUEST_LIST_SELECT,
  toAdminRequestListItem,
} from "../requests/requests.admin.dto.js";
import type { AdminRequestsQuery } from "../requests/requests.admin.schemas.js";
import {
  filtersWhere as requestFilters,
  withStatus as requestWithStatus,
} from "../requests/requests.admin.service.js";
import { loadBusiness } from "../requests/requests.service.js";
import {
  ADMIN_LIST_SELECT as JOB_LIST_SELECT,
  toAdminWorkOrderListItem,
} from "../work-orders/work-orders.dto.js";
import type { AdminWorkOrdersQuery } from "../work-orders/work-orders.schemas.js";
import {
  filtersWhere as jobFilters,
  jobsOrderBy,
  withViewAndStatus as jobWithViewAndStatus,
} from "../work-orders/work-orders.service.js";
import { CSV_BOM, csvRecord } from "./exports.csv.js";

type ExportDeps = Pick<AppDeps, "prisma" | "clock">;

/** Rows read from the database at a time: memory stays flat however large the export is. */
export const EXPORT_BATCH_SIZE = 500;

export interface CsvExport {
  /** `fixflow-requests-2026-11-11.csv`: the day is the business's today. */
  filename: string;
  /** The file, as text chunks: the header first, then the rows batch by batch. */
  chunks: AsyncGenerator<string, void, undefined>;
}

// ---- The columns (SEC-DATA-02) -------------------------------------------------------------------------
//
// Each column is written here, by hand, from a list-item DTO: a column added to a DTO later never
// reaches a file unnoticed. The files carry operational data only. They deliberately leave out the
// customer's email and phone, street addresses, access notes, descriptions and internal notes; the
// customer is the name alone, and the place is the city.

/** A time on the business's wall clock: `2026-11-10 09:15`. */
function localDateTime(instant: string | null, timeZone: string): string {
  if (instant === null) {
    return "";
  }
  const { date, time } = instantToWallClock(instant, timeZone);
  return `${date} ${time}`;
}

export interface Column<Row> {
  header: string;
  value: (row: Row, timeZone: string) => string | number | null;
}

export const REQUEST_COLUMNS: ReadonlyArray<Column<AdminRequestListItemDto>> = [
  { header: "Reference", value: (row) => row.reference },
  { header: "Status", value: (row) => row.statusLabel },
  { header: "Submitted", value: (row, zone) => localDateTime(row.submittedAt, zone) },
  { header: "Service", value: (row) => row.serviceName },
  { header: "Customer", value: (row) => row.customerName },
  { header: "City", value: (row) => row.city },
  { header: "Preferred date", value: (row) => row.preferredDate },
  { header: "Last updated", value: (row, zone) => localDateTime(row.updatedAt, zone) },
];

export const JOB_COLUMNS: ReadonlyArray<Column<AdminWorkOrderListItemDto>> = [
  { header: "Reference", value: (row) => row.reference },
  { header: "Status", value: (row) => row.statusLabel },
  { header: "Service", value: (row) => row.serviceName },
  { header: "Customer", value: (row) => row.customerName },
  { header: "City", value: (row) => row.city },
  { header: "Scheduled start", value: (row, zone) => localDateTime(row.scheduledStart, zone) },
  { header: "Scheduled end", value: (row, zone) => localDateTime(row.scheduledEnd, zone) },
  { header: "Technician", value: (row) => row.technician?.name ?? null },
  { header: "Completed", value: (row, zone) => localDateTime(row.completedAt, zone) },
  { header: "Created", value: (row, zone) => localDateTime(row.createdAt, zone) },
];

export const INVOICE_COLUMNS: ReadonlyArray<Column<AdminInvoiceListItemDto>> = [
  { header: "Invoice number", value: (row) => row.invoiceNumber },
  { header: "Status", value: (row) => row.statusLabel },
  { header: "Job", value: (row) => row.jobReference },
  { header: "Customer", value: (row) => row.customerName },
  { header: "Issue date", value: (row) => row.issueDate },
  { header: "Due date", value: (row) => row.dueDate },
  { header: "Currency", value: (row) => row.currencyCode },
  { header: "Total", value: (row) => row.totalAmount },
  { header: "Paid", value: (row) => row.amountPaid },
  { header: "Balance due", value: (row) => row.balanceDue },
  { header: "Days overdue", value: (row) => row.daysOverdue },
];

// ---- Streaming -------------------------------------------------------------------------------------------

/**
 * The file as chunks. The first batch is read before this returns, so a problem with the query or the
 * database is a normal error response and not a broken download; after that the rows follow batch by
 * batch, each read starting after the last row of the one before (a cursor on the ordered rows), so a
 * large list is never held in memory.
 */
export async function startExport<Source extends { id: string }, Row>(input: {
  readBatch: (afterId: string | undefined) => Promise<Source[]>;
  toRow: (source: Source) => Row;
  columns: ReadonlyArray<Column<Row>>;
  timeZone: string;
}): Promise<AsyncGenerator<string, void, undefined>> {
  const { readBatch, toRow, columns, timeZone } = input;
  const first = await readBatch(undefined);

  async function* generate(): AsyncGenerator<string, void, undefined> {
    yield CSV_BOM + csvRecord(columns.map((column) => column.header));
    let batch = first;
    while (batch.length > 0) {
      yield batch
        .map((source) => {
          const row = toRow(source);
          return csvRecord(columns.map((column) => column.value(row, timeZone)));
        })
        .join("");
      const last = batch[batch.length - 1];
      if (batch.length < EXPORT_BATCH_SIZE || last === undefined) {
        return;
      }
      batch = await readBatch(last.id);
    }
  }
  return generate();
}

/** The paging part of a read: the next batch after the row `afterId`, or the first. */
interface BatchPaging {
  take: number;
  cursor?: { id: string };
  skip?: number;
}

function after(afterId: string | undefined): BatchPaging {
  return afterId === undefined
    ? { take: EXPORT_BATCH_SIZE }
    : { take: EXPORT_BATCH_SIZE, cursor: { id: afterId }, skip: 1 };
}

const filename = (kind: ExportKind, today: string) => `fixflow-${kind}-${today}.csv`;

/**
 * `GET /admin/exports/requests.csv`: the requests the queue would list for the same filters, all of
 * them (there is no page), in the queue's order.
 */
export async function exportRequests(
  deps: ExportDeps,
  query: AdminRequestsQuery,
): Promise<CsvExport> {
  const { prisma, clock } = deps;
  // A quotation that ran out of time moves its request back under review: save that first (D-23).
  // The settings are read beside the sync, which never changes them (D-118).
  const [business] = await Promise.all([loadBusiness(prisma), syncExpiredQuotationsIfDue(deps)]);
  const where = requestWithStatus(requestFilters(query, business.timeZone), query);
  const chunks = await startExport({
    readBatch: (afterId) =>
      prisma.serviceRequest.findMany({
        where,
        select: REQUEST_LIST_SELECT,
        orderBy: [{ [query.sort]: query.order }, { id: "asc" }],
        ...after(afterId),
      }),
    toRow: toAdminRequestListItem,
    columns: REQUEST_COLUMNS,
    timeZone: business.timeZone,
  });
  return {
    filename: filename("requests", dateOnlyInTimeZone(clock.now(), business.timeZone)),
    chunks,
  };
}

/** `GET /admin/exports/jobs.csv`: the jobs the jobs list would show for the same tab and filters. */
export async function exportJobs(
  deps: ExportDeps,
  query: AdminWorkOrdersQuery,
): Promise<CsvExport> {
  const { prisma, clock } = deps;
  const business = await loadBusiness(prisma);
  const where = jobWithViewAndStatus(jobFilters(query, business.timeZone), query);
  const chunks = await startExport({
    readBatch: (afterId) =>
      prisma.workOrder.findMany({
        where,
        select: JOB_LIST_SELECT,
        orderBy: [jobsOrderBy(query.sort, query.order), { id: "asc" }],
        ...after(afterId),
      }),
    toRow: toAdminWorkOrderListItem,
    columns: JOB_COLUMNS,
    timeZone: business.timeZone,
  });
  return {
    filename: filename("jobs", dateOnlyInTimeZone(clock.now(), business.timeZone)),
    chunks,
  };
}

/**
 * `GET /admin/exports/invoices.csv`: the invoices the invoices list would show for the same filters.
 * Any overdue invoice is saved first, so the status column says what the screens say.
 */
export async function exportInvoices(
  deps: ExportDeps,
  query: AdminInvoicesQuery,
): Promise<CsvExport> {
  const { prisma, clock } = deps;
  // The settings are read beside the sync, which never changes them (D-118).
  const [settings] = await Promise.all([
    loadInvoiceSettings(prisma),
    syncOverdueInvoicesIfDue(deps),
  ]);
  const now = clock.now();
  const context = { now, timeZone: settings.timeZone };
  const where = invoiceWithStatus(invoiceFilters(query), query);
  const chunks = await startExport({
    readBatch: (afterId) =>
      prisma.invoice.findMany({
        where,
        select: INVOICE_LIST_SELECT,
        orderBy: [invoiceOrderBy(query.sort, query.order), { id: "asc" }],
        ...after(afterId),
      }),
    toRow: (row) => toAdminInvoiceListItem(row, context),
    columns: INVOICE_COLUMNS,
    timeZone: settings.timeZone,
  });
  return { filename: filename("invoices", dateOnlyInTimeZone(now, settings.timeZone)), chunks };
}
