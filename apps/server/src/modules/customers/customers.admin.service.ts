import {
  ActivityEntityType,
  type AdminCustomerDto,
  type AdminCustomerListResponse,
  type AdminCustomerNoteDto,
  type AdminCustomerSortField,
  CUSTOMER_NOTES_SHOWN,
  CUSTOMER_RECENT_COUNT,
  type CustomerHistoryItemByType,
  type CustomerHistoryResponse,
  type CustomerHistoryType,
  type SortOrder,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import { Prisma } from "../../generated/prisma/client.js";
import { BUSINESS_SETTINGS_ID, type DbClient } from "../../lib/db.js";
import { notFound, serviceUnavailable } from "../../lib/errors.js";
import { paginated } from "../../lib/pagination.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { recordActivity } from "../activity/activity.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import {
  customerSearchPatterns,
  OPEN_JOB_STATUSES,
  OUTSTANDING_INVOICE_STATUSES,
  outstandingBalance,
} from "./customers.admin.domain.js";
import {
  ADMIN_CUSTOMER_DETAIL_SELECT,
  ADMIN_CUSTOMER_LIST_SELECT,
  CUSTOMER_NOTE_SELECT,
  HISTORY_INVOICE_SELECT,
  HISTORY_JOB_SELECT,
  HISTORY_QUOTATION_SELECT,
  HISTORY_REQUEST_SELECT,
  toAdminCustomerDto,
  toAdminCustomerListItem,
  toAdminCustomerNote,
  toAdminCustomerRecent,
  toHistoryInvoice,
  toHistoryJob,
  toHistoryQuotation,
  toHistoryRequest,
} from "./customers.admin.dto.js";
import type {
  AddCustomerNoteInput,
  AdminCustomersQuery,
  CustomerHistoryQuery,
} from "./customers.admin.schemas.js";

type AdminCustomerDeps = Pick<AppDeps, "prisma">;

const NOT_SET_UP = "The business settings have not been set up yet.";

/** The currency money is shown in: the business's (D-26). Invoices in another currency are not summed into it. */
async function loadCurrencyCode(db: DbClient): Promise<string> {
  const settings = await db.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { currencyCode: true },
  });
  if (settings === null) {
    // The seed creates the row; its absence is a deployment problem, not something to hide as a 404.
    throw serviceUnavailable(NOT_SET_UP);
  }
  return settings.currencyCode;
}

// ---- What each customer has: grouped, never per row (FR-031) ---------------------------------

interface CustomerAggregates {
  requestCount: number;
  openJobCount: number;
  outstandingBalance: string;
}

/**
 * The counts and the balance for a set of customers, in three grouped queries however many there
 * are (no query per customer). A customer with nothing has no group, so they come back as zeros.
 *
 * The balance is Σ (total − paid) over issued, partially paid and overdue invoices (D-26), in the
 * business's currency: the invoices of one customer can only be added together in one currency.
 */
async function loadAggregates(
  db: DbClient,
  customerIds: readonly string[],
  currencyCode: string,
): Promise<Map<string, CustomerAggregates>> {
  const [requests, openJobs, invoices] = await Promise.all([
    db.serviceRequest.groupBy({
      by: ["customerId"],
      where: { customerId: { in: [...customerIds] } },
      _count: { _all: true },
    }),
    db.workOrder.groupBy({
      by: ["customerId"],
      where: { customerId: { in: [...customerIds] }, status: { in: [...OPEN_JOB_STATUSES] } },
      _count: { _all: true },
    }),
    db.invoice.groupBy({
      by: ["customerId"],
      where: {
        customerId: { in: [...customerIds] },
        status: { in: [...OUTSTANDING_INVOICE_STATUSES] },
        currencyCode,
      },
      _sum: { totalAmount: true, amountPaid: true },
    }),
  ]);

  const requestCounts = new Map(requests.map((group) => [group.customerId, group._count._all]));
  const openJobCounts = new Map(openJobs.map((group) => [group.customerId, group._count._all]));
  const sums = new Map(invoices.map((group) => [group.customerId, group._sum]));

  return new Map(
    customerIds.map((id) => [
      id,
      {
        requestCount: requestCounts.get(id) ?? 0,
        openJobCount: openJobCounts.get(id) ?? 0,
        outstandingBalance: outstandingBalance(
          sums.get(id) ?? { totalAmount: null, amountPaid: null },
        ),
      },
    ]),
  );
}

// ---- The list (FR-031) -----------------------------------------------------------------------

interface PageRow {
  id: string;
  last_activity_at: Date;
}

/**
 * The search as a SQL condition. The text is bound as a parameter (never joined into the query) and
 * its wildcards are escaped. Name and email match case-insensitively; a phone number matches on its
 * digits alone, so "212-555" finds "(212) 555-0100".
 */
