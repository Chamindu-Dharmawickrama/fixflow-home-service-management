import {
  ActivityEntityType,
  type CustomerRequestDto,
  type CustomerRequestListResponse,
  ErrorCode,
  type FieldErrors,
  NotificationType,
  ReferenceType,
  ServiceRequestStatus,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import { BUSINESS_SETTINGS_ID, type DbClient } from "../../lib/db.js";
import { AppError, forbidden, notFound, serviceUnavailable, validation } from "../../lib/errors.js";
import { paginated, toPrismaPage } from "../../lib/pagination.js";
import { nextReference } from "../../lib/references.js";
import { runInTransaction } from "../../lib/transaction.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { getTimeline, recordActivity } from "../activity/activity.service.js";
import { canActAsAdmin, canActAsCustomer } from "../auth/auth.domain.js";
import { assertCustomerOwns } from "../auth/auth.middleware.js";
import type { AuthContext } from "../auth/auth.types.js";
import { customerIdOf, insertAddress, lockCustomer } from "../customers/customers.service.js";
import { absoluteAppUrl } from "../email/email.domain.js";
import { emailJob } from "../email/email.jobs.js";
import { notifyAdmins } from "../notifications/notifications.service.js";
import { ACTIVE } from "../services/services.service.js";
import {
  type AddressInput,
  preferredDateFieldErrors,
  preferredWindowToUtc,
  snapshotAddress,
  submissionTexts,
} from "./requests.domain.js";
import {
  REQUEST_DETAIL_SELECT,
  REQUEST_LIST_SELECT,
  toCustomerRequestDto,
  toCustomerRequestListItem,
} from "./requests.dto.js";
import type { CreateRequestBody, ListMyRequestsQuery } from "./requests.schemas.js";

type RequestDeps = Pick<AppDeps, "prisma" | "clock" | "config" | "emailDispatcher">;

export const SERVICE_INACTIVE_MESSAGE =
  "This service isn't open for new requests right now. Please choose another service.";
export const ADDRESS_NOT_SAVED_MESSAGE =
  "That isn't one of your saved addresses. Choose another one or enter a new address.";
const NOT_SET_UP = "The business settings have not been set up yet.";

/** What a submission needs to know about the business. */
async function loadBusiness(db: Pick<DbClient, "businessSettings">) {
  const settings = await db.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { timeZone: true, contactEmail: true, businessName: true },
  });
  if (settings === null) {
    // The seed creates the row; its absence is a deployment problem, not something to hide as a 404.
    throw serviceUnavailable(NOT_SET_UP);
  }
  return settings;
}

/** The request as its owner sees it, with the history written for the customer (D-41). */
async function loadCustomerRequest(db: DbClient, id: string): Promise<CustomerRequestDto | null> {
  const row = await db.serviceRequest.findUnique({ where: { id }, select: REQUEST_DETAIL_SELECT });
  if (row === null) {
    return null;
  }
  const [timeline, business] = await Promise.all([
    getTimeline(db, { requestId: row.id }, "customer", row.customerId),
    loadBusiness(db),
  ]);
  return toCustomerRequestDto({ row, timeline, viewer: { businessName: business.businessName } });
}

export interface SubmissionResult {
  request: CustomerRequestDto;
  /** False when the same `submissionKey` had already created this request (D-45). */
  created: boolean;
}

/**
 * Submits a request for the signed-in customer (FR-020, FR-021, spec §7.1). The server decides
 * everything that matters: the owner is the session's customer, the service must be active, the date
 * must be in range on the business's calendar, and the address, reference, status and UTC times are
 * the server's. One transaction holds the request, the address saved with it, the history and the
 * admin notifications, so a failure at any step leaves nothing behind; the emails are queued in it
 * and sent only after it commits (BR-22).
 *
 * The customer's row lock, taken first, makes this safe to repeat: a second submission with the same
 * key, from a double click or a retry, waits for the first and then returns its request.
 */
