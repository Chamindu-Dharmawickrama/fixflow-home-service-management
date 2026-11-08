import {
  ActivityEntityType,
  type AdminInvoiceDto,
  type AdminInvoiceListResponse,
  calculateDocumentTotals,
  dateOnlyInTimeZone,
  DocumentTotalsError,
  type DocumentTotalsResult,
  ErrorCode,
  type InvoiceLineBody,
  InvoiceStatus,
  NotificationType,
  ReferenceType,
  type SortOrder,
  WorkOrderStatus,
  workOrderStatusLabel,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { fromDateOnly, toDateOnly } from "../../lib/date-only.js";
import { BUSINESS_SETTINGS_ID, type DbClient, isUniqueViolation } from "../../lib/db.js";
import { conflict, notFound, serviceUnavailable, validation } from "../../lib/errors.js";
import { paginated, toPrismaPage } from "../../lib/pagination.js";
import { nextReference } from "../../lib/references.js";
import { escapeLikePattern } from "../../lib/sql-like.js";
import { runInTransaction } from "../../lib/transaction.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { getTimeline, recordActivity } from "../activity/activity.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { absoluteAppUrl } from "../email/email.domain.js";
import { emailJob } from "../email/email.jobs.js";
import { notify } from "../notifications/notifications.service.js";
import { lockWorkOrder } from "../work-orders/work-orders.transitions.js";
import {
  assertInvoiceTransition,
  createdTexts,
  defaultDueDate,
  effectiveIssueDate,
  invoiceExistsError,
  invoiceHasPaymentsError,
  invoiceNotEditableError,
  InvoiceTrigger,
  issuedNotification,
  issuedTexts,
  issueProblems,
  staleInvoiceError,
  voidedNotification,
  voidedTexts,
} from "./invoices.domain.js";
import {
  businessSnapshotOf,
  customerSnapshotOf,
  INVOICE_DETAIL_SELECT,
  INVOICE_LIST_SELECT,
  INVOICE_SETTINGS_SELECT,
  type InvoiceSettingsRow,
  toAdminInvoiceDto,
  toAdminInvoiceListItem,
} from "./invoices.dto.js";
import type {
  AdminInvoicesQuery,
  IssueInvoiceInput,
  UpdateInvoiceInput,
  VoidInvoiceInput,
} from "./invoices.schemas.js";
import { lockInvoice, syncOverdueInvoices, transitionInvoice } from "./invoices.transitions.js";

type InvoiceDeps = Pick<AppDeps, "prisma" | "clock" | "config" | "emailDispatcher">;

const NOT_SET_UP = "The business settings have not been set up yet.";

async function loadSettings(db: Pick<DbClient, "businessSettings">): Promise<InvoiceSettingsRow> {
  const settings = await db.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: INVOICE_SETTINGS_SELECT,
  });
  if (settings === null) {
    // The seed creates the row; its absence is a deployment problem, not something to hide as a 404.
    throw serviceUnavailable(NOT_SET_UP);
  }
  return settings;
}

/**
 * The totals of the lines, or `422` with a message against each field that cannot be used. The one
 * calculation shared with the editor (D-19, D-44): whatever a client believes the totals are, these
 * are what is stored.
 */
function totalsOf(input: {
  lines: readonly InvoiceLineBody[];
  discountAmount: string;
  taxRate: string;
}): DocumentTotalsResult {
  try {
    return calculateDocumentTotals(input);
  } catch (error) {
    if (error instanceof DocumentTotalsError) {
      throw validation(error.fieldErrors);
    }
    throw error;
  }
}

function totalsData(totals: DocumentTotalsResult) {
  return {
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxableBase: totals.taxableBase,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
  };
}

function lineRows(lines: readonly InvoiceLineBody[], totals: DocumentTotalsResult) {
  return lines.map((line, index) => ({
    position: index + 1,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxable: line.taxable,
    lineSubtotal: totals.lines[index]?.lineSubtotal ?? "0.00",
  }));
}

// ---- Overdue before reads (D-23) -----------------------------------------------------------------

/**
 * Saves any overdue invoice that is due before a read or an action looks at one (D-23). One cheap
 * query decides whether there is anything to do; only then does a transaction run. Safe to call from
 * any read, from any number of requests at once.
 */