export function searchCondition(q: string | undefined): Prisma.Sql {
  if (q === undefined) {
    return Prisma.sql`TRUE`;
  }
  const { text, phoneDigits } = customerSearchPatterns(q);
  const phone =
    phoneDigits === undefined
      ? Prisma.empty
      : Prisma.sql` OR regexp_replace(COALESCE(cp.phone, ''), '[^0-9]', '', 'g') LIKE ${phoneDigits}`;
  return Prisma.sql`(u.name ILIKE ${text} OR u.email ILIKE ${text}${phone})`;
}

/**
 * The sort as a SQL fragment, from fixed text only: the field is chosen from an allowlist and the
 * direction from two literals, so nothing the caller sent becomes SQL. The id makes the order
 * total, so rows with equal values never repeat or vanish between pages.
 */
export function sortClause(sort: AdminCustomerSortField, order: SortOrder): Prisma.Sql {
  const direction = order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  switch (sort) {
    case "name":
      return Prisma.sql`LOWER(u.name) ${direction}, cp.id ASC`;
    case "createdAt":
      return Prisma.sql`cp.created_at ${direction}, cp.id ASC`;
    case "lastActivityAt":
      return Prisma.sql`last_activity_at ${direction}, cp.id ASC`;
  }
}

/**
 * The customers' directory: search, sort and a page of rows, each with its counts and balance.
 *
 * "Last activity" is the latest recorded event about the customer (`activity_events.customer_id`),
 * or the day they signed up when there is none, so it always has a value to sort by. Because
 * sorting by it needs it for every matching customer, the page of ids comes from one SQL query that
 * joins the grouped maximum; everything else is then fetched for that page only.
 */
export async function listAdminCustomers(
  deps: AdminCustomerDeps,
  query: AdminCustomersQuery,
): Promise<AdminCustomerListResponse> {
  const { prisma } = deps;
  const where = searchCondition(query.q);
  const offset = (query.page - 1) * query.pageSize;

  const [currencyCode, pageRows, counted] = await Promise.all([
    loadCurrencyCode(prisma),
    prisma.$queryRaw<PageRow[]>`
      SELECT cp.id AS id, COALESCE(activity.last_at, cp.created_at) AS last_activity_at
      FROM customer_profiles cp
      JOIN users u ON u.id = cp.user_id
      LEFT JOIN (
        SELECT customer_id, MAX(created_at) AS last_at
        FROM activity_events
        WHERE customer_id IS NOT NULL
        GROUP BY customer_id
      ) activity ON activity.customer_id = cp.id
      WHERE ${where}
      ORDER BY ${sortClause(query.sort, query.order)}
      LIMIT ${query.pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM customer_profiles cp
      JOIN users u ON u.id = cp.user_id
      WHERE ${where}`,
  ]);
  const totalItems = counted[0]?.total ?? 0;

  if (pageRows.length === 0) {
    return paginated([], query, totalItems);
  }

  const ids = pageRows.map((row) => row.id);
  const [rows, aggregates] = await Promise.all([
    prisma.customerProfile.findMany({
      where: { id: { in: ids } },
      select: ADMIN_CUSTOMER_LIST_SELECT,
    }),
    loadAggregates(prisma, ids, currencyCode),
  ]);
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const items = pageRows.flatMap((page) => {
    const row = rowsById.get(page.id);
    const totals = aggregates.get(page.id);
    return row === undefined || totals === undefined
      ? []
      : [
          toAdminCustomerListItem({
            row,
            lastActivityAt: page.last_activity_at,
            currencyCode,
            ...totals,
          }),
        ];
  });
  return paginated(items, query, totalItems);
}

// ---- A customer's records, one kind at a time (FR-031) ---------------------------------------

interface HistoryKind<Row> {
  count: (db: DbClient, customerId: string) => Promise<number>;
  /** Newest first. Every query names the customer, so no other customer's record can appear. */
  page: (
    db: DbClient,
    customerId: string,
    window: { skip: number; take: number },
  ) => Promise<Row[]>;
}

const HISTORY: { [Type in CustomerHistoryType]: HistoryKind<CustomerHistoryItemByType[Type]> } = {
  requests: {
    count: (db, customerId) => db.serviceRequest.count({ where: { customerId } }),
    page: async (db, customerId, window) =>
      (
        await db.serviceRequest.findMany({
          where: { customerId },
          select: HISTORY_REQUEST_SELECT,
          orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
          ...window,
        })
      ).map(toHistoryRequest),
  },
  quotations: {
    count: (db, customerId) => db.quotation.count({ where: { customerId } }),
    page: async (db, customerId, window) =>
      (
        await db.quotation.findMany({
          where: { customerId },
          select: HISTORY_QUOTATION_SELECT,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          ...window,
        })
      ).map(toHistoryQuotation),
  },
  jobs: {
    count: (db, customerId) => db.workOrder.count({ where: { customerId } }),
    page: async (db, customerId, window) =>
      (
        await db.workOrder.findMany({
          where: { customerId },
          select: HISTORY_JOB_SELECT,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          ...window,
        })
      ).map(toHistoryJob),
  },
  invoices: {
    count: (db, customerId) => db.invoice.count({ where: { customerId } }),
    page: async (db, customerId, window) =>
      (
        await db.invoice.findMany({
          where: { customerId },
          select: HISTORY_INVOICE_SELECT,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          ...window,
        })
      ).map(toHistoryInvoice),
  },
};

