import {
  ActivityEntityType,
  type AdminWorkOrderDto,
  type AdminWorkOrderListResponse,
  ErrorCode,
  InvoiceStatus,
  NotificationType,
  QuotationStatus,
  ReferenceType,
  type SchedulingConflictDto,
  ServiceRequestStatus,
  type SortOrder,
  WORK_ORDER_VIEW_STATUSES,
  WORK_ORDER_VIEWS,
  WorkOrderAction,
  WorkOrderStatus,
  type WorkOrderView,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma } from "../../generated/prisma/client.js";
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
import { syncOverdueInvoicesIfDue } from "../invoices/invoices.service.js";
import { notify } from "../notifications/notifications.service.js";
import { lockRequest } from "../quotations/quotations.transitions.js";
import { loadBusiness } from "../requests/requests.service.js";
import { markConvertedToJob } from "../requests/requests.transitions.js";
import { BOOKED_STATUSES } from "../technicians/technicians.domain.js";
import {
  buildScopeDescription,
  conversionTexts,
  invalidWorkOrderAction,
  NOTHING_TO_CHANGE_MESSAGE,
  RESCHEDULE_REASON_REQUIRED_MESSAGE,
  scheduleActionFor,
  scheduledRange,
  scheduleNotification,
  scheduleTexts,
  schedulingConflictError,
  staleWorkOrderError,
  technicianInactiveError,
  validateSchedule,
} from "./work-orders.domain.js";
import {
  ADMIN_DETAIL_SELECT,
  ADMIN_LIST_SELECT,
  CONFLICT_SELECT,
  toAdminWorkOrderDto,
  toAdminWorkOrderListItem,
  toConflictingJobs,
  toSchedulingConflicts,
} from "./work-orders.dto.js";
import type {
  AdminWorkOrdersQuery,
  ConflictsQuery,
  ScheduleWorkOrderInput,
} from "./work-orders.schemas.js";
import {
  createPendingWorkOrder,
  lockTechnician,
  lockWorkOrder,
  transitionWorkOrder,
} from "./work-orders.transitions.js";

type WorkOrderDeps = Pick<AppDeps, "prisma" | "clock" | "config" | "emailDispatcher">;

// ---- Reading one job (FR-051) --------------------------------------------------------------------

/**
 * A job in full for the business: the scope, the appointment, the technician, the customer and the
 * address with its access notes, the request and the accepted quotation it came from with the lines
 * that were agreed, its history, and what the admin may do next (D-43).
 */
export async function getAdminWorkOrder(
  deps: Pick<AppDeps, "prisma" | "clock">,
  id: string,
): Promise<AdminWorkOrderDto> {
  const { prisma, clock } = deps;
  // The job's invoice link says whether it is overdue (D-23), so any overdue invoice is saved first.
  await syncOverdueInvoicesIfDue(deps);
  const row = await prisma.workOrder.findUnique({ where: { id }, select: ADMIN_DETAIL_SELECT });
  if (row === null) {
    throw notFound();
  }
  const timeline = await getTimeline(
    prisma,
    { entityType: ActivityEntityType.WORK_ORDER, entityId: id },
    "admin",
  );
  const settings = await prisma.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { timeZone: true },
  });
  if (settings === null) {
    throw serviceUnavailable("The business settings have not been set up yet.");
  }
  return toAdminWorkOrderDto(row, timeline, { now: clock.now(), timeZone: settings.timeZone });
}

// ---- The list (FR-052) ------------------------------------------------------------------------------

/**
 * The filters that are not the status, as one `where`. The tab counts are computed from exactly
 * this (so each tab says what choosing it would show), and the list adds the statuses on top.
 */