export async function syncOverdueInvoicesIfDue(
  deps: Pick<AppDeps, "prisma" | "clock">,
): Promise<void> {
  const settings = await deps.prisma.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { timeZone: true },
  });
  if (settings === null) {
    return; // the read that follows reports the missing settings itself
  }
  const now = deps.clock.now();
  const today = dateOnlyInTimeZone(now, settings.timeZone);
  const due = await deps.prisma.invoice.findFirst({
    where: {
      status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
      dueDate: { lt: fromDateOnly(today) },
    },
    select: { id: true },
  });
  if (due === null) {
    return;
  }
  await deps.prisma.$transaction((tx) => syncOverdueInvoices(tx, now));
}

// ---- Reading one (FR-074) ------------------------------------------------------------------------

/** The invoice for the business, as it is now. No sync: callers that read after a write have just made it right. */
async function readAdminInvoice(db: DbClient, now: Date, id: string): Promise<AdminInvoiceDto> {
  const [row, settings] = await Promise.all([
    db.invoice.findUnique({ where: { id }, select: INVOICE_DETAIL_SELECT }),
    loadSettings(db),
  ]);
  if (row === null) {
    throw notFound();
  }
  const timeline = await getTimeline(
    db,
    { entityType: ActivityEntityType.INVOICE, entityId: id },
    "admin",
  );
  return toAdminInvoiceDto({
    row,
    context: { now, timeZone: settings.timeZone },
    settings,
    timeline,
  });
}

/** `GET /admin/invoices/:id`: the whole invoice for the business, after saving any overdue that is due. */
export async function getAdminInvoice(
  deps: Pick<AppDeps, "prisma" | "clock">,
  id: string,
): Promise<AdminInvoiceDto> {
  await syncOverdueInvoicesIfDue(deps);
  return readAdminInvoice(deps.prisma, deps.clock.now(), id);
}

// ---- The list (FR-074) ---------------------------------------------------------------------------

/**
 * The filters that are not the status, as one `where`. The chip counts are computed from exactly
 * this (so each chip says what choosing it would show), and the list adds the statuses on top.
 */
function filtersWhere(query: AdminInvoicesQuery): Prisma.InvoiceWhereInput {
  // `contains` hands the text to ILIKE as it is, so `%` and `_` would act as wildcards.
  const contains =
    query.q === undefined
      ? undefined
      : ({ contains: escapeLikePattern(query.q), mode: "insensitive" } as const);
  const dayRange = (from: string | undefined, to: string | undefined) =>
    from === undefined && to === undefined
      ? undefined
      : {
          ...(from !== undefined && { gte: fromDateOnly(from) }),
          ...(to !== undefined && { lte: fromDateOnly(to) }),
        };
  const due = dayRange(query.dueFrom, query.dueTo);
  const issued = dayRange(query.issuedFrom, query.issuedTo);

  return {
    ...(query.customerId !== undefined && { customerId: query.customerId }),
    ...(due !== undefined && { dueDate: due }),
    ...(issued !== undefined && { issueDate: issued }),
    ...(contains !== undefined && {
      OR: [
        { invoiceNumber: contains },
        { customer: { user: { name: contains } } },
        { workOrder: { reference: contains } },
      ],
    }),
  };
}

/** Sorting on a column that can be empty (a draft has no issue date) puts the empty ones last. */
function orderByOf(sort: AdminInvoicesQuery["sort"], order: SortOrder) {
  return sort === "issueDate" || sort === "dueDate"
    ? { [sort]: { sort: order, nulls: "last" as const } }
    : { [sort]: order };
}

/**
 * `GET /admin/invoices`: invoices with filters, sort and pages, plus how many each status chip would
 * show. Any overdue invoice is saved first, so the `OVERDUE` filter is exactly what the screens show.
 */
