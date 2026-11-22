import {
  ActivityEntityType,
  type AdminQuotationDto,
  calculateDocumentTotals,
  type CustomerQuotationDto,
  dateOnlyInTimeZone,
  DocumentTotalsError,
  type DocumentTotalsResult,
  ErrorCode,
  NotificationType,
  type QuotationLineBody,
  QuotationStatus,
  ReferenceType,
  requestStatusLabel,
  ServiceRequestStatus,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import { fromDateOnly, toDateOnly } from "../../lib/date-only.js";
import { BUSINESS_SETTINGS_ID, type DbClient, isUniqueViolation } from "../../lib/db.js";
import { conflict, forbidden, notFound, serviceUnavailable, validation } from "../../lib/errors.js";
import { nextReference } from "../../lib/references.js";
import { runInTransaction } from "../../lib/transaction.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { getTimeline, recordActivity } from "../activity/activity.service.js";
import { canActAsAdmin, canActAsCustomer } from "../auth/auth.domain.js";
import { assertCustomerOwns } from "../auth/auth.middleware.js";
import type { AuthContext } from "../auth/auth.types.js";
import { absoluteAppUrl } from "../email/email.domain.js";
import { emailJob } from "../email/email.jobs.js";
import { notify } from "../notifications/notifications.service.js";
import { markQuoted } from "../requests/requests.transitions.js";
import {
  assertQuotationTransition,
  createdTexts,
  defaultValidUntil,
  notEditableError,
  QuotationTrigger,
  requestQuotedTexts,
  sendProblems,
  sentNotification,
  sentTexts,
  staleQuotationError,
  starterLine,
} from "./quotations.domain.js";
import {
  QUOTATION_DETAIL_SELECT,
  QUOTATION_SETTINGS_SELECT,
  type QuotationSettingsRow,
  toAdminQuotationDto,
  toCustomerQuotationDto,
  toQuotationBusiness,
} from "./quotations.dto.js";
import type {
  CreateQuotationInput,
  GetQuotationQuery,
  SendQuotationInput,
  UpdateQuotationInput,
  VoidQuotationInput,
} from "./quotations.schemas.js";
import {
  lockRequest,
  syncExpiredQuotations,
  transitionQuotation,
  voidQuotation,
} from "./quotations.transitions.js";

type QuotationDeps = Pick<AppDeps, "prisma" | "clock" | "config" | "emailDispatcher">;

const NOT_SET_UP = "The business settings have not been set up yet.";

export async function loadSettings(
  db: Pick<DbClient, "businessSettings">,
): Promise<QuotationSettingsRow> {
  const settings = await db.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: QUOTATION_SETTINGS_SELECT,
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
  lines: readonly QuotationLineBody[];
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

/** The columns the stored totals come from. */
function totalsData(totals: DocumentTotalsResult) {
  return {
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxableBase: totals.taxableBase,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
  };
}

function lineRows(lines: readonly QuotationLineBody[], totals: DocumentTotalsResult) {
  return lines.map((line, index) => ({
    position: index + 1,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxable: line.taxable,
    lineSubtotal: totals.lines[index]?.lineSubtotal ?? "0.00",
  }));
}

// ---- Expiry before reads (D-23) -----------------------------------------------------------------

/**
 * Saves any expiry that is due before a read or an action looks at a quotation or at a request's
 * status (D-23). Two cheap queries, sent together in one round trip (D-118), decide whether there is
 * anything to do; only then does a transaction run. Safe to call from any read, from any number of
 * requests at once.
 *
 * "Is any sent quotation past its last day?" is asked as "is the sent quotation that runs out first
 * past it?", the same question, so it does not have to wait for the time zone to be read.
 */
export async function syncExpiredQuotationsIfDue(
  deps: Pick<AppDeps, "prisma" | "clock">,
): Promise<void> {
  const now = deps.clock.now();
  const [settings, first] = await Promise.all([
    deps.prisma.businessSettings.findUnique({
      where: { id: BUSINESS_SETTINGS_ID },
      select: { timeZone: true },
    }),
    deps.prisma.quotation.findFirst({
      where: { status: QuotationStatus.SENT },
      orderBy: [{ validUntil: "asc" }, { id: "asc" }],
      select: { validUntil: true },
    }),
  ]);
  if (settings === null) {
    return; // the read that follows reports the missing settings itself
  }
  const today = fromDateOnly(dateOnlyInTimeZone(now, settings.timeZone));
  if (first === null || first.validUntil.getTime() >= today.getTime()) {
    return;
  }
  await deps.prisma.$transaction((tx) => syncExpiredQuotations(tx, now));
}

// ---- Reading --------------------------------------------------------------------------------------

/** The quotation for the business, as it is now. No sync: callers that read after a write have just made it right. */
async function readAdminQuotation(db: DbClient, now: Date, id: string): Promise<AdminQuotationDto> {
  const [row, settings] = await Promise.all([
    db.quotation.findUnique({ where: { id }, select: QUOTATION_DETAIL_SELECT }),
    loadSettings(db),
  ]);
  if (row === null) {
    throw notFound();
  }
  const [timeline, otherDrafts] = await Promise.all([
    getTimeline(db, { entityType: ActivityEntityType.QUOTATION, entityId: id }, "admin"),
    db.quotation.count({
      where: { requestId: row.requestId, status: QuotationStatus.DRAFT, id: { not: id } },
    }),
  ]);
  return toAdminQuotationDto({
    row,
    context: { now, timeZone: settings.timeZone },
    business: toQuotationBusiness(settings),
    timeline,
    requestHasDraft: otherDrafts > 0,
  });
}

/** `GET /admin/quotations/:id`: the whole quotation for the business, after saving any expiry that is due. */
export async function getAdminQuotation(
  deps: Pick<AppDeps, "prisma" | "clock">,
  id: string,
): Promise<AdminQuotationDto> {
  await syncExpiredQuotationsIfDue(deps);
  return readAdminQuotation(deps.prisma, deps.clock.now(), id);
}

/**
 * `GET /quotations/:id`: the quotation as its customer sees it (D-41). The owner gets it once it has
 * been sent. Another customer, and the owner of a draft (or of a quotation that was voided before it
 * was ever sent), get `404`, exactly like an id that does not exist. An admin may look at what the
 * customer sees; for a quotation not yet sent they must ask for the preview on purpose.
 */
export async function getCustomerQuotation(
  deps: Pick<AppDeps, "prisma" | "clock" | "config">,
  auth: AuthContext,
  id: string,
  query: GetQuotationQuery,
): Promise<CustomerQuotationDto> {
  const { prisma, clock, config } = deps;
  await syncExpiredQuotationsIfDue(deps);

  // Authorize first, from the owner's id alone: nothing else is read for a caller who may not see it.
  const owner = await prisma.quotation.findUnique({
    where: { id },
    select: { customerId: true, sentAt: true },
  });
  if (canActAsCustomer(auth)) {
    assertCustomerOwns(owner?.customerId, auth);
    if (owner?.sentAt === null) {
      throw notFound();
    }
  } else if (canActAsAdmin(auth, config.auth.adminEmails)) {
    if (owner === null || (owner.sentAt === null && query.preview !== true)) {
      throw notFound();
    }
  } else {
    throw forbidden();
  }
  if (owner === null) {
    throw notFound();
  }

  return readCustomerQuotation(prisma, clock.now(), id, owner.sentAt === null);
}

/**
 * The quotation in the customer's shape (D-41), for a caller that has already decided the viewer may
 * see it. `preview` is true only for an admin looking at a draft.
 */
export async function readCustomerQuotation(
  db: DbClient,
  now: Date,
  id: string,
  preview: boolean,
): Promise<CustomerQuotationDto> {
  const [row, settings] = await Promise.all([
    db.quotation.findUnique({ where: { id }, select: QUOTATION_DETAIL_SELECT }),
    loadSettings(db),
  ]);
  if (row === null) {
    throw notFound();
  }
  return toCustomerQuotationDto({
    row,
    context: { now, timeZone: settings.timeZone },
    business: toQuotationBusiness(settings),
    preview,
  });
}

// ---- Creating a draft (FR-040) --------------------------------------------------------------------

/**
 * Starts a draft quotation for a request (spec §7.2 step 4, D-22). The server fills it in: the
 * currency and tax rate from the settings, a valid-until date of today plus the usual number of days,
 * the default terms, and one starter line for the service. When it replaces a sent quotation, the
 * lines, the discount, the terms and the note of that one are copied instead, so the admin changes
 * what needs changing rather than retyping it.
 *
 * - The request must be `UNDER_REVIEW` (a first quotation) or `QUOTED` (a replacement): `409`.
 * - A request has at most one draft: `409 DRAFT_EXISTS`, naming the one that exists.
 * - A `QUOTED` request is quoted again only by replacing its sent quotation.
 */
export async function createQuotation(
  deps: Pick<AppDeps, "prisma" | "clock">,
  auth: AuthContext,
  requestId: string,
  body: CreateQuotationInput,
): Promise<AdminQuotationDto> {
  const { prisma, clock } = deps;
  await syncExpiredQuotationsIfDue(deps);
  const now = clock.now();

  const id = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId);
    const request = await tx.serviceRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        reference: true,
        status: true,
        customerId: true,
        serviceNameSnapshot: true,
        service: { select: { pricingMode: true, startingPrice: true } },
      },
    });
    if (request === null) {
      throw notFound();
    }
    if (
      request.status !== ServiceRequestStatus.UNDER_REVIEW &&
      request.status !== ServiceRequestStatus.QUOTED
    ) {
      throw conflict(
        `A quotation can only be prepared while a request is under review or quoted. This request is ${requestStatusLabel(request.status).toLowerCase()}.`,
        {
          code: ErrorCode.INVALID_STATE_TRANSITION,
          details: { currentStatus: request.status },
        },
      );
    }

    const draft = await tx.quotation.findFirst({
      where: { requestId, status: QuotationStatus.DRAFT },
      select: { id: true, reference: true },
    });
    if (draft !== null) {
      throw conflict(
        `This request already has a draft quotation (${draft.reference}). Continue it, or void it to start again.`,
        { code: ErrorCode.DRAFT_EXISTS, details: { quotationId: draft.id } },
      );
    }

    const replaced =
      body.replacesQuotationId === undefined
        ? null
        : await tx.quotation.findFirst({
            where: { id: body.replacesQuotationId, requestId },
            select: {
              id: true,
              reference: true,
              status: true,
              discountAmount: true,
              terms: true,
              customerNote: true,
              lineItems: {
                orderBy: { position: "asc" },
                select: { description: true, quantity: true, unitPrice: true, taxable: true },
              },
            },
          });
    if (body.replacesQuotationId !== undefined && replaced === null) {
      throw notFound("The quotation to replace was not found on this request.");
    }
    if (replaced !== null && replaced.status !== QuotationStatus.SENT) {
      throw conflict(
        `Only a sent quotation can be replaced. ${replaced.reference} is ${replaced.status.toLowerCase()}.`,
        {
          code: ErrorCode.INVALID_STATE_TRANSITION,
          details: { currentStatus: replaced.status },
        },
      );
    }
    if (replaced === null && request.status === ServiceRequestStatus.QUOTED) {
      throw conflict(
        "This request already has a quotation that was sent. Replace it to change the offer.",
        {
          code: ErrorCode.INVALID_STATE_TRANSITION,
          details: { currentStatus: request.status },
        },
      );
    }

    const settings = await loadSettings(tx);
    const lines: QuotationLineBody[] =
      replaced === null
        ? [
            starterLine({
              serviceName: request.serviceNameSnapshot,
              pricingMode: request.service.pricingMode,
              startingPrice:
                request.service.startingPrice === null
                  ? null
                  : request.service.startingPrice.toFixed(2),
            }),
          ]
        : replaced.lineItems.map((line) => ({
            description: line.description,
            quantity: line.quantity.toFixed(2),
            unitPrice: line.unitPrice.toFixed(2),
            taxable: line.taxable,
          }));
    const taxRate = settings.defaultTaxRate.toFixed(2);
    const totals = totalsOf({
      lines,
      discountAmount: replaced === null ? "0.00" : replaced.discountAmount.toFixed(2),
      taxRate,
    });
    const reference = await nextReference(tx, ReferenceType.QUOTATION, now, settings.timeZone);

    const created = await tx.quotation.create({
      data: {
        reference,
        requestId,
        customerId: request.customerId,
        status: QuotationStatus.DRAFT,
        currencyCode: settings.currencyCode,
        taxRate,
        ...totalsData(totals),
        validUntil: fromDateOnly(
          defaultValidUntil(now, settings.timeZone, settings.quotationValidityDays),
        ),
        terms: replaced === null ? settings.defaultQuotationTerms : replaced.terms,
        customerNote: replaced === null ? null : replaced.customerNote,
        replacesQuotationId: replaced === null ? null : replaced.id,
        createdByUserId: auth.userId,
        lineItems: { create: lineRows(lines, totals) },
      },
      select: { id: true },
    });

    const actor = await tx.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { name: true },
    });
    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.QUOTATION,
      entityId: created.id,
      requestId,
      customerId: request.customerId,
      action: "quotation.created",
      toStatus: QuotationStatus.DRAFT,
      metadata: {
        quotationReference: reference,
        requestReference: request.reference,
        ...(replaced !== null && { replacesReference: replaced.reference }),
      },
      // A draft is internal: no sentence for the customer, so it never reaches their timeline.
      ...buildActivitySummaries({
        actor: { kind: "staff", name: actor.name },
        ...createdTexts({
          reference,
          requestReference: request.reference,
          replacesReference: replaced === null ? null : replaced.reference,
        }),
      }),
    });
    return created.id;
  });

  return readAdminQuotation(prisma, now, id);
}