export function filtersWhere(
  query: AdminWorkOrdersQuery,
  timeZone: string,
): Prisma.WorkOrderWhereInput {
  const range = scheduledRange(query.scheduledFrom, query.scheduledTo, timeZone);
  // `contains` hands the text to ILIKE as it is, so `%` and `_` would act as wildcards.
  const contains =
    query.q === undefined
      ? undefined
      : ({ contains: escapeLikePattern(query.q), mode: "insensitive" } as const);

  return {
    ...(query.technicianId !== undefined && { technicianId: query.technicianId }),
    ...(query.customerId !== undefined && { customerId: query.customerId }),
    ...((range.from !== undefined || range.before !== undefined) && {
      scheduledStart: {
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

const READY_TO_INVOICE: WorkOrderView = "ready-to-invoice";

/**
 * A completed job is ready to invoice until it has an invoice that is not void (workflow 7.5): a
 * void invoice is a withdrawn bill, so the job is waiting for a new one. No invoice exists before
 * T20, so every completed job qualifies.
 */
const READY_TO_INVOICE_WHERE: Prisma.WorkOrderWhereInput = {
  invoices: { none: { status: { not: InvoiceStatus.VOID } } },
};

/** The statuses the list shows: those of the view, narrowed by `status` when both are given. */
function statusesOf(
  query: Pick<AdminWorkOrdersQuery, "view" | "status">,
): WorkOrderStatus[] | undefined {
  const inView = query.view === undefined ? undefined : WORK_ORDER_VIEW_STATUSES[query.view];
  if (inView !== undefined && query.status !== undefined) {
    return inView.filter((status) => query.status?.includes(status));
  }
  return inView === undefined ? query.status : [...inView];
}

/** The list's `where`: the filters that are not the tab or the status, and the tab and status on top. The CSV export reads the same. */
export function withViewAndStatus(
  base: Prisma.WorkOrderWhereInput,
  query: Pick<AdminWorkOrdersQuery, "view" | "status">,
): Prisma.WorkOrderWhereInput {
  const statuses = statusesOf(query);
  return {
    ...base,
    ...(statuses !== undefined && { status: { in: statuses } }),
    ...(query.view === READY_TO_INVOICE && READY_TO_INVOICE_WHERE),
  };
}

/** A job that has no appointment yet (or is not completed, for `completedAt`) sorts after the ones that have, in either direction. */
export function jobsOrderBy(sort: AdminWorkOrdersQuery["sort"], order: SortOrder) {
  return sort === "scheduledStart" || sort === "completedAt"
    ? { [sort]: { sort: order, nulls: "last" as const } }
    : { [sort]: order };
}

/**
 * The jobs list: search, filters, a tab (`view`), sort and a page, with how many jobs each tab holds
 * under the other filters. Three queries in all, however many rows: the page (the customer's name
 * and the technician come in the same query), its total, and one grouped count for the tabs.
 */
export async function listAdminWorkOrders(
  deps: Pick<AppDeps, "prisma">,
  query: AdminWorkOrdersQuery,
): Promise<AdminWorkOrderListResponse> {
  const { prisma } = deps;
  const business = await loadBusiness(prisma);
  const base = filtersWhere(query, business.timeZone);
  const where = withViewAndStatus(base, query);

  const [rows, totalItems, groups, readyToInvoice] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      select: ADMIN_LIST_SELECT,
      ...toPrismaPage(query, jobsOrderBy),
    }),
    prisma.workOrder.count({ where }),
    prisma.workOrder.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    // The one tab a status cannot count: completed jobs that nobody has invoiced.
    prisma.workOrder.count({
      where: { ...base, status: WorkOrderStatus.COMPLETED, ...READY_TO_INVOICE_WHERE },
    }),
  ]);

  const countOf = (status: WorkOrderStatus) =>
    groups.find((group) => group.status === status)?._count._all ?? 0;
  const viewCounts = Object.fromEntries(
    WORK_ORDER_VIEWS.map((view) => [
      view,
      view === READY_TO_INVOICE
        ? readyToInvoice
        : WORK_ORDER_VIEW_STATUSES[view].reduce((sum, status) => sum + countOf(status), 0),
    ]),
  ) as Record<WorkOrderView, number>;

  return {
    ...paginated(rows.map(toAdminWorkOrderListItem), query, totalItems),
    meta: { viewCounts },
  };
}

// ---- Conflicts (FR-054, D-25) -----------------------------------------------------------------------

/**
 * The jobs that hold the technician's time inside `[start, end)`, earliest first, leaving out
 * `excludeId` (the job being scheduled, which must not collide with its own old appointment). A job
 * holds time while it is scheduled or in progress; a job still waiting for a time, a finished one
 * and a cancelled one hold none. The condition is the SQL form of the domain's `overlaps`: a job
 * overlaps when it starts before `end` and ends after `start`, so one that touches the window at an
 * edge does not.
 */
async function findConflictingJobs(
  db: Pick<DbClient, "workOrder">,
  input: { technicianId: string; start: Date; end: Date; excludeId?: string | undefined },
) {
  return db.workOrder.findMany({
    where: {
      technicianId: input.technicianId,
      status: { in: [...BOOKED_STATUSES] },
      scheduledStart: { lt: input.end },
      scheduledEnd: { gt: input.start },
      ...(input.excludeId !== undefined && { id: { not: input.excludeId } }),
    },
    select: CONFLICT_SELECT,
    orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
  });
}

/**
 * `GET /admin/work-orders/conflicts`: the read-only pre-check the scheduling dialog runs while the
 * admin chooses. It is a convenience only: the schedule endpoint checks again under the technician's
 * lock, and that check is the one that counts.
 */
export async function checkSchedulingConflicts(
  deps: Pick<AppDeps, "prisma">,
  query: ConflictsQuery,
): Promise<SchedulingConflictDto[]> {
  const { prisma } = deps;
  const technician = await prisma.technician.findUnique({
    where: { id: query.technicianId },
    select: { id: true },
  });
  if (technician === null) {
    throw notFound("That technician was not found.");
  }
  const rows = await findConflictingJobs(prisma, {
    technicianId: query.technicianId,
    start: query.start,
    end: query.end,
    excludeId: query.excludeId,
  });
  return toSchedulingConflicts(rows);
}

// ---- Converting an accepted quotation (FR-050, workflow 7.4) ----------------------------------------

export interface ConversionResult {
  workOrder: AdminWorkOrderDto;
  /** `true` when this call made the job, `false` when the quotation already had one. */
  created: boolean;
}

/**
 * Turns an accepted quotation into one work order, without re-entering anything: the customer, the
 * service (and its name as it was), the service address and the access notes are copied from the
 * request, and the scope is written from the request's description and the accepted lines. The
 * request becomes `CONVERTED_TO_JOB` (D-21), the job starts `PENDING_SCHEDULING` (D-24), and both get
 * an event; the customer reads only "created job JOB-…".
 *
 * It is **idempotent**: a quotation that already has a job returns that job (`created: false`).
 * Duplicates are prevented three ways. The request's row lock makes two conversions take turns, and
 * the second finds the first's job once the lock is its own; the unique `quotationId` (and
 * `requestId`) is the database's own refusal if a second row were ever inserted, which is caught and
 * answered with the existing job; and the request's `ACCEPTED` → `CONVERTED_TO_JOB` transition is
 * conditional, so it cannot happen twice.
 */
export async function convertToWorkOrder(
  deps: Pick<AppDeps, "prisma" | "clock">,
  auth: AuthContext,
  quotationId: string,
): Promise<ConversionResult> {
  const { prisma } = deps;

  const existingId = await findWorkOrderIdOfQuotation(prisma, quotationId);
  if (existingId !== null) {
    return { workOrder: await getAdminWorkOrder(deps, existingId), created: false };
  }

  let outcome: { id: string; created: boolean };
  try {
    outcome = await prisma.$transaction((tx) => convertInTransaction(deps, tx, auth, quotationId));
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // Another conversion of this quotation committed first. The failed statement rolled this
    // transaction back, so there is nothing of ours to undo: return the job that won.
    const winner = await findWorkOrderIdOfQuotation(prisma, quotationId);
    if (winner === null) {
      throw error;
    }
    return { workOrder: await getAdminWorkOrder(deps, winner), created: false };
  }
  return { workOrder: await getAdminWorkOrder(deps, outcome.id), created: outcome.created };
}

async function findWorkOrderIdOfQuotation(
  db: Pick<DbClient, "workOrder">,
  quotationId: string,
): Promise<string | null> {
  const row = await db.workOrder.findUnique({ where: { quotationId }, select: { id: true } });
  return row === null ? null : row.id;
}

async function convertInTransaction(
  deps: Pick<AppDeps, "clock">,
  tx: DbClient,
  auth: AuthContext,
  quotationId: string,
): Promise<{ id: string; created: boolean }> {
  const first = await tx.quotation.findUnique({
    where: { id: quotationId },
    select: { requestId: true },
  });
  if (first === null) {
    throw notFound("That quotation was not found.");
  }
  await lockRequest(tx, first.requestId);

  // Read again under the lock: a conversion that was ahead of us has committed its job by now.
  const already = await findWorkOrderIdOfQuotation(tx, quotationId);
  if (already !== null) {
    return { id: already, created: false };
  }

  const quotation = await tx.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    select: {
      id: true,
      reference: true,
      status: true,
      customerId: true,
      lineItems: { orderBy: { position: "asc" }, select: { description: true } },
    },
  });
  const request = await tx.serviceRequest.findUniqueOrThrow({
    where: { id: first.requestId },
    select: {
      id: true,
      reference: true,
      status: true,
      customerId: true,
      serviceId: true,
      serviceNameSnapshot: true,
      description: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressRegion: true,
      addressPostalCode: true,
      accessNotesSnapshot: true,
    },
  });

  if (quotation.status !== QuotationStatus.ACCEPTED) {
    throw conflict(
      `Only an accepted quotation can become a job. ${quotation.reference} is ${quotation.status.toLowerCase()}.`,
      {
        code: ErrorCode.INVALID_STATE_TRANSITION,
        details: { currentStatus: quotation.status, requestStatus: request.status },
      },
    );
  }
  if (request.status !== ServiceRequestStatus.ACCEPTED) {
    throw conflict(
      `Request ${request.reference} is ${request.status.toLowerCase().replaceAll("_", " ")}, so it cannot become a job.`,
      {
        code: ErrorCode.INVALID_STATE_TRANSITION,
        details: { currentStatus: quotation.status, requestStatus: request.status },
      },
    );
  }

  const business = await loadBusiness(tx);
  const now = deps.clock.now();
  const reference = await nextReference(tx, ReferenceType.WORK_ORDER, now, business.timeZone);
  const actor = await tx.user.findUniqueOrThrow({
    where: { id: auth.userId },
    select: { name: true },
  });

  const created = await createPendingWorkOrder(tx, {
    reference,
    requestId: request.id,
    quotationId: quotation.id,
    customerId: request.customerId,
    serviceId: request.serviceId,
    serviceNameSnapshot: request.serviceNameSnapshot,
    addressLine1: request.addressLine1,
    addressLine2: request.addressLine2,
    addressCity: request.addressCity,
    addressRegion: request.addressRegion,
    addressPostalCode: request.addressPostalCode,
    accessNotesSnapshot: request.accessNotesSnapshot,
    scopeDescription: buildScopeDescription({
      requestDescription: request.description,
      lineDescriptions: quotation.lineItems.map((line) => line.description),
    }),
    createdByUserId: auth.userId,
  });
  await markConvertedToJob(tx, request.id);

  const texts = conversionTexts({
    jobReference: reference,
    requestReference: request.reference,
    quotationReference: quotation.reference,
  });
  await recordActivity(tx, {
    actorUserId: auth.userId,
    entityType: ActivityEntityType.WORK_ORDER,
    entityId: created.id,
    requestId: request.id,
    customerId: request.customerId,
    action: "work_order.created",
    toStatus: WorkOrderStatus.PENDING_SCHEDULING,
    metadata: {
      workOrderReference: reference,
      requestReference: request.reference,
      quotationReference: quotation.reference,
      serviceName: request.serviceNameSnapshot,
    },
    ...buildActivitySummaries({
      actor: { kind: "staff", name: actor.name },
      ...texts.job,
    }),
  });
  await recordActivity(tx, {
    // The system moves the request as a consequence of the job being made (D-21).
    actorUserId: null,
    entityType: ActivityEntityType.SERVICE_REQUEST,
    entityId: request.id,
    requestId: request.id,
    customerId: request.customerId,
    action: "request.converted_to_job",
    fromStatus: ServiceRequestStatus.ACCEPTED,
    toStatus: ServiceRequestStatus.CONVERTED_TO_JOB,
    metadata: { requestReference: request.reference, workOrderReference: reference },
    ...buildActivitySummaries({ actor: { kind: "system" }, ...texts.request }),
  });

  return { id: created.id, created: true };
}