async function assertCustomerExists(db: DbClient, id: string): Promise<void> {
  const customer = await db.customerProfile.findUnique({ where: { id }, select: { id: true } });
  if (customer === null) {
    throw notFound();
  }
}

/** One page of one kind of record for a customer: the tabs on the customer's page. */
export async function listCustomerHistory(
  deps: AdminCustomerDeps,
  customerId: string,
  query: CustomerHistoryQuery,
): Promise<CustomerHistoryResponse> {
  const { prisma } = deps;
  await assertCustomerExists(prisma, customerId);

  const kind = HISTORY[query.type];
  const [rows, totalItems] = await Promise.all([
    kind.page(prisma, customerId, {
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    kind.count(prisma, customerId),
  ]);
  // The rows are of the one kind asked for; the response type is the union of the four.
  return paginated<CustomerHistoryItemByType[CustomerHistoryType]>(rows, query, totalItems);
}

// ---- One customer (FR-030, FR-031, FR-033) ---------------------------------------------------

/**
 * A customer in full for the business: contact details, every address with its access notes, the
 * counts and the balance, the latest few records of each kind and the internal notes. The long
 * lists (the whole history) come page by page from {@link listCustomerHistory}.
 */
export async function getAdminCustomer(
  deps: AdminCustomerDeps,
  id: string,
): Promise<AdminCustomerDto> {
  const { prisma } = deps;
  const row = await prisma.customerProfile.findUnique({
    where: { id },
    select: ADMIN_CUSTOMER_DETAIL_SELECT,
  });
  if (row === null) {
    throw notFound();
  }

  const recentWindow = { skip: 0, take: CUSTOMER_RECENT_COUNT };
  const [
    currencyCode,
    latestEvent,
    quotationCount,
    jobCount,
    invoiceCount,
    requests,
    quotations,
    jobs,
    invoices,
    notes,
  ] = await Promise.all([
    loadCurrencyCode(prisma),
    prisma.activityEvent.aggregate({ where: { customerId: id }, _max: { createdAt: true } }),
    HISTORY.quotations.count(prisma, id),
    HISTORY.jobs.count(prisma, id),
    HISTORY.invoices.count(prisma, id),
    prisma.serviceRequest.findMany({
      where: { customerId: id },
      select: HISTORY_REQUEST_SELECT,
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      take: recentWindow.take,
    }),
    prisma.quotation.findMany({
      where: { customerId: id },
      select: HISTORY_QUOTATION_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: recentWindow.take,
    }),
    prisma.workOrder.findMany({
      where: { customerId: id },
      select: HISTORY_JOB_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: recentWindow.take,
    }),
    prisma.invoice.findMany({
      where: { customerId: id },
      select: HISTORY_INVOICE_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: recentWindow.take,
    }),
    prisma.customerNote.findMany({
      where: { customerId: id },
      select: CUSTOMER_NOTE_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CUSTOMER_NOTES_SHOWN,
    }),
  ]);
  const totals = (await loadAggregates(prisma, [id], currencyCode)).get(id);

  return toAdminCustomerDto({
    row,
    lastActivityAt: latestEvent._max.createdAt ?? row.createdAt,
    summary: {
      requestCount: totals?.requestCount ?? 0,
      quotationCount,
      jobCount,
      openJobCount: totals?.openJobCount ?? 0,
      invoiceCount,
      outstandingBalance: totals?.outstandingBalance ?? "0.00",
      currencyCode,
    },
    recent: toAdminCustomerRecent({ requests, quotations, jobs, invoices }),
    notes,
  });
}

// ---- Internal notes (FR-033, SEC-DATA-03) ----------------------------------------------------

/**
 * Adds an internal note to a customer. A customer note is never visible to the customer: nothing in
 * the customer's own endpoints reads this table, and its event has no customer summary, so no
 * timeline shows it to them. The note and its event are written together or not at all, and a note
 * cannot be edited or deleted afterwards.
 */
export async function addCustomerNote(
  deps: AdminCustomerDeps,
  auth: AuthContext,
  customerId: string,
  input: AddCustomerNoteInput,
): Promise<AdminCustomerNoteDto> {
  return deps.prisma.$transaction(async (tx) => {
    const customer = await tx.customerProfile.findUnique({
      where: { id: customerId },
      select: { user: { select: { name: true } } },
    });
    if (customer === null) {
      throw notFound();
    }
    const note = await tx.customerNote.create({
      data: { customerId, authorUserId: auth.userId, body: input.body },
      select: CUSTOMER_NOTE_SELECT,
    });

    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.CUSTOMER,
      entityId: customerId,
      customerId,
      action: "customer.note_added",
      // The text of the note is free text and stays in its own table, out of the event.
      ...buildActivitySummaries({
        actor: { kind: "staff", name: note.author.name },
        staff: `added an internal note about ${customer.user.name}`,
      }),
    });
    return toAdminCustomerNote(note);
  });
}