// ---- Saving a draft (FR-041, FR-042, FR-046) -------------------------------------------------------

/**
 * Saves a draft: replaces its lines and details and **recomputes every total from them**; nothing a
 * client says about a total is read (the schema refuses the field). Only a draft can be edited
 * (`409 QUOTATION_NOT_EDITABLE`, the record untouched), and only from the version the editor loaded
 * (`409 STALE_STATE` when `expectedUpdatedAt` is no longer the stored one).
 */
export async function updateQuotation(
  deps: Pick<AppDeps, "prisma" | "clock">,
  id: string,
  input: UpdateQuotationInput,
): Promise<AdminQuotationDto> {
  const { prisma, clock } = deps;

  await prisma.$transaction(async (tx) => {
    const owner = await tx.quotation.findUnique({ where: { id }, select: { requestId: true } });
    if (owner === null) {
      throw notFound();
    }
    await lockRequest(tx, owner.requestId);
    const current = await tx.quotation.findUnique({
      where: { id },
      select: { status: true, updatedAt: true },
    });
    if (current === null) {
      throw notFound();
    }
    if (current.status !== QuotationStatus.DRAFT) {
      throw notEditableError(current.status);
    }
    if (new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) {
      throw staleQuotationError(current.status);
    }

    const totals = totalsOf(input);
    // Conditional on the version that was read, so a save racing a save (or a send) writes nothing.
    const { count } = await tx.quotation.updateMany({
      where: { id, status: QuotationStatus.DRAFT, updatedAt: current.updatedAt },
      data: {
        taxRate: input.taxRate,
        ...totalsData(totals),
        validUntil: fromDateOnly(input.validUntil),
        terms: input.terms,
        customerNote: input.customerNote,
      },
    });
    if (count === 0) {
      const latest = await tx.quotation.findUnique({ where: { id }, select: { status: true } });
      if (latest === null) {
        throw notFound();
      }
      throw latest.status === QuotationStatus.DRAFT
        ? staleQuotationError(latest.status)
        : notEditableError(latest.status);
    }
    await tx.quotationLineItem.deleteMany({ where: { quotationId: id } });
    await tx.quotationLineItem.createMany({
      data: lineRows(input.lines, totals).map((line) => ({ ...line, quotationId: id })),
    });
  });

  return readAdminQuotation(prisma, clock.now(), id);
}