export async function listAdminInvoices(
  deps: Pick<AppDeps, "prisma" | "clock">,
  query: AdminInvoicesQuery,
): Promise<AdminInvoiceListResponse> {
  const { prisma, clock } = deps;
  await syncOverdueInvoicesIfDue(deps);
  const now = clock.now();
  const settings = await loadSettings(prisma);

  const base = filtersWhere(query);
  const where: Prisma.InvoiceWhereInput = {
    ...base,
    ...(query.status !== undefined && { status: { in: query.status } }),
  };

  const [rows, totalItems, groups] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: INVOICE_LIST_SELECT,
      ...toPrismaPage(query, orderByOf),
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);

  const counts = {
    all: 0,
    [InvoiceStatus.DRAFT]: 0,
    [InvoiceStatus.ISSUED]: 0,
    [InvoiceStatus.PARTIALLY_PAID]: 0,
    [InvoiceStatus.PAID]: 0,
    [InvoiceStatus.OVERDUE]: 0,
    [InvoiceStatus.VOID]: 0,
  };
  for (const group of groups) {
    counts[group.status] = group._count._all;
    counts.all += group._count._all;
  }

  const context = { now, timeZone: settings.timeZone };
  return {
    ...paginated(
      rows.map((row) => toAdminInvoiceListItem(row, context)),
      query,
      totalItems,
    ),
    meta: { counts },
  };
}

// ---- Creating a draft (FR-070) -------------------------------------------------------------------

/**
 * Starts the draft invoice for a completed job (spec §7.6 step 1, D-26). The server fills it in: the
 * lines, the discount and the tax rate of the quotation the customer accepted, its currency, and a
 * due date of today plus the usual number of days. The extra parts or labour are added afterwards, on
 * the draft (C-11).
 *
 * - The job must be `COMPLETED`: `409`.
 * - A job has at most one invoice that is not void: `409 INVOICE_EXISTS`, naming it. The job's row
 *   lock makes two creates take turns, and the partial unique index answers for any that slip past.
 */
export async function createInvoiceForWorkOrder(
  deps: Pick<AppDeps, "prisma" | "clock">,
  auth: AuthContext,
  workOrderId: string,
): Promise<AdminInvoiceDto> {
  const { prisma, clock } = deps;
  const now = clock.now();

  const id = await prisma.$transaction(async (tx) => {
    if (!(await lockWorkOrder(tx, workOrderId))) {
      throw notFound();
    }
    const job = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true,
        reference: true,
        status: true,
        requestId: true,
        customerId: true,
        quotationId: true,
      },
    });
    if (job === null) {
      throw notFound();
    }
    if (job.status !== WorkOrderStatus.COMPLETED) {
      throw conflict(
        `An invoice can only be created for a completed job. This job is ${workOrderStatusLabel(job.status).toLowerCase()}.`,
        { code: ErrorCode.INVALID_STATE_TRANSITION, details: { currentStatus: job.status } },
      );
    }

    const existing = await liveInvoiceOf(tx, workOrderId);
    if (existing !== null) {
      throw invoiceExistsError(existing);
    }

    const quotation = await tx.quotation.findUniqueOrThrow({
      where: { id: job.quotationId },
      select: {
        id: true,
        currencyCode: true,
        taxRate: true,
        discountAmount: true,
        lineItems: {
          orderBy: { position: "asc" },
          select: { description: true, quantity: true, unitPrice: true, taxable: true },
        },
      },
    });
    const settings = await loadSettings(tx);
    const lines: InvoiceLineBody[] = quotation.lineItems.map((line) => ({
      description: line.description,
      quantity: line.quantity.toFixed(2),
      unitPrice: line.unitPrice.toFixed(2),
      taxable: line.taxable,
    }));
    const taxRate = quotation.taxRate.toFixed(2);
    const totals = totalsOf({
      lines,
      discountAmount: quotation.discountAmount.toFixed(2),
      taxRate,
    });

    let createdId: string;
    try {
      const created = await tx.invoice.create({
        data: {
          workOrderId,
          quotationId: quotation.id,
          customerId: job.customerId,
          status: InvoiceStatus.DRAFT,
          currencyCode: quotation.currencyCode,
          taxRate,
          ...totalsData(totals),
          dueDate: fromDateOnly(defaultDueDate(now, settings.timeZone, settings.invoiceDueDays)),
          createdByUserId: auth.userId,
          lineItems: { create: lineRows(lines, totals) },
        },
        select: { id: true },
      });
      createdId = created.id;
    } catch (error) {
      // The database's own guard (one live invoice per job) lost a race the lock should prevent.
      if (isUniqueViolation(error)) {
        const winner = await liveInvoiceOf(tx, workOrderId);
        if (winner !== null) {
          throw invoiceExistsError(winner);
        }
      }
      throw error;
    }

    const actor = await tx.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { name: true },
    });
    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.INVOICE,
      entityId: createdId,
      requestId: job.requestId,
      customerId: job.customerId,
      action: "invoice.created",
      toStatus: InvoiceStatus.DRAFT,
      metadata: {
        reference: job.reference,
        workOrderReference: job.reference,
        lineItemCount: lines.length,
        currencyCode: quotation.currencyCode,
        totalAmount: totals.totalAmount,
      },
      // A draft is internal: no sentence for the customer, so it never reaches their timeline.
      ...buildActivitySummaries({
        actor: { kind: "staff", name: actor.name },
        ...createdTexts({ jobReference: job.reference }),
      }),
    });
    return createdId;
  });

  return readAdminInvoice(prisma, now, id);
}