// ---- Scheduling and rescheduling (FR-053, FR-054, FR-057, D-25) -------------------------------------

/**
 * Gives a job an appointment and a technician, or moves it (`SCHEDULE` for a job with no appointment,
 * `RESCHEDULE` for a scheduled one). The checks that decide the answer, in order, all inside one
 * transaction:
 *
 * 1. the job's row is locked, then its status is judged: a stale `expectedStatus` is `409
 *    STALE_STATE`, a status that cannot be scheduled is `409 INVALID_STATE_TRANSITION`;
 * 2. a reschedule needs a reason, a first booking takes none (`422`);
 * 3. the technician's row is locked (D-25) and must exist and be active (`422 TECHNICIAN_INACTIVE`);
 * 4. no other scheduled or in-progress job of that technician overlaps the times (`409
 *    SCHEDULING_CONFLICT`, naming the first). Because the lock is held until the commit, two
 *    schedulings of one technician run one after the other, and the second sees the first;
 * 5. the status is moved by a conditional update, the history is written and the customer is told.
 *
 * Changing only the technician is not a reschedule: the customer's date and window are the same, so
 * they are told nothing, and the event is staff-only. The customer is told the date and window and
 * the job's reference, never the technician or the reason. The email is queued and sent after the
 * commit (BR-22); a failed email never undoes the booking.
 */
