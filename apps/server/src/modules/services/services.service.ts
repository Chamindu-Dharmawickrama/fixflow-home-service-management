import {
  ActivityEntityType,
  type AdminServiceDto,
  type AdminServiceListResponse,
  ErrorCode,
  type PublicServiceDto,
  type ServiceCatalogueState,
  serviceCatalogueState,
  slugify,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma, Service } from "../../generated/prisma/client.js";
import { BUSINESS_SETTINGS_ID, type DbClient, isUniqueViolation } from "../../lib/db.js";
import { AppError, conflict, notFound, serviceUnavailable, validation } from "../../lib/errors.js";
import { paginated, toPrismaPage } from "../../lib/pagination.js";
import { escapeLikePattern } from "../../lib/sql-like.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { recordActivity } from "../activity/activity.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import {
  actionForPublishFlag,
  applyTransition,
  assertExpectedStatus,
  changedServiceFields,
  LIFECYCLE_EVENTS,
  type LifecycleAction,
  mergeServiceValues,
  pickFreeSlug,
  type ServiceField,
  type ServicePatch,
  type ServiceValues,
  validateServiceValues,
} from "./services.domain.js";
import { toAdminServiceDto, toPublicServiceDto } from "./services.dto.js";
import type {
  AdminServicesQuery,
  CreateServiceBody,
  UpdateServiceBody,
} from "./services.schemas.js";

type ServiceDeps = Pick<AppDeps, "prisma" | "clock">;

/** A service is active, so visible and requestable, when it is published and not archived. */
const ACTIVE = { isPublished: true, archivedAt: null } as const satisfies Prisma.ServiceWhereInput;

/** Tries to find a free slug this many times before giving up (only a burst of equal names loses). */
const MAX_SLUG_ATTEMPTS = 3;

async function loadCurrency(db: Pick<DbClient, "businessSettings">): Promise<string> {
  const settings = await db.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { currencyCode: true },
  });
  if (settings === null) {
    throw serviceUnavailable("The business settings have not been set up yet.");
  }
  return settings.currencyCode;
}

function slugTaken(): AppError {
  const message = "Another service already uses this web address. Choose a different one.";
  return new AppError(409, ErrorCode.SLUG_TAKEN, message, { fieldErrors: { slug: message } });
}

function staleLifecycle(): AppError {
  return conflict("This service was changed by someone else. Reload it and try again.", {
    code: ErrorCode.STALE_STATE,
  });
}

function valuesOf(row: Service): ServiceValues {
  return {
    name: row.name,
    slug: row.slug,
    category: row.category,
    shortDescription: row.shortDescription,
    fullDescription: row.fullDescription,
    inclusions: [...row.inclusions],
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    pricingMode: row.pricingMode,
    startingPrice: row.startingPrice === null ? null : row.startingPrice.toFixed(2),
    imageKey: row.imageKey,
    imageUrl: row.imageUrl,
    sortOrder: row.sortOrder,
  };
}

// ---------------------------------------------------------------------------------------------
// Public: the website's view of the catalogue (FR-006)
// ---------------------------------------------------------------------------------------------