/** The job's invoice that is not void, if it has one. */
async function liveInvoiceOf(db: DbClient, workOrderId: string) {
  return db.invoice.findFirst({
    where: { workOrderId, status: { not: InvoiceStatus.VOID } },
    select: { id: true, invoiceNumber: true, status: true },
  });
}

// ---- Saving a draft (FR-070, FR-071) -------------------------------------------------------------

/**
 * Saves a draft: replaces its lines and details and **recomputes every total from them**; nothing a
 * client says about a total is read (the schema refuses the field). Only a draft can be edited
 * (`409 INVOICE_NOT_EDITABLE`, the record untouched), and only from the version the editor loaded
 * (`409 STALE_STATE` when `expectedUpdatedAt` is no longer the stored one).
 */
export async function updateInvoice(
  deps: Pick<AppDeps, "prisma" | "clock">,
  id: string,
  input: UpdateInvoiceInput,
): Promise<AdminInvoiceDto> {
  const { prisma, clock } = deps;

  await prisma.$transaction(async (tx) => {
    if (!(await lockInvoice(tx, id))) {
      throw notFound();
    }
    const current = await tx.invoice.findUnique({
      where: { id },
      select: { status: true, updatedAt: true },
    });
    if (current === null) {
      throw notFound();
    }
    if (current.status !== InvoiceStatus.DRAFT) {
      throw invoiceNotEditableError(current.status);
    }
    if (new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) {
      throw staleInvoiceError(current.status);
    }

    const totals = totalsOf(input);
    // Conditional on the version that was read, so a save racing a save (or an issue) writes nothing.
    const { count } = await tx.invoice.updateMany({
      where: { id, status: InvoiceStatus.DRAFT, updatedAt: current.updatedAt },
      data: {
        taxRate: input.taxRate,
        ...totalsData(totals),
        issueDate: input.issueDate === null ? null : fromDateOnly(input.issueDate),
        dueDate: fromDateOnly(input.dueDate),
        customerNote: input.customerNote,
      },
    });
    if (count === 0) {
      const latest = await tx.invoice.findUnique({ where: { id }, select: { status: true } });
      if (latest === null) {
        throw notFound();
      }
      throw latest.status === InvoiceStatus.DRAFT
        ? staleInvoiceError(latest.status)
        : invoiceNotEditableError(latest.status);
    }
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
    await tx.invoiceLineItem.createMany({
      data: lineRows(input.lines, totals).map((line) => ({ ...line, invoiceId: id })),
    });
  });

  return readAdminInvoice(prisma, clock.now(), id);
}

// ---- Issuing (FR-071, FR-077, D-17) --------------------------------------------------------------

/**
 * Issues a draft. One transaction holds everything that must be true together: the invoice number is
 * taken, the draft becomes `ISSUED` with its issue date and the business, customer, payment
 * instructions and footer details frozen on it (DM-04), the history gets its event and the customer
 * gets their notification. The email is queued in it and sent only after the commit (BR-22).
 *
 * The number comes from `nextReference` inside this same transaction, so if anything after it fails
 * the counter rolls back with everything else: a number is never taken and lost, and `INV-` numbers
 * have no gaps. It is duplicate-safe: the invoice's row lock makes two issues take turns, the status
 * change is conditional on the invoice still being a draft, and `expectedStatus` turns the second
 * of two clicks into `409 STALE_STATE`. So exactly one number is taken and one notification sent.
 *
 * Before it goes, the draft needs at least one line, a total above zero and a due date on or after
 * the issue date (`422`, naming the field).
 */
