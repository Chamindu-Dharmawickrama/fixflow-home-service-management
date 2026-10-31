import {
  ActivityEntityType,
  type AdminRequestDto,
  type AdminRequestListResponse,
  type AdminRequestNoteDto,
  NoteVisibility,
  NotificationType,
  RequestAction,
  type RequestStatusAction,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { notFound, validation } from "../../lib/errors.js";
import { paginated, toPrismaPage } from "../../lib/pagination.js";
import { escapeLikePattern } from "../../lib/sql-like.js";
import { runInTransaction } from "../../lib/transaction.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { getTimeline, recordActivity } from "../activity/activity.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { absoluteAppUrl } from "../email/email.domain.js";
import { emailJob } from "../email/email.jobs.js";
import { notify } from "../notifications/notifications.service.js";
import { QUOTATION_SUMMARY_SELECT, toQuotationSummary } from "../quotations/quotations.dto.js";
import { syncExpiredQuotationsIfDue } from "../quotations/quotations.service.js";
import { voidOpenQuotationsOnCancel } from "../quotations/quotations.transitions.js";
import {
  ADMIN_DETAIL_SELECT,
  ADMIN_LIST_SELECT,
  PREVIOUS_REQUEST_SELECT,
  toAdminNote,
  toAdminRequestDto,
  toAdminRequestListItem,
} from "./requests.admin.dto.js";
import type {
  AddRequestNoteInput,
  AdminRequestsQuery,
  ChangeRequestStatusInput,
} from "./requests.admin.schemas.js";
import {
  ADMIN_ACTION_TARGET,
  RequestTrigger,
  submittedRange,
  toStatusCounts,
} from "./requests.domain.js";
import { loadBusiness } from "./requests.service.js";
import { transitionRequest } from "./requests.transitions.js";

type AdminRequestDeps = Pick<AppDeps, "prisma" | "clock" | "config" | "emailDispatcher">;

// ---- The queue (FR-023) ----------------------------------------------------------------------

/**
 * The filters that are not the status, as one `where`. The status counts are computed from exactly
 * this (so the chips say what each status would give), and the list adds the status on top.
 */
function filtersWhere(
  query: AdminRequestsQuery,
  timeZone: string,
): Prisma.ServiceRequestWhereInput {
  const range = submittedRange(query.submittedFrom, query.submittedTo, timeZone);
  // `contains` hands the text to ILIKE as it is, so `%` and `_` would act as wildcards.
  const contains =
    query.q === undefined
      ? undefined
      : ({ contains: escapeLikePattern(query.q), mode: "insensitive" } as const);

  return {
    ...(query.serviceId !== undefined && { serviceId: query.serviceId }),
    ...(query.customerId !== undefined && { customerId: query.customerId }),
    ...((range.from !== undefined || range.before !== undefined) && {
      submittedAt: {
        ...(range.from !== undefined && { gte: range.from }),
        ...(range.before !== undefined && { lt: range.before }),
      },
    }),
    ...(contains !== undefined && {
      OR: [
        { reference: contains },
        { customer: { user: { name: contains } } },
        { customer: { user: { email: contains } } },
      ],
    }),
  };
}

/**
 * The request queue: search, filters, sort and a page of rows, with how many requests each status
 * holds under the current non-status filters. Three queries in all, however many rows: the page
 * (the customer's name comes in the same query), its total, and one grouped count for the chips.
 */
export async function listAdminRequests(
  deps: Pick<AppDeps, "prisma" | "clock">,
  query: AdminRequestsQuery,
): Promise<AdminRequestListResponse> {
  // A quotation that ran out of time moves its request back under review: save that before listing (D-23).
  await syncExpiredQuotationsIfDue(deps);
  const business = await loadBusiness(deps.prisma);
  const base = filtersWhere(query, business.timeZone);
  const where: Prisma.ServiceRequestWhereInput = {
    ...base,
    ...(query.status !== undefined && { status: { in: query.status } }),
  };

  const [rows, totalItems, groups] = await Promise.all([
    deps.prisma.serviceRequest.findMany({
      where,
      select: ADMIN_LIST_SELECT,
      ...toPrismaPage(query),
    }),
    deps.prisma.serviceRequest.count({ where }),
    deps.prisma.serviceRequest.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);

  const statusCounts = toStatusCounts(
    groups.map((group) => ({ status: group.status, count: group._count._all })),
  );
  return {
    ...paginated(rows.map(toAdminRequestListItem), query, totalItems),
    meta: {
      statusCounts,
      totalForFilters: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
    },
  };
}

// ---- One request (FR-024) --------------------------------------------------------------------

/**
 * A request in full for the business: the customer's view of it plus their contact details, every
 * note with its visibility, the internal timeline, the customer's earlier requests and counts of
 * their jobs and invoices, and what the admin may do next (D-43).
 */
export async function getAdminRequest(
  deps: Pick<AppDeps, "prisma" | "clock">,
  id: string,
): Promise<AdminRequestDto> {
  const { prisma, clock } = deps;
  await syncExpiredQuotationsIfDue(deps);
  const row = await prisma.serviceRequest.findUnique({
    where: { id },
    select: ADMIN_DETAIL_SELECT,
  });
  if (row === null) {
    throw notFound();
  }

  const customerId = row.customerId;
  const [timeline, previous, totalRequests, workOrderCount, invoiceCount, quotations, business] =
    await Promise.all([
      getTimeline(prisma, { requestId: id }, "admin"),
      prisma.serviceRequest.findMany({
        where: { customerId, id: { not: id } },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        take: 10,
        select: PREVIOUS_REQUEST_SELECT,
      }),
      prisma.serviceRequest.count({ where: { customerId } }),
      prisma.workOrder.count({ where: { customerId } }),
      prisma.invoice.count({ where: { customerId } }),
      prisma.quotation.findMany({
        where: { requestId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: QUOTATION_SUMMARY_SELECT,
      }),
      loadBusiness(prisma),
    ]);

  const context = { now: clock.now(), timeZone: business.timeZone };
  return toAdminRequestDto({
    row,
    timeline,
    history: { previous, totalRequests, workOrderCount, invoiceCount },
    quotations: quotations.map((quotation) => toQuotationSummary(quotation, context)),
  });
}

// ---- Status changes (FR-025, FR-026, D-21) ---------------------------------------------------

/** What each admin action says in the history: for staff, and for the customer where they see it. */
const ACTION_EVENTS: Record<
  RequestStatusAction,
  { action: string; staff: (reference: string) => string; customer: string }
> = {
  [RequestAction.START_REVIEW]: {
    action: "request.review_started",
    staff: (reference) => `started reviewing request ${reference}`,
    customer: "started reviewing your request",
  },
  [RequestAction.CANCEL]: {
    action: "request.cancelled",
    staff: (reference) => `cancelled request ${reference}`,
    customer: "cancelled your request",
  },
  [RequestAction.REOPEN]: {
    action: "request.reopened",
    staff: (reference) => `reopened request ${reference}`,
    customer: "reopened your request",
  },
};

/** The reason, which the schema guarantees for these actions; checked again so a gap cannot slip through. */
function requireReason(input: ChangeRequestStatusInput): string {
  if (input.reason === undefined) {
    throw validation({ reason: "Enter a reason, so the history says why." });
  }
  return input.reason;
}

/**
 * Starts a review, cancels, or reopens a request (FR-025, FR-026). One transaction holds the
 * conditional status update, the activity event and, for a cancellation, the customer's
 * notification; the customer's email is queued and sent after the commit (BR-22).
 *
 * - The change is judged against D-21 and against `expectedStatus` (`409 STALE_STATE` when the
 *   request has moved, `409 INVALID_STATE_TRANSITION` when the action is not allowed here); in both
 *   cases nothing is written.
 * - The **reason is internal**. A cancellation stores it on the request; a reopening keeps it as an
 *   internal note. Neither is ever in an event the customer sees, a notification or an email: the
 *   customer receives only the optional `customerMessage` (or a neutral default text).
 */
export async function changeRequestStatus(
  deps: AdminRequestDeps,
  auth: AuthContext,
  id: string,
  input: ChangeRequestStatusInput,
): Promise<AdminRequestDto> {
  const { prisma, clock, config, emailDispatcher } = deps;

  const { afterCommit } = await runInTransaction(prisma, async (tx, after) => {
    const request = await tx.serviceRequest.findUnique({
      where: { id },
      select: {
        reference: true,
        serviceNameSnapshot: true,
        customerId: true,
        customer: { select: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
    if (request === null) {
      throw notFound();
    }
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { name: true },
    });
    const owner = request.customer.user;
    const now = clock.now();
    const isCancel = input.action === RequestAction.CANCEL;
    const reason = input.action === RequestAction.START_REVIEW ? undefined : requireReason(input);

    const { from } = await transitionRequest(tx, {
      requestId: id,
      to: ADMIN_ACTION_TARGET[input.action],
      trigger: RequestTrigger.ADMIN,
      action: input.action,
      expectedStatus: input.expectedStatus,
      data: isCancel
        ? {
            cancelReason: reason ?? null,
            cancelCustomerMessage: input.customerMessage ?? null,
            cancelledAt: now,
            cancelledByUserId: auth.userId,
          }
        : {},
    });

    const event = ACTION_EVENTS[input.action];
    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.SERVICE_REQUEST,
      entityId: id,
      requestId: id,
      customerId: request.customerId,
      action: event.action,
      fromStatus: from,
      toStatus: ADMIN_ACTION_TARGET[input.action],
      metadata: { requestReference: request.reference },
      ...buildActivitySummaries({
        actor: { kind: "staff", name: actor.name },
        staff: event.staff(request.reference),
        customer: event.customer,
      }),
    });

    if (input.action === RequestAction.REOPEN && reason !== undefined) {
      // There is no column for a reopening's reason; it stays with the request as an internal note.
      await tx.requestNote.create({
        data: {
          requestId: id,
          authorUserId: auth.userId,
          body: `Reopened the request. Reason: ${reason}`,
          visibility: NoteVisibility.INTERNAL,
        },
      });
    }

    if (isCancel && reason !== undefined) {
      // D-21: open quotations are voided in this same transaction, each with the reason, the actor
      // and an event. The cancellation notice below is the one the customer reads about it.
      await voidOpenQuotationsOnCancel(
        tx,
        { after, publicWebUrl: config.email.publicWebUrl },
        { requestId: id, actorUserId: auth.userId, reason, now },
      );

      const linkPath = `/portal/requests/${id}`;
      const notification = await notify(tx, {
        recipientUserId: owner.id,
        type: NotificationType.REQUEST_CANCELLED,
        title: `Request ${request.reference} was cancelled`,
        message: `Your request for ${request.serviceNameSnapshot} was cancelled.`,
        linkPath,
        entity: { type: ActivityEntityType.SERVICE_REQUEST, id },
      });
      // The customer gets the message the admin wrote for them, or the template's neutral text.
      // `reason` is not an input of the template, so it cannot reach the email.
      after.email(
        emailJob(
          "request-cancelled",
          owner.email,
          {
            customerName: owner.name,
            requestReference: request.reference,
            serviceName: request.serviceNameSnapshot,
            requestUrl: absoluteAppUrl(config.email.publicWebUrl, linkPath),
            ...(input.customerMessage != null && { customerMessage: input.customerMessage }),
          },
          { notificationId: notification.id },
        ),
      );
    }
  });

  emailDispatcher.dispatchAfterCommit(afterCommit);
  return getAdminRequest(deps, id);
}

// ---- Notes (FR-024, FR-094, BR-19) -----------------------------------------------------------

/**
 * Adds a note to a request. An `INTERNAL` note is for the team: its event has no customer summary,
 * so it never reaches a customer's timeline. A `CUSTOMER_VISIBLE` note appears on the customer's
 * request page and timeline ("We added a note to your request.") and the customer is notified in the
 * app, without the note's text in the notification. There is no email for a note (D-38).
 */
export async function addRequestNote(
  deps: Pick<AppDeps, "prisma">,
  auth: AuthContext,
  id: string,
  input: AddRequestNoteInput,
): Promise<AdminRequestNoteDto> {
  return deps.prisma.$transaction(async (tx) => {
    const request = await tx.serviceRequest.findUnique({
      where: { id },
      select: {
        reference: true,
        serviceNameSnapshot: true,
        customerId: true,
        customer: { select: { userId: true } },
      },
    });
    if (request === null) {
      throw notFound();
    }
    const note = await tx.requestNote.create({
      data: {
        requestId: id,
        authorUserId: auth.userId,
        body: input.body,
        visibility: input.visibility,
      },
      select: {
        id: true,
        body: true,
        visibility: true,
        createdAt: true,
        author: { select: { name: true } },
      },
    });

    const visibleToCustomer = input.visibility === NoteVisibility.CUSTOMER_VISIBLE;
    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.SERVICE_REQUEST,
      entityId: id,
      requestId: id,
      customerId: request.customerId,
      action: "request.note_added",
      metadata: { requestReference: request.reference, visibility: input.visibility },
      ...buildActivitySummaries({
        actor: { kind: "staff", name: note.author.name },
        staff: visibleToCustomer
          ? `added a note to request ${request.reference} that the customer can see`
          : `added an internal note to request ${request.reference}`,
        // An internal note leaves no sentence for the customer: the event stays staff-only.
        ...(visibleToCustomer && { customer: "added a note to your request" }),
      }),
    });

    if (visibleToCustomer) {
      await notify(tx, {
        recipientUserId: request.customer.userId,
        type: NotificationType.NOTE_ADDED,
        title: `A note was added to request ${request.reference}`,
        message: `We added a note to your request for ${request.serviceNameSnapshot}.`,
        linkPath: `/portal/requests/${id}`,
        entity: { type: ActivityEntityType.SERVICE_REQUEST, id },
      });
    }
    return toAdminNote(note);
  });
}