/** Active services only, in the order the business set, optionally within one category. */
export async function listPublicServices(
  deps: Pick<AppDeps, "prisma">,
  query: { category?: string | undefined },
): Promise<PublicServiceDto[]> {
  const [rows, currencyCode] = await Promise.all([
    deps.prisma.service.findMany({
      where: {
        ...ACTIVE,
        ...(query.category !== undefined && {
          category: { equals: query.category, mode: "insensitive" },
        }),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    }),
    loadCurrency(deps.prisma),
  ]);
  return rows.map((row) => toPublicServiceDto(row, currencyCode));
}

/** One active service by its web address or id. An unpublished or archived one is `404`, as if absent. */
export async function getPublicService(
  deps: Pick<AppDeps, "prisma">,
  where: { slug: string } | { id: string },
): Promise<PublicServiceDto> {
  const [row, currencyCode] = await Promise.all([
    deps.prisma.service.findFirst({ where: { ...where, ...ACTIVE } }),
    loadCurrency(deps.prisma),
  ]);
  if (row === null) {
    throw notFound("That service is not available.");
  }
  return toPublicServiceDto(row, currencyCode);
}

// ---------------------------------------------------------------------------------------------
// Admin: reading
// ---------------------------------------------------------------------------------------------

function statusFilter(status: AdminServicesQuery["status"]): Prisma.ServiceWhereInput {
  switch (status) {
    case "published":
      return ACTIVE;
    case "unpublished":
      return { isPublished: false, archivedAt: null };
    case "archived":
      return { archivedAt: { not: null } };
    case undefined:
      return {};
  }
}

function searchFilter(search: string | undefined): Prisma.ServiceWhereInput {
  if (search === undefined) {
    return {};
  }
  // `contains` hands the text to ILIKE as it is, so `%` and `_` would act as wildcards.
  const contains = { contains: escapeLikePattern(search), mode: "insensitive" } as const;
  return {
    OR: [
      { name: contains },
      { category: contains },
      { slug: contains },
      { shortDescription: contains },
    ],
  };
}

/** Every service, newest changes included, with the tab counts (FR-101). */
export async function listAdminServices(
  deps: Pick<AppDeps, "prisma">,
  query: AdminServicesQuery,
): Promise<AdminServiceListResponse> {
  const where: Prisma.ServiceWhereInput = {
    AND: [statusFilter(query.status), searchFilter(query.search)],
  };
  const { skip, take } = toPrismaPage(query);

  const [rows, totalItems, published, unpublished, archived, currencyCode] = await Promise.all([
    deps.prisma.service.findMany({
      where,
      skip,
      take,
      // Ties fall back to the name, so equal display orders still read alphabetically.
      orderBy: [
        { [query.sort]: query.order },
        ...(query.sort === "name" ? [] : [{ name: "asc" as const }]),
        { id: "asc" as const },
      ],
    }),
    deps.prisma.service.count({ where }),
    deps.prisma.service.count({ where: statusFilter("published") }),
    deps.prisma.service.count({ where: statusFilter("unpublished") }),
    deps.prisma.service.count({ where: statusFilter("archived") }),
    loadCurrency(deps.prisma),
  ]);

  return {
    ...paginated(
      rows.map((row) => toAdminServiceDto(row, currencyCode)),
      query,
      totalItems,
    ),
    meta: {
      counts: { all: published + unpublished + archived, published, unpublished, archived },
      currencyCode,
    },
  };
}

export async function getAdminService(
  deps: Pick<AppDeps, "prisma">,
  id: string,
): Promise<AdminServiceDto> {
  const [row, currencyCode] = await Promise.all([
    deps.prisma.service.findUnique({ where: { id } }),
    loadCurrency(deps.prisma),
  ]);
  if (row === null) {
    throw notFound("That service was not found.");
  }
  return toAdminServiceDto(row, currencyCode);
}

// ---------------------------------------------------------------------------------------------
// Admin: writing. Every change and its activity event are one transaction (D-29).
// ---------------------------------------------------------------------------------------------

async function actorName(tx: DbClient, auth: AuthContext): Promise<string> {
  const actor = await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true } });
  if (actor === null) {
    throw notFound();
  }
  return actor.name;
}

/** The staff-only history line. The service's name is in the sentence; metadata holds names only. */
function recordServiceEvent(
  tx: DbClient,
  auth: AuthContext,
  actor: string,
  service: { id: string; name: string },
  event: {
    action: string;
    /** The verb phrase before the service's name: "archived the service". */
    staff: string;
    fromStatus?: ServiceCatalogueState;
    toStatus?: ServiceCatalogueState;
    changedFields?: readonly ServiceField[];
    isPublished?: boolean;
  },
) {
  const changes =
    event.changedFields === undefined ? "" : ` (changed: ${event.changedFields.join(", ")})`;
  return recordActivity(tx, {
    actorUserId: auth.userId,
    entityType: ActivityEntityType.SERVICE,
    entityId: service.id,
    action: event.action,
    ...(event.fromStatus !== undefined && { fromStatus: event.fromStatus }),
    ...(event.toStatus !== undefined && { toStatus: event.toStatus }),
    ...buildActivitySummaries({
      actor: { kind: "staff", name: actor },
      staff: `${event.staff} "${service.name}"${changes}`,
    }),
    metadata: {
      ...(event.changedFields !== undefined && { changedFields: [...event.changedFields] }),
      ...(event.isPublished !== undefined && { isPublished: event.isPublished }),
    },
  });
}

async function freeSlug(tx: DbClient, name: string): Promise<string> {
  const base = slugify(name);
  const rows = await tx.service.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  return pickFreeSlug(base, new Set(rows.map((row) => row.slug)));
}

/**
 * Creates a service. Without a `slug` one is made from the name (`ac-repair`, then `ac-repair-2` when
 * taken); a slug the admin typed that is already used is `409 SLUG_TAKEN`. A new service is
 * unpublished unless the body says otherwise.
 */
export async function createService(
  deps: ServiceDeps,
  auth: AuthContext,
  body: CreateServiceBody,
): Promise<AdminServiceDto> {
  const typedSlug = body.slug;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await deps.prisma.$transaction(async (tx) => {
        const [currencyCode, actor] = await Promise.all([loadCurrency(tx), actorName(tx, auth)]);
        const created = await tx.service.create({
          data: {
            name: body.name,
            slug: typedSlug ?? (await freeSlug(tx, body.name)),
            category: body.category,
            shortDescription: body.shortDescription,
            fullDescription: body.fullDescription,
            inclusions: body.inclusions,
            estimatedDurationMinutes: body.estimatedDurationMinutes,
            pricingMode: body.pricingMode,
            startingPrice: body.startingPrice,
            imageKey: body.imageKey,
            imageUrl: body.imageUrl,
            sortOrder: body.sortOrder,
            isPublished: body.isPublished,
          },
        });
        await recordServiceEvent(tx, auth, actor, created, {
          action: "service.created",
          staff: body.isPublished ? "created and published the service" : "created the service",
          toStatus: serviceCatalogueState(created),
          isPublished: created.isPublished,
        });
        return toAdminServiceDto(created, currencyCode);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // A typed slug that clashes is the admin's to change; a generated one lost a race, so look again.
      if (typedSlug !== undefined || attempt >= MAX_SLUG_ATTEMPTS) {
        throw slugTaken();
      }
    }
  }
}

