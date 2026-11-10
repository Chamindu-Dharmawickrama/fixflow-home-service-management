import {
  CUSTOMER_INVOICE_STATUSES,
  type CustomerInvoiceDto,
  type CustomerInvoiceListResponse,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { paginated } from "../../lib/pagination.js";
import { canActAsAdmin, canActAsCustomer } from "../auth/auth.domain.js";
import { assertCustomerOwns } from "../auth/auth.middleware.js";
import type { AuthContext } from "../auth/auth.types.js";
import { customerIdOf } from "../customers/customers.service.js";
import {
  CUSTOMER_INVOICE_DETAIL_SELECT,
  CUSTOMER_INVOICE_LIST_SELECT,
  type CustomerInvoiceDetailRow,
  toCustomerInvoiceDto,
  toCustomerInvoiceListItem,
} from "./invoices.customer.dto.js";
import type { InvoiceSettingsRow } from "./invoices.dto.js";
import type { ListMyInvoicesQuery } from "./invoices.schemas.js";
import { loadSettings, syncOverdueInvoicesIfDue } from "./invoices.service.js";

/**
 * The customer's side of an invoice (T22, spec §7.6 steps 4 to 5, §7.7, FR-072, IA-C05): their list,
 * and one invoice in the shape they are allowed to see (D-41). Whose invoices they are comes from the
 * session, never from the request. A customer is only ever shown an invoice that was issued: a draft
 * is the business's working copy, and a draft that was voided never reached them (D-26, D-110).
 */

type CustomerInvoiceDeps = Pick<AppDeps, "prisma" | "clock" | "config">;

// ---- The list ------------------------------------------------------------------------------------

/**
 * `GET /invoices/me`: the signed-in customer's invoices, newest first (by issue date, then by the
 * moment it was issued), with an optional status filter. Any overdue invoice is saved first, so the
 * `OVERDUE` filter is exactly what the screens show.
 */
export async function listMyInvoices(
  deps: Pick<AppDeps, "prisma" | "clock">,
  auth: AuthContext,
  query: ListMyInvoicesQuery,
): Promise<CustomerInvoiceListResponse> {
  const { prisma, clock } = deps;
  const customerId = customerIdOf(auth);
  await syncOverdueInvoicesIfDue(deps);
  const settings = await loadSettings(prisma);

  const where: Prisma.InvoiceWhereInput = {
    customerId,
    // `issuedAt` is set for every invoice a customer was ever shown, and for nothing else.
    issuedAt: { not: null },
    status: { in: query.status ?? [...CUSTOMER_INVOICE_STATUSES] },
  };
  const [rows, totalItems] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: CUSTOMER_INVOICE_LIST_SELECT,
      orderBy: [{ [query.sort]: query.order }, { issuedAt: query.order }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.invoice.count({ where }),
  ]);

  const context = { now: clock.now(), timeZone: settings.timeZone };
  return paginated(
    rows.map((row) => toCustomerInvoiceListItem(row, context)),
    query,
    totalItems,
  );
}

// ---- Who may read one ----------------------------------------------------------------------------

/**
 * Decides, from the owner's id alone, whether the caller may read this invoice; nothing else is read
 * for a caller who may not. The owner gets an issued invoice; another customer, and the owner of a
 * draft, get `404` exactly like an id that does not exist (BR-21). An admin may read any invoice that
 * was issued. `allowDraft` lets the admin's PDF through for a draft or an unissued void one, which the
 * customer's page never shows.
 */
export async function authorizeInvoiceRead(
  deps: CustomerInvoiceDeps,
  auth: AuthContext,
  id: string,
  options: { allowDraftForAdmin: boolean },
): Promise<void> {
  const owner = await deps.prisma.invoice.findUnique({
    where: { id },
    select: { customerId: true, issuedAt: true },
  });
  if (canActAsCustomer(auth)) {
    assertCustomerOwns(owner?.customerId, auth);
    if (owner?.issuedAt === null) {
      throw notFound();
    }
  } else if (canActAsAdmin(auth, deps.config.auth.adminEmails)) {
    if (owner === null || (owner.issuedAt === null && !options.allowDraftForAdmin)) {
      throw notFound();
    }
  } else {
    throw forbidden();
  }
}

/** The invoice's row for the customer's shapes and the PDF, with the settings the fallbacks need. */
export async function readCustomerInvoiceRow(
  db: Pick<AppDeps["prisma"], "invoice" | "businessSettings">,
  id: string,
): Promise<{ row: CustomerInvoiceDetailRow; settings: InvoiceSettingsRow }> {
  const [row, settings] = await Promise.all([
    db.invoice.findUnique({ where: { id }, select: CUSTOMER_INVOICE_DETAIL_SELECT }),
    loadSettings(db),
  ]);
  if (row === null) {
    throw notFound();
  }
  return { row, settings };
}

// ---- One invoice ---------------------------------------------------------------------------------

/**
 * `GET /invoices/:id`: the invoice as its customer sees it (D-41). The owner gets it once it was
 * issued; an admin gets the same shape, as a preview of what the customer sees.
 */
export async function getCustomerInvoice(
  deps: CustomerInvoiceDeps,
  auth: AuthContext,
  id: string,
): Promise<CustomerInvoiceDto> {
  await authorizeInvoiceRead(deps, auth, id, { allowDraftForAdmin: false });
  await syncOverdueInvoicesIfDue(deps);
  const { row, settings } = await readCustomerInvoiceRow(deps.prisma, id);
  return toCustomerInvoiceDto({
    row,
    context: { now: deps.clock.now(), timeZone: settings.timeZone },
    settings,
  });
}