export async function submitRequest(
  deps: RequestDeps,
  auth: AuthContext,
  body: CreateRequestBody,
): Promise<SubmissionResult> {
  const { prisma, clock, config, emailDispatcher } = deps;
  const customerId = customerIdOf(auth);

  const business = await loadBusiness(prisma);
  const now = clock.now();
  const dateErrors = preferredDateFieldErrors(body.preferredDate, now, business.timeZone);

  const { result, afterCommit } = await runInTransaction(prisma, async (tx, after) => {
    await lockCustomer(tx, customerId);

    const repeated = await tx.serviceRequest.findUnique({
      where: { customerId_submissionKey: { customerId, submissionKey: body.submissionKey } },
      select: { id: true },
    });
    if (repeated !== null) {
      return { id: repeated.id, created: false };
    }

    const [service, savedAddress] = await Promise.all([
      tx.service.findFirst({
        where: { id: body.serviceId, ...ACTIVE },
        select: { id: true, name: true },
      }),
      // Someone else's address is looked up with the caller's id, so it is simply not found.
      body.serviceAddressId === undefined
        ? Promise.resolve(null)
        : tx.serviceAddress.findFirst({ where: { id: body.serviceAddressId, customerId } }),
    ]);

    const problems: FieldErrors = { ...dateErrors };
    if (service === null) {
      problems.serviceId = SERVICE_INACTIVE_MESSAGE;
    }
    if (body.serviceAddressId !== undefined && savedAddress === null) {
      problems.serviceAddressId = ADDRESS_NOT_SAVED_MESSAGE;
    }
    if (service === null) {
      throw new AppError(422, ErrorCode.SERVICE_INACTIVE, SERVICE_INACTIVE_MESSAGE, {
        fieldErrors: problems,
      });
    }
    if (Object.keys(problems).length > 0) {
      throw validation(problems);
    }

    // The address the request keeps a copy of, and the saved address it links to (if any).
    let source: AddressInput;
    let linkedAddressId: string | null = null;
    if (savedAddress !== null) {
      source = savedAddress;
      linkedAddressId = savedAddress.id;
    } else if (body.newAddress !== undefined && body.saveAddressToProfile === true) {
      const saved = await insertAddress(tx, customerId, {
        ...body.newAddress,
        // The schema requires a label when the address is saved.
        label: body.newAddress.label ?? "",
      });
      source = saved;
      linkedAddressId = saved.id;
    } else if (body.newAddress !== undefined) {
      source = body.newAddress;
    } else {
      throw validation({ serviceAddressId: "Choose where the work is to be done." });
    }

    const owner = await tx.customerProfile.findUniqueOrThrow({
      where: { id: customerId },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    const { start, end } = preferredWindowToUtc(
      body.preferredDate,
      body.preferredWindow,
      business.timeZone,
    );
    const reference = await nextReference(tx, ReferenceType.REQUEST, now, business.timeZone);

    const created = await tx.serviceRequest.create({
      data: {
        reference,
        customerId,
        serviceId: service.id,
        serviceNameSnapshot: service.name,
        serviceAddressId: linkedAddressId,
        ...snapshotAddress(source),
        description: body.description,
        preferredDate: new Date(`${body.preferredDate}T00:00:00.000Z`),
        preferredWindow: body.preferredWindow,
        preferredStart: start,
        preferredEnd: end,
        status: ServiceRequestStatus.SUBMITTED,
        submissionKey: body.submissionKey,
        submittedAt: now,
      },
      select: { id: true },
    });

    const texts = submissionTexts({
      reference,
      serviceName: service.name,
      customerName: owner.user.name,
    });
    await recordActivity(tx, {
      actorUserId: owner.user.id,
      entityType: ActivityEntityType.SERVICE_REQUEST,
      entityId: created.id,
      requestId: created.id,
      customerId,
      action: "request.submitted",
      toStatus: ServiceRequestStatus.SUBMITTED,
      metadata: {
        requestReference: reference,
        preferredDate: body.preferredDate,
        preferredWindow: body.preferredWindow,
      },
      ...buildActivitySummaries({
        actor: { kind: "customer", name: owner.user.name },
        ...texts.activity,
      }),
    });

    const adminLink = `/app/requests/${created.id}`;
    await notifyAdmins(tx, {
      type: NotificationType.REQUEST_RECEIVED,
      ...texts.adminNotification,
      linkPath: adminLink,
      entity: { type: ActivityEntityType.SERVICE_REQUEST, id: created.id },
    });

    // Only queued here: they are sent after the commit, and a failure to send never undoes the request.
    after.email(
      emailJob("request-received-customer", owner.user.email, {
        customerName: owner.user.name,
        requestReference: reference,
        serviceName: service.name,
        requestUrl: absoluteAppUrl(config.email.publicWebUrl, `/portal/requests/${created.id}`),
        preferredStart: start,
        preferredEnd: end,
        timeZone: business.timeZone,
      }),
    );
    after.email(
      emailJob("request-received-admin", business.contactEmail, {
        requestReference: reference,
        serviceName: service.name,
        customerName: owner.user.name,
        requestUrl: absoluteAppUrl(config.email.publicWebUrl, adminLink),
      }),
    );

    return { id: created.id, created: true };
  });

  emailDispatcher.dispatchAfterCommit(afterCommit);

  const request = await loadCustomerRequest(prisma, result.id);
  if (request === null) {
    // Cannot happen: the request was just committed and requests are never deleted.
    throw notFound();
  }
  return { request, created: result.created };
}

/** The signed-in customer's requests, newest first, optionally of one status. */
export async function listMyRequests(
  deps: Pick<AppDeps, "prisma">,
  auth: AuthContext,
  query: ListMyRequestsQuery,
): Promise<CustomerRequestListResponse> {
  const where = {
    customerId: customerIdOf(auth),
    ...(query.status !== undefined && { status: query.status }),
  };
  const [rows, totalItems] = await Promise.all([
    deps.prisma.serviceRequest.findMany({
      where,
      select: REQUEST_LIST_SELECT,
      ...toPrismaPage(query),
    }),
    deps.prisma.serviceRequest.count({ where }),
  ]);
  return paginated(rows.map(toCustomerRequestListItem), query, totalItems);
}

/**
 * One request, in the shape its customer sees (D-41). The owner gets it; so does an admin, who is
 * previewing what the customer sees. Any other customer gets `404`, exactly like an id that does
 * not exist, and the reference is never a way in: only the id is looked up, and ownership is
 * checked every time (BR-21).
 */
export async function getRequest(
  deps: Pick<AppDeps, "prisma" | "config">,
  auth: AuthContext,
  id: string,
): Promise<CustomerRequestDto> {
  // Authorize first, from the owner's id alone: nothing else is read for a caller who may not see it.
  const owner = await deps.prisma.serviceRequest.findUnique({
    where: { id },
    select: { customerId: true },
  });
  if (canActAsCustomer(auth)) {
    assertCustomerOwns(owner?.customerId, auth);
  } else if (!canActAsAdmin(auth, deps.config.auth.adminEmails)) {
    throw forbidden();
  }
  if (owner === null) {
    throw notFound();
  }

  const request = await loadCustomerRequest(deps.prisma, id);
  if (request === null) {
    throw notFound();
  }
  return request;
}