export async function scheduleWorkOrder(
  deps: WorkOrderDeps,
  auth: AuthContext,
  id: string,
  input: ScheduleWorkOrderInput,
): Promise<AdminWorkOrderDto> {
  const { prisma, clock, config, emailDispatcher } = deps;
  const { scheduledStart: start, scheduledEnd: end } = input;

  const problems = validateSchedule({ start, end, now: clock.now() });
  if (Object.keys(problems).length > 0) {
    throw validation(problems);
  }

  const { afterCommit } = await runInTransaction(prisma, async (tx, after) => {
    if (!(await lockWorkOrder(tx, id))) {
      throw notFound();
    }
    const job = await tx.workOrder.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        reference: true,
        status: true,
        requestId: true,
        customerId: true,
        serviceNameSnapshot: true,
        scheduledStart: true,
        scheduledEnd: true,
        technicianId: true,
      },
    });
    if (input.expectedStatus !== job.status) {
      throw staleWorkOrderError(job.status);
    }
    const action = scheduleActionFor(job.status);
    if (action === undefined) {
      throw invalidWorkOrderAction(job.status, WorkOrderAction.SCHEDULE);
    }
    const rescheduling = action === WorkOrderAction.RESCHEDULE;
    if (rescheduling && input.reason === undefined) {
      throw validation({ reason: RESCHEDULE_REASON_REQUIRED_MESSAGE });
    }
    if (!rescheduling && input.reason !== undefined) {
      throw validation({ reason: "Scheduling a job for the first time does not take a reason." });
    }

    const technician = await lockTechnician(tx, input.technicianId);
    if (technician === null) {
      throw validation({ technicianId: "Choose a technician from the list." });
    }
    if (!technician.isActive) {
      throw technicianInactiveError(technician.name);
    }

    const business = await loadBusiness(tx);
    const [firstConflict, ...otherConflicts] = toConflictingJobs(
      await findConflictingJobs(tx, { technicianId: technician.id, start, end, excludeId: id }),
    );
    if (firstConflict !== undefined) {
      throw schedulingConflictError({
        technicianName: technician.name,
        conflicts: [firstConflict, ...otherConflicts],
        timeZone: business.timeZone,
      });
    }

    // What the job had before. A rescheduled job keeps its old appointment in the history.
    const previous =
      rescheduling && job.scheduledStart !== null && job.scheduledEnd !== null
        ? { start: job.scheduledStart, end: job.scheduledEnd }
        : null;
    const timesChanged =
      previous === null ||
      previous.start.getTime() !== start.getTime() ||
      previous.end.getTime() !== end.getTime();
    const technicianChanged = job.technicianId !== technician.id;
    if (rescheduling && !timesChanged && !technicianChanged) {
      throw validation({ scheduledStart: NOTHING_TO_CHANGE_MESSAGE });
    }
    const kind = !rescheduling ? "scheduled" : timesChanged ? "rescheduled" : "reassigned";

    const previousTechnician =
      job.technicianId === null || !technicianChanged
        ? null
        : await tx.technician.findUnique({
            where: { id: job.technicianId },
            select: { id: true, name: true },
          });
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { name: true },
    });
    const { user: customer } = await tx.customerProfile.findUniqueOrThrow({
      where: { id: job.customerId },
      select: { user: { select: { id: true, name: true, email: true } } },
    });

    const { from } = await transitionWorkOrder(tx, {
      workOrderId: id,
      action,
      expectedStatus: input.expectedStatus,
      data: { scheduledStart: start, scheduledEnd: end, technicianId: technician.id },
    });

    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.WORK_ORDER,
      entityId: id,
      requestId: job.requestId,
      customerId: job.customerId,
      action: `work_order.${kind}`,
      fromStatus: from,
      toStatus: WorkOrderStatus.SCHEDULED,
      metadata: {
        workOrderReference: job.reference,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        technicianId: technician.id,
        ...(previous !== null && {
          previousScheduledStart: previous.start.toISOString(),
          previousScheduledEnd: previous.end.toISOString(),
        }),
        ...(previousTechnician !== null && { previousTechnicianId: previousTechnician.id }),
      },
      ...buildActivitySummaries({
        actor: { kind: "staff", name: actor.name },
        ...scheduleTexts({
          kind,
          reference: job.reference,
          start,
          end,
          timeZone: business.timeZone,
          technicianName: technician.name,
          previousTechnicianName: previousTechnician?.name ?? null,
          previous,
          reason: input.reason ?? null,
        }),
      }),
    });

    if (kind === "reassigned") {
      return;
    }
    const rescheduled = kind === "rescheduled";
    const linkPath = `/portal/jobs/${id}`;
    const notification = await notify(tx, {
      recipientUserId: customer.id,
      type: rescheduled ? NotificationType.JOB_RESCHEDULED : NotificationType.JOB_SCHEDULED,
      ...scheduleNotification({
        rescheduled,
        reference: job.reference,
        start,
        end,
        timeZone: business.timeZone,
      }),
      linkPath,
      entity: { type: ActivityEntityType.WORK_ORDER, id },
    });
    const common = {
      customerName: customer.name,
      jobReference: job.reference,
      serviceName: job.serviceNameSnapshot,
      jobUrl: absoluteAppUrl(config.email.publicWebUrl, linkPath),
      scheduledStart: start,
      scheduledEnd: end,
      timeZone: business.timeZone,
    };
    if (rescheduled && previous !== null) {
      after.email(
        emailJob(
          "job-rescheduled",
          customer.email,
          { ...common, previousStart: previous.start, previousEnd: previous.end },
          { notificationId: notification.id },
        ),
      );
    } else {
      after.email(
        emailJob("job-scheduled", customer.email, common, { notificationId: notification.id }),
      );
    }
  });

  emailDispatcher.dispatchAfterCommit(afterCommit);
  return getAdminWorkOrder(deps, id);
}