export async function issueInvoice(
  deps: InvoiceDeps,
  auth: AuthContext,
  id: string,
  input: IssueInvoiceInput,
): Promise<AdminInvoiceDto> {
  const { prisma, clock, config, emailDispatcher } = deps;
  const now = clock.now();

  const { afterCommit } = await runInTransaction(prisma, async (tx, after) => {
    if (!(await lockInvoice(tx, id))) {
      throw notFound();
    }
    // One relation at a time: a transaction has a single connection (see `voidQuotation`).
    const invoice = await tx.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        customerId: true,
        currencyCode: true,
        totalAmount: true,
        issueDate: true,
        dueDate: true,
        workOrder: {
          select: {
            id: true,
            requestId: true,
            serviceNameSnapshot: true,
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressRegion: true,
            addressPostalCode: true,
          },
        },
      },
    });
    if (invoice === null) {
      throw notFound();
    }
    const lineCount = await tx.invoiceLineItem.count({ where: { invoiceId: id } });
    const { user: customer } = await tx.customerProfile.findUniqueOrThrow({
      where: { id: invoice.customerId },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    if (input.expectedStatus !== invoice.status) {
      throw staleInvoiceError(invoice.status);
    }
    assertInvoiceTransition(invoice.status, InvoiceStatus.ISSUED, InvoiceTrigger.ADMIN);

    const settings = await loadSettings(tx);
    const issueDate = effectiveIssueDate(
      invoice.issueDate === null ? null : toDateOnly(invoice.issueDate),
      now,
      settings.timeZone,
    );
    const dueDate =
      invoice.dueDate === null
        ? defaultDueDate(now, settings.timeZone, settings.invoiceDueDays)
        : toDateOnly(invoice.dueDate);
    const problems = issueProblems({
      lineCount,
      totalAmount: invoice.totalAmount.toFixed(2),
      issueDate,
      dueDate,
    });
    if (Object.keys(problems).length > 0) {
      throw validation(problems);
    }

    const invoiceNumber = await nextReference(tx, ReferenceType.INVOICE, now, settings.timeZone);
    const customerSnapshot = customerSnapshotOf({
      name: customer.name,
      email: customer.email,
      address: {
        line1: invoice.workOrder.addressLine1,
        line2: invoice.workOrder.addressLine2,
        city: invoice.workOrder.addressCity,
        region: invoice.workOrder.addressRegion,
        postalCode: invoice.workOrder.addressPostalCode,
      },
    });

    await transitionInvoice(tx, {
      invoiceId: id,
      to: InvoiceStatus.ISSUED,
      trigger: InvoiceTrigger.ADMIN,
      expectedStatus: InvoiceStatus.DRAFT,
      data: {
        invoiceNumber,
        issuedAt: now,
        issuedByUserId: auth.userId,
        issueDate: fromDateOnly(issueDate),
        dueDate: fromDateOnly(dueDate),
        businessSnapshot: businessSnapshotOf(settings) as unknown as Prisma.InputJsonValue,
        customerSnapshot: customerSnapshot as unknown as Prisma.InputJsonValue,
        paymentInstructionsSnapshot: settings.paymentInstructions,
        footerSnapshot: settings.invoiceFooter,
      },
    });

    const actor = await tx.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { name: true },
    });
    const total = invoice.totalAmount.toFixed(2);
    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.INVOICE,
      entityId: id,
      requestId: invoice.workOrder.requestId,
      customerId: invoice.customerId,
      action: "invoice.issued",
      fromStatus: InvoiceStatus.DRAFT,
      toStatus: InvoiceStatus.ISSUED,
      metadata: {
        invoiceReference: invoiceNumber,
        totalAmount: total,
        currencyCode: invoice.currencyCode,
        issueDate,
        dueDate,
        lineItemCount: lineCount,
      },
      ...buildActivitySummaries({
        actor: { kind: "staff", name: actor.name },
        ...issuedTexts({ invoiceNumber, customerName: customer.name }),
      }),
    });

    const linkPath = `/portal/invoices/${id}`;
    const notification = await notify(tx, {
      recipientUserId: customer.id,
      type: NotificationType.INVOICE_ISSUED,
      ...issuedNotification({ invoiceNumber, serviceName: invoice.workOrder.serviceNameSnapshot }),
      linkPath,
      entity: { type: ActivityEntityType.INVOICE, id },
    });
    after.email(
      emailJob(
        "invoice-issued",
        customer.email,
        {
          customerName: customer.name,
          invoiceReference: invoiceNumber,
          totalAmount: total,
          currencyCode: invoice.currencyCode,
          dueDate,
          invoiceUrl: absoluteAppUrl(config.email.publicWebUrl, linkPath),
        },
        { notificationId: notification.id },
      ),
    );
  });

  emailDispatcher.dispatchAfterCommit(afterCommit);
  return readAdminInvoice(prisma, now, id);
}

