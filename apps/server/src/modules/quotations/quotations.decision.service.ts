import {
  ActivityEntityType,
  type CustomerQuotationDto,
  type CustomerQuotationListResponse,
  dateOnlyInTimeZone,
  NotificationType,
  QuotationStatus,
  ServiceRequestStatus,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import { fromDateOnly, toDateOnly } from "../../lib/date-only.js";
import { notFound } from "../../lib/errors.js";
import { paginated } from "../../lib/pagination.js";
import { runInTransaction } from "../../lib/transaction.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { recordActivity } from "../activity/activity.service.js";
import { assertCustomerOwns } from "../auth/auth.middleware.js";
import type { AuthContext } from "../auth/auth.types.js";
import { customerIdOf } from "../customers/customers.service.js";
import { absoluteAppUrl } from "../email/email.domain.js";
import { emailJob } from "../email/email.jobs.js";
import { notifyAdmins } from "../notifications/notifications.service.js";
import { markAccepted, markDeclined } from "../requests/requests.transitions.js";
import {
  decisionNotification,
  decisionTexts,
  effectiveQuotationStatus,
  type QuotationDecision,
  quotationNotAvailableError,
  QuotationTrigger,
  requestDecidedTexts,
} from "./quotations.domain.js";
import {
  CUSTOMER_QUOTATION_LIST_SELECT,
  type CustomerQuotationListRow,
  type QuotationViewContext,
  toCustomerQuotationListItem,
} from "./quotations.dto.js";
import type { DeclineQuotationInput, ListMyQuotationsQuery } from "./quotations.schemas.js";
import {
  loadSettings,
  readCustomerQuotation,
  syncExpiredQuotationsIfDue,
} from "./quotations.service.js";
import { lockRequest, transitionQuotation } from "./quotations.transitions.js";

/**
 * The customer's side of a quotation (T15, workflow 7.3): their list, and their answer. Accepting or
 * declining is "a recorded business decision, not an electronic signature" (spec §7.3), made by the
 * owner of a sent, unexpired quotation and by nobody else, exactly once.
 */

type DecisionDeps = Pick<AppDeps, "prisma" | "clock" | "config" | "emailDispatcher">;

// ---- The list ------------------------------------------------------------------------------------

/**
 * `GET /quotations/me`: the quotations the signed-in customer was sent, never a draft. The ones
 * awaiting an answer come first, the soonest to run out leading; the rest follow, newest first. An
 * expiry that is due is saved before listing, so no quotation is shown as awaiting that is not.
 *
 * The two groups are read as one list: a page that starts in the first group and ends in the second
 * takes the rest of its rows from the second, so a row is never repeated or lost between pages.
 */
export async function listMyQuotations(
  deps: Pick<AppDeps, "prisma" | "clock">,
  auth: AuthContext,
  query: ListMyQuotationsQuery,
): Promise<CustomerQuotationListResponse> {
  const { prisma, clock } = deps;
  const customerId = customerIdOf(auth);
  await syncExpiredQuotationsIfDue(deps);

  const settings = await loadSettings(prisma);
  const context: QuotationViewContext = { now: clock.now(), timeZone: settings.timeZone };

  // `sentAt` is set for every quotation a customer was sent, and for nothing else.
  const sentToCustomer = { customerId, sentAt: { not: null } };
  const awaiting = { ...sentToCustomer, status: QuotationStatus.SENT };
  const answered = {
    ...sentToCustomer,
    status: { not: QuotationStatus.SENT },
  };
  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;

  let rows: CustomerQuotationListRow[];
  let totalItems: number;
  if (query.status === QuotationStatus.SENT) {
    [rows, totalItems] = await Promise.all([
      prisma.quotation.findMany({
        where: awaiting,
        select: CUSTOMER_QUOTATION_LIST_SELECT,
        orderBy: [{ validUntil: "asc" }, { sentAt: "desc" }, { id: "asc" }],
        skip,
        take,
      }),
      prisma.quotation.count({ where: awaiting }),
    ]);
  } else if (query.status !== undefined) {
    const where = { ...sentToCustomer, status: query.status };
    [rows, totalItems] = await Promise.all([
      prisma.quotation.findMany({
        where,
        select: CUSTOMER_QUOTATION_LIST_SELECT,
        orderBy: [{ sentAt: "desc" }, { id: "asc" }],
        skip,
        take,
      }),
      prisma.quotation.count({ where }),
    ]);
  } else {
    const awaitingCount = await prisma.quotation.count({ where: awaiting });
    const first = await prisma.quotation.findMany({
      where: awaiting,
      select: CUSTOMER_QUOTATION_LIST_SELECT,
      orderBy: [{ validUntil: "asc" }, { sentAt: "desc" }, { id: "asc" }],
      skip,
      take,
    });
    const [rest, answeredCount] = await Promise.all([
      take - first.length > 0
        ? prisma.quotation.findMany({
            where: answered,
            select: CUSTOMER_QUOTATION_LIST_SELECT,
            orderBy: [{ sentAt: "desc" }, { id: "asc" }],
            skip: Math.max(0, skip - awaitingCount),
            take: take - first.length,
          })
        : Promise.resolve([]),
      prisma.quotation.count({ where: answered }),
    ]);
    rows = [...first, ...rest];
    totalItems = awaitingCount + answeredCount;
  }

  return paginated(
    rows.map((row) => toCustomerQuotationListItem(row, context)),
    query,
    totalItems,
  );
}

// ---- The answer ----------------------------------------------------------------------------------

/**
 * Records the customer's answer to a quotation (FR-044, FR-045, BR-08). One transaction holds all of
 * it: the quotation becomes `ACCEPTED` or `DECLINED` with who answered and when, the request follows
 * (D-21), the history gets an event on each, and every admin gets a notification. The email to the
 * business is queued in it and sent only after the commit (BR-22).
 *
 * What makes it safe to repeat, to race and to probe:
 *
 * - **Ownership comes from the session.** A quotation that is missing, someone else's, or a draft is
 *   `404`, in the same words, and nothing is read about it.
 * - **The request's row lock** serialises this with the other ways a quotation's status changes (an
 *   admin voiding or replacing it, the expiry sync, another answer). After it, the quotation is read
 *   again, so the second of two answers sees the first.
 * - **The status change is a conditional update** on the status that was read and, beside it, on the
 *   owner and on the last valid day, so a stale read cannot write.
 * - **Anything but a sent, unexpired quotation is `409 QUOTATION_NOT_AVAILABLE`**, with words for what
 *   it is instead (answered, expired, withdrawn), and the record is left as it was.
 *
 * An expiry that is already due is saved first, in its own transaction, so it stands even though this
 * answer is refused.
 */
async function decide(
  deps: DecisionDeps,
  auth: AuthContext,
  id: string,
  decision: QuotationDecision,
  declineReason: string | null,
): Promise<CustomerQuotationDto> {
  const { prisma, clock, config, emailDispatcher } = deps;
  await syncExpiredQuotationsIfDue(deps);
  const now = clock.now();

  const { afterCommit } = await runInTransaction(prisma, async (tx, after) => {
    // The owner is read from the id alone and judged first: nothing else is read for anyone else.
    const owner = await tx.quotation.findUnique({
      where: { id },
      select: { requestId: true, customerId: true, sentAt: true },
    });
    assertCustomerOwns(owner?.customerId, auth);
    if (owner === null || owner.sentAt === null) {
      // A draft, or a draft that was voided, was never sent to this customer.
      throw notFound();
    }
    await lockRequest(tx, owner.requestId);

    // Read again under the lock: an admin or an earlier answer may have changed it while we waited.
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
        respondedAt: true,
      },
    });
    if (quotation === null) {
      throw notFound();
    }
    const settings = await loadSettings(tx);
    const validUntil = toDateOnly(quotation.validUntil);
    const status = effectiveQuotationStatus(
      { status: quotation.status, validUntil },
      now,
      settings.timeZone,
    );
    if (status !== QuotationStatus.SENT) {
      throw quotationNotAvailableError({
        status,
        decision,
        validUntil,
        respondedAt: quotation.respondedAt,
        timeZone: settings.timeZone,
      });
    }

    // One query at a time: a transaction has a single connection (see `voidQuotation`).
    const request = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: quotation.requestId },
      select: { id: true, reference: true, serviceNameSnapshot: true },
    });
    const { user: customer } = await tx.customerProfile.findUniqueOrThrow({
      where: { id: quotation.customerId },
      select: { user: { select: { id: true, name: true } } },
    });

    await transitionQuotation(tx, {
      quotationId: id,
      to: decision,
      trigger: QuotationTrigger.CUSTOMER,
      expectedStatus: QuotationStatus.SENT,
      data: {
        respondedAt: now,
        respondedByUserId: auth.userId,
        ...(decision === QuotationStatus.DECLINED && { declineReason }),
      },
      guard: {
        customerId: quotation.customerId,
        validUntil: { gte: fromDateOnly(dateOnlyInTimeZone(now, settings.timeZone)) },
      },
    });
    // The request follows the quotation (D-21): `QUOTED` → `ACCEPTED` or `DECLINED`, by the system.
    if (decision === QuotationStatus.ACCEPTED) {
      await markAccepted(tx, quotation.requestId);
    } else {
      await markDeclined(tx, quotation.requestId);
    }

    const total = quotation.totalAmount.toFixed(2);
    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.QUOTATION,
      entityId: id,
      requestId: quotation.requestId,
      customerId: quotation.customerId,
      action: decision === QuotationStatus.ACCEPTED ? "quotation.accepted" : "quotation.declined",
      fromStatus: QuotationStatus.SENT,
      toStatus: decision,
      // The customer's own words (the reason) stay on the quotation; the history holds no free text.
      metadata: {
        quotationReference: quotation.reference,
        requestReference: request.reference,
        totalAmount: total,
        currencyCode: quotation.currencyCode,
      },
      ...buildActivitySummaries({
        actor: { kind: "customer", name: customer.name },
        ...decisionTexts({ reference: quotation.reference, decision }),
      }),
    });
    await recordActivity(tx, {
      // The system moves the request as a consequence of the customer's answer (D-21).
      actorUserId: null,
      entityType: ActivityEntityType.SERVICE_REQUEST,
      entityId: quotation.requestId,
      requestId: quotation.requestId,
      customerId: quotation.customerId,
      action: decision === QuotationStatus.ACCEPTED ? "request.accepted" : "request.declined",
      fromStatus: ServiceRequestStatus.QUOTED,
      toStatus:
        decision === QuotationStatus.ACCEPTED
          ? ServiceRequestStatus.ACCEPTED
          : ServiceRequestStatus.DECLINED,
      metadata: { requestReference: request.reference },
      ...buildActivitySummaries({
        actor: { kind: "system" },
        ...requestDecidedTexts({ requestReference: request.reference, decision }),
      }),
    });

    await notifyAdmins(tx, {
      type:
        decision === QuotationStatus.ACCEPTED
          ? NotificationType.QUOTATION_ACCEPTED
          : NotificationType.QUOTATION_DECLINED,
      ...decisionNotification({
        reference: quotation.reference,
        customerName: customer.name,
        serviceName: request.serviceNameSnapshot,
        decision,
      }),
      linkPath: `/app/quotations/${id}`,
      entity: { type: ActivityEntityType.QUOTATION, id },
    });
    // One email to the business's address (not one per admin), queued here and sent after the commit.
    // It is not tied to a notification, which is one per admin.
    after.email(
      emailJob("quotation-decision-admin", settings.contactEmail, {
        customerName: customer.name,
        quotationReference: quotation.reference,
        serviceName: request.serviceNameSnapshot,
        decision: decision === QuotationStatus.ACCEPTED ? "ACCEPTED" : "DECLINED",
        totalAmount: total,
        currencyCode: quotation.currencyCode,
        requestUrl: absoluteAppUrl(
          config.email.publicWebUrl,
          `/app/requests/${quotation.requestId}`,
        ),
      }),
    );
  });

  emailDispatcher.dispatchAfterCommit(afterCommit);
  return readCustomerQuotation(prisma, now, id, false);
}

/** `POST /quotations/:id/accept`: the signed-in customer accepts their sent, unexpired quotation. */
export function acceptQuotation(
  deps: DecisionDeps,
  auth: AuthContext,
  id: string,
): Promise<CustomerQuotationDto> {
  return decide(deps, auth, id, QuotationStatus.ACCEPTED, null);
}

/** `POST /quotations/:id/decline`: the same, with the customer's reason if they gave one. */
export function declineQuotation(
  deps: DecisionDeps,
  auth: AuthContext,
  id: string,
  input: DeclineQuotationInput,
): Promise<CustomerQuotationDto> {
  return decide(deps, auth, id, QuotationStatus.DECLINED, input.reason ?? null);
}