/**
 * Edits a service. `expectedStatus` guards against acting on a stale form (`409 STALE_STATE`), and
 * the write itself only succeeds if the service is still in the state it was read in, so two admins
 * can never both win. `isPublished` publishes or unpublishes through the lifecycle rules: an
 * archived service cannot be published (`409 INVALID_STATE_TRANSITION`).
 */
export async function updateService(
  deps: ServiceDeps,
  auth: AuthContext,
  id: string,
  body: UpdateServiceBody,
): Promise<AdminServiceDto> {
  const { expectedStatus, isPublished: wantsPublished, ...content } = body;
  const patch: ServicePatch = content;

  try {
    return await deps.prisma.$transaction(async (tx) => {
      const [row, currencyCode] = await Promise.all([
        tx.service.findUnique({ where: { id } }),
        loadCurrency(tx),
      ]);
      if (row === null) {
        throw notFound("That service was not found.");
      }
      const state = serviceCatalogueState(row);
      assertExpectedStatus(state, expectedStatus);

      const current = valuesOf(row);
      const merged = mergeServiceValues(current, patch);
      const fieldErrors = validateServiceValues(merged);
      if (Object.keys(fieldErrors).length > 0) {
        throw validation(fieldErrors);
      }
      const changedFields = changedServiceFields(current, merged);

      const action =
        wantsPublished === undefined ? undefined : actionForPublishFlag(state, wantsPublished);
      const lifecycle =
        action === undefined ? undefined : applyTransition(row, action, deps.clock.now());

      if (changedFields.length === 0 && lifecycle === undefined) {
        return toAdminServiceDto(row, currencyCode);
      }

      // Only the changed fields, named from the closed `SERVICE_FIELDS` list and already validated.
      const fieldData = Object.fromEntries(
        changedFields.map((field) => [field, merged[field]]),
      ) as Prisma.ServiceUncheckedUpdateManyInput;
      const written = await tx.service.updateMany({
        // Conditional on the state it was read in: a concurrent archive or publish makes this miss.
        where: { id, isPublished: row.isPublished, archivedAt: row.archivedAt },
        data: { ...fieldData, ...lifecycle },
      });
      if (written.count === 0) {
        throw staleLifecycle();
      }
      const updated = await tx.service.findUniqueOrThrow({ where: { id } });

      const actor = await actorName(tx, auth);
      if (changedFields.length > 0) {
        await recordServiceEvent(tx, auth, actor, updated, {
          action: "service.updated",
          staff: "updated the service",
          changedFields,
        });
      }
      if (action !== undefined) {
        await recordLifecycleEvent(tx, auth, actor, updated, action, state);
      }
      return toAdminServiceDto(updated, currencyCode);
    });
  } catch (error) {
    throw isUniqueViolation(error) ? slugTaken() : error;
  }
}

function recordLifecycleEvent(
  tx: DbClient,
  auth: AuthContext,
  actor: string,
  service: Service,
  action: LifecycleAction,
  fromStatus: ServiceCatalogueState,
) {
  const event = LIFECYCLE_EVENTS[action];
  return recordServiceEvent(tx, auth, actor, service, {
    action: event.action,
    staff: `${event.verb} the service`,
    fromStatus,
    toStatus: serviceCatalogueState(service),
    isPublished: service.isPublished,
  });
}

/**
 * Archives or restores a service (D-50). Archived services leave the website and cannot be
 * requested; existing requests are unaffected. A restored service comes back unpublished.
 */
export async function transitionService(
  deps: ServiceDeps,
  auth: AuthContext,
  id: string,
  action: Extract<LifecycleAction, "ARCHIVE" | "RESTORE">,
  expectedStatus: ServiceCatalogueState,
): Promise<AdminServiceDto> {
  return deps.prisma.$transaction(async (tx) => {
    const [row, currencyCode] = await Promise.all([
      tx.service.findUnique({ where: { id } }),
      loadCurrency(tx),
    ]);
    if (row === null) {
      throw notFound("That service was not found.");
    }
    const state = serviceCatalogueState(row);
    assertExpectedStatus(state, expectedStatus);
    const next = applyTransition(row, action, deps.clock.now());

    const written = await tx.service.updateMany({
      where: { id, isPublished: row.isPublished, archivedAt: row.archivedAt },
      data: next,
    });
    if (written.count === 0) {
      throw staleLifecycle();
    }
    const updated = await tx.service.findUniqueOrThrow({ where: { id } });
    await recordLifecycleEvent(tx, auth, await actorName(tx, auth), updated, action, state);
    return toAdminServiceDto(updated, currencyCode);
  });
}