// ---- Voiding (FR-076, BR-16) ---------------------------------------------------------------------

/**
 * Withdraws a draft or an issued invoice with a written reason (spec §6.5, D-26). The reason, the
 * admin and the time are kept on the invoice; the reason is internal and never sent to the customer.
 * The invoice stays in the history and there is no way to delete it. An invoice with a payment on it
 * that has not been voided cannot be voided (`409 INVOICE_HAS_PAYMENTS`): the payments are voided
 * first. An invoice the customer had been sent tells them it was voided. Afterwards the job has no
 * live invoice, so a new draft may be created for it.
 */
export async function voidInvoiceByAdmin(
  deps: InvoiceDeps,
  auth: AuthContext,
  id: string,
  input: VoidInvoiceInput,
): Promise<AdminInvoiceDto> {
  const { prisma, clock, config, emailDispatcher } = deps;
  await syncOverdueInvoicesIfDue(deps);
  const now = clock.now();

  const { afterCommit } = await runInTransaction(prisma, async (tx, after) => {
    if (!(await lockInvoice(tx, id))) {
      throw notFound();
    }
    const invoice = await tx.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        customerId: true,
        workOrder: { select: { requestId: true, serviceNameSnapshot: true } },
      },
    });
    if (invoice === null) {
      throw notFound();
    }
    if (input.expectedStatus !== invoice.status) {
      throw staleInvoiceError(invoice.status);
    }
    const activePayments = await tx.paymentRecord.count({
      where: { invoiceId: id, voidedAt: null },
    });
    if (activePayments > 0) {
      throw invoiceHasPaymentsError(invoice.status);
    }
    assertInvoiceTransition(invoice.status, InvoiceStatus.VOID, InvoiceTrigger.ADMIN);

    const { user: customer } = await tx.customerProfile.findUniqueOrThrow({
      where: { id: invoice.customerId },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { name: true },
    });

    const { from } = await transitionInvoice(tx, {
      invoiceId: id,
      to: InvoiceStatus.VOID,
      trigger: InvoiceTrigger.ADMIN,
      expectedStatus: input.expectedStatus,
      data: { voidedAt: now, voidedByUserId: auth.userId, voidReason: input.reason },
    });

    const wasIssued = invoice.invoiceNumber !== null;
    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.INVOICE,
      entityId: id,
      requestId: invoice.workOrder.requestId,
      customerId: invoice.customerId,
      action: "invoice.voided",
      fromStatus: from,
      toStatus: InvoiceStatus.VOID,
      metadata: invoice.invoiceNumber === null ? {} : { invoiceReference: invoice.invoiceNumber },
      ...buildActivitySummaries({
        actor: { kind: "staff", name: actor.name },
        ...voidedTexts({ invoiceNumber: invoice.invoiceNumber, wasIssued }),
      }),
    });

    if (invoice.invoiceNumber !== null) {
      const linkPath = `/portal/invoices/${id}`;
      const notification = await notify(tx, {
        recipientUserId: customer.id,
        type: NotificationType.INVOICE_VOIDED,
        ...voidedNotification({
          invoiceNumber: invoice.invoiceNumber,
          serviceName: invoice.workOrder.serviceNameSnapshot,
        }),
        linkPath,
        entity: { type: ActivityEntityType.INVOICE, id },
      });
      // `reason` is not an input of the template, so the internal reason cannot reach the email.
      after.email(
        emailJob(
          "invoice-voided",
          customer.email,
          {
            customerName: customer.name,
            invoiceReference: invoice.invoiceNumber,
            invoiceUrl: absoluteAppUrl(config.email.publicWebUrl, linkPath),
          },
          { notificationId: notification.id },
        ),
      );
    }
  });

  emailDispatcher.dispatchAfterCommit(afterCommit);
  return readAdminInvoice(prisma, now, id);
}