// ---- Sending (FR-043, D-22) ------------------------------------------------------------------------

/**
 * Publishes a draft to the customer. One transaction holds everything that must be true together:
 * the draft becomes `SENT`, the quotation it replaces (if any) is voided with the reason "Replaced by
 * QT-…", the request becomes `QUOTED`, the history gets its event and the customer gets their
 * notification. The email is queued in it and sent only after the commit (BR-22).
 *
 * It is duplicate-safe: the request's row lock makes two sends take turns, the status change is
 * conditional on the draft still being a draft, and `expectedStatus` turns the second of two clicks
 * into `409 STALE_STATE`. So exactly one quotation ends up sent and exactly one notification exists.
 *
 * Before it goes, the draft needs at least one line, a total above zero and a valid-until date of
 * today or later (`422`, naming the field); the request must be `UNDER_REVIEW` or `QUOTED`; and a
 * quotation the customer has already answered cannot be replaced (`409`).
 */
export async function sendQuotation(
  deps: QuotationDeps,
  auth: AuthContext,
  id: string,
  input: SendQuotationInput,
): Promise<AdminQuotationDto> {
  const { prisma, clock, config, emailDispatcher } = deps;
  await syncExpiredQuotationsIfDue(deps);
  const now = clock.now();
  const workflow = { publicWebUrl: config.email.publicWebUrl };

  const { afterCommit } = await runInTransaction(prisma, async (tx, after) => {
    const owner = await tx.quotation.findUnique({ where: { id }, select: { requestId: true } });
    if (owner === null) {
      throw notFound();
    }
    await lockRequest(tx, owner.requestId);

    // One relation at a time: a transaction has a single connection (see `voidQuotation`).
    const quotation = await tx.quotation.findUnique({
      where: { id },
      select: {
        id: true,
        reference: true,
        status: true,
        requestId: true,
        customerId: true,
        currencyCode: true,
        totalAmount: true,
        validUntil: true,
        replaces: { select: { id: true, reference: true, status: true } },
      },
    });
    if (quotation === null) {
      throw notFound();
    }
    const lineCount = await tx.quotationLineItem.count({ where: { quotationId: id } });
    const request = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: quotation.requestId },
      select: { id: true, reference: true, status: true, serviceNameSnapshot: true },
    });
    const { user: customer } = await tx.customerProfile.findUniqueOrThrow({
      where: { id: quotation.customerId },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    if (input.expectedStatus !== quotation.status) {
      throw staleQuotationError(quotation.status);
    }
    assertQuotationTransition(quotation.status, QuotationStatus.SENT, QuotationTrigger.ADMIN);

    const settings = await loadSettings(tx);
    const problems = sendProblems(
      {
        lineCount,
        totalAmount: quotation.totalAmount.toFixed(2),
        validUntil: toDateOnly(quotation.validUntil),
      },
      dateOnlyInTimeZone(now, settings.timeZone),
    );
    if (Object.keys(problems).length > 0) {
      throw validation(problems);
    }

    const requestStatus = request.status;
    if (
      requestStatus !== ServiceRequestStatus.UNDER_REVIEW &&
      requestStatus !== ServiceRequestStatus.QUOTED
    ) {
      throw conflict(
        `This request is ${requestStatusLabel(requestStatus).toLowerCase()}, so a quotation can't be sent for it.`,
        { code: ErrorCode.INVALID_STATE_TRANSITION, details: { currentStatus: requestStatus } },
      );
    }

    // A replacement takes the previous offer's place in the same transaction. The previous one is
    // voided first: only one quotation per request may be sent, and the database insists on it.
    const replaced = quotation.replaces;
    if (replaced !== null) {
      if (replaced.status === QuotationStatus.SENT) {
        await voidQuotation(
          tx,
          { after, ...workflow },
          {
            quotationId: replaced.id,
            actorUserId: auth.userId,
            reason: `Replaced by ${quotation.reference}`,
            now,
            requestEffect: "none",
            customerNotice: "none",
            replacedByReference: quotation.reference,
          },
        );
      } else if (
        replaced.status === QuotationStatus.ACCEPTED ||
        replaced.status === QuotationStatus.DECLINED
      ) {
        throw conflict(
          `The customer already answered ${replaced.reference}, so it can't be replaced.`,
          { code: ErrorCode.INVALID_STATE_TRANSITION, details: { currentStatus: replaced.status } },
        );
      }
      // Expired or voided meanwhile: there is nothing left to withdraw.
    }
    const otherSent = await tx.quotation.count({
      where: { requestId: quotation.requestId, status: QuotationStatus.SENT, id: { not: id } },
    });
    if (otherSent > 0) {
      throw conflict(
        "This request already has a quotation that was sent. Replace it instead of sending another.",
        { code: ErrorCode.INVALID_STATE_TRANSITION, details: { currentStatus: requestStatus } },
      );
    }

    try {
      await transitionQuotation(tx, {
        quotationId: id,
        to: QuotationStatus.SENT,
        trigger: QuotationTrigger.ADMIN,
        expectedStatus: QuotationStatus.DRAFT,
        data: { sentAt: now, sentByUserId: auth.userId },
      });
    } catch (error) {
      // The database's own guard (one sent quotation per request) lost a race the lock should prevent.
      if (isUniqueViolation(error)) {
        throw conflict(
          "This request already has a quotation that was sent. Replace it instead of sending another.",
          { code: ErrorCode.INVALID_STATE_TRANSITION },
        );
      }
      throw error;
    }

    const actor = await tx.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { name: true },
    });
    const total = quotation.totalAmount.toFixed(2);
    const validUntil = toDateOnly(quotation.validUntil);

    if (requestStatus === ServiceRequestStatus.UNDER_REVIEW) {
      await markQuoted(tx, quotation.requestId);
      await recordActivity(tx, {
        // The system moves the request (D-21), as a consequence of the admin's send, which has its own event.
        actorUserId: null,
        entityType: ActivityEntityType.SERVICE_REQUEST,
        entityId: quotation.requestId,
        requestId: quotation.requestId,
        customerId: quotation.customerId,
        action: "request.quoted",
        fromStatus: ServiceRequestStatus.UNDER_REVIEW,
        toStatus: ServiceRequestStatus.QUOTED,
        metadata: { requestReference: request.reference },
        ...buildActivitySummaries({
          actor: { kind: "system" },
          ...requestQuotedTexts({ requestReference: request.reference }),
        }),
      });
    }

    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.QUOTATION,
      entityId: id,
      requestId: quotation.requestId,
      customerId: quotation.customerId,
      action: "quotation.sent",
      fromStatus: QuotationStatus.DRAFT,
      toStatus: QuotationStatus.SENT,
      metadata: {
        quotationReference: quotation.reference,
        requestReference: request.reference,
        totalAmount: total,
        currencyCode: quotation.currencyCode,
        validUntil,
        lineItemCount: lineCount,
        ...(replaced !== null && { replacesReference: replaced.reference }),
      },
      ...buildActivitySummaries({
        actor: { kind: "staff", name: actor.name },
        ...sentTexts({
          reference: quotation.reference,
          customerName: customer.name,
          replacesReference: replaced === null ? null : replaced.reference,
        }),
      }),
    });

    const linkPath = `/portal/quotations/${id}`;
    const notification = await notify(tx, {
      recipientUserId: customer.id,
      type: NotificationType.QUOTATION_SENT,
      ...sentNotification({
        reference: quotation.reference,
        serviceName: request.serviceNameSnapshot,
      }),
      linkPath,
      entity: { type: ActivityEntityType.QUOTATION, id },
    });
    after.email(
      emailJob(
        "quotation-sent",
        customer.email,
        {
          customerName: customer.name,
          quotationReference: quotation.reference,
          serviceName: request.serviceNameSnapshot,
          totalAmount: total,
          currencyCode: quotation.currencyCode,
          validUntil,
          quotationUrl: absoluteAppUrl(config.email.publicWebUrl, linkPath),
        },
        { notificationId: notification.id },
      ),
    );
  });

  emailDispatcher.dispatchAfterCommit(afterCommit);
  return readAdminQuotation(prisma, now, id);
}

// ---- Voiding (FR-046, BR-16) -----------------------------------------------------------------------

/**
 * Withdraws a draft or a sent quotation with a written reason (spec §6.3). The reason, the admin and
 * the time are kept on the quotation; the reason is internal and never sent to the customer. When it
 * was the request's only sent quotation, the request goes back under review so a new one can be
 * prepared. A sent quotation's customer is told it was withdrawn, with the message the admin wrote
 * for them or a standard line.
 */
export async function voidQuotationByAdmin(
  deps: QuotationDeps,
  auth: AuthContext,
  id: string,
  input: VoidQuotationInput,
): Promise<AdminQuotationDto> {
  const { prisma, clock, config, emailDispatcher } = deps;
  await syncExpiredQuotationsIfDue(deps);
  const now = clock.now();

  const { afterCommit } = await runInTransaction(prisma, async (tx, after) => {
    const owner = await tx.quotation.findUnique({ where: { id }, select: { requestId: true } });
    if (owner === null) {
      throw notFound();
    }
    await lockRequest(tx, owner.requestId);
    const current = await tx.quotation.findUnique({ where: { id }, select: { status: true } });
    if (current === null) {
      throw notFound();
    }
    if (input.expectedStatus !== current.status) {
      throw staleQuotationError(current.status);
    }
    const customerMessage = input.customerMessage ?? undefined;
    if (customerMessage !== undefined && current.status !== QuotationStatus.SENT) {
      throw validation({
        customerMessage: "Only a quotation that was sent can carry a message for the customer.",
      });
    }

    await voidQuotation(
      tx,
      { after, publicWebUrl: config.email.publicWebUrl },
      {
        quotationId: id,
        actorUserId: auth.userId,
        reason: input.reason,
        now,
        expectedStatus: input.expectedStatus,
        requestEffect: "resume",
        customerNotice: "withdrawn",
        customerMessage,
      },
    );
  });

  emailDispatcher.dispatchAfterCommit(afterCommit);
  return readAdminQuotation(prisma, now, id);
}
