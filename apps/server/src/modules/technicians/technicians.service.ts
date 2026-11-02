import {
  ActivityEntityType,
  type AdminTechnicianDto,
  type AdminTechnicianListResponse,
  type AssignableTechnicianDto,
  TechnicianState,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import { Prisma, type Technician } from "../../generated/prisma/client.js";
import { BUSINESS_SETTINGS_ID, type DbClient } from "../../lib/db.js";
import { notFound, serviceUnavailable } from "../../lib/errors.js";
import { paginated, toPrismaPage } from "../../lib/pagination.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { recordActivity } from "../activity/activity.service.js";
import type { AuthContext } from "../auth/auth.types.js";
// The one place that knows how a name, an email address and a phone number are searched for.
import { customerSearchPatterns } from "../customers/customers.admin.domain.js";
import {
  type AssignmentWindow,
  assignmentWindow,
  BOOKED_STATUSES,
  changedTechnicianFields,
  isUpcoming,
  keptAssignmentsPhrase,
  mergeTechnicianValues,
  pickCalendarColor,
  scheduledMinutesPerDay,
  type TechnicianField,
  type TechnicianValues,
} from "./technicians.domain.js";
import {
  type AssignmentRow,
  toAdminTechnicianDto,
  toAssignableTechnicianDto,
  toTechnicianListItem,
  type UpcomingSummary,
} from "./technicians.dto.js";
import type {
  AdminTechniciansQuery,
  CreateTechnicianInput,
  UpdateTechnicianInput,
} from "./technicians.schemas.js";

type TechnicianDeps = Pick<AppDeps, "prisma" | "clock">;

async function loadTimeZone(db: Pick<DbClient, "businessSettings">): Promise<string> {
  const settings = await db.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { timeZone: true },
  });
  if (settings === null) {
    // The seed creates the row; its absence is a deployment problem, not something to hide as a 404.
    throw serviceUnavailable("The business settings have not been set up yet.");
  }
  return settings.timeZone;
}

function notFoundTechnician(): Error {
  return notFound("That technician was not found.");
}

function valuesOf(row: Technician): TechnicianValues {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    specialties: [...row.specialties],
    notes: row.notes,
    calendarColor: row.calendarColor,
  };
}

// ---------------------------------------------------------------------------------------------
// Upcoming assignments and bookings, from the real work orders (FR-062)
// ---------------------------------------------------------------------------------------------

/**
 * The SQL form of {@link isUpcoming}: a job that holds its technician's time, whose appointment has
 * not ended and starts inside the window. (A null time never satisfies a comparison, so a work
 * order that is not scheduled at all is never counted.)
 */
function upcomingWhere(window: AssignmentWindow): Prisma.WorkOrderWhereInput {
  return {
    status: { in: [...BOOKED_STATUSES] },
    scheduledEnd: { gt: window.from },
    scheduledStart: { lt: window.until },
  };
}

/** How many assignments a technician has that are still to come. */
function countUpcoming(db: Pick<DbClient, "workOrder">, id: string, window: AssignmentWindow) {
  return db.workOrder.count({ where: { technicianId: id, ...upcomingWhere(window) } });
}

/** For each technician on a page: their upcoming count and the soonest of them. */
async function summariseUpcoming(
  db: Pick<DbClient, "workOrder">,
  ids: readonly string[],
  window: AssignmentWindow,
): Promise<Map<string, UpcomingSummary>> {
  const summaries = new Map<string, UpcomingSummary>(
    ids.map((id) => [id, { count: 0, next: null }]),
  );
  if (ids.length === 0) {
    return summaries;
  }
  const jobs = await db.workOrder.findMany({
    where: { technicianId: { in: [...ids] }, ...upcomingWhere(window) },
    select: { technicianId: true, reference: true, scheduledStart: true },
    orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
  });
  for (const job of jobs) {
    const summary = job.technicianId === null ? undefined : summaries.get(job.technicianId);
    if (summary === undefined || job.scheduledStart === null) {
      continue;
    }
    summary.count += 1;
    // Soonest first, so the first one seen is the next job.
    summary.next ??= { reference: job.reference, scheduledStart: job.scheduledStart };
  }
  return summaries;
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

function activeFilter(active: AdminTechniciansQuery["active"]): Prisma.TechnicianWhereInput {
  switch (active) {
    case "true":
      return { isActive: true };
    case "false":
      return { isActive: false };
    case "all":
    case undefined:
      return {};
  }
}

/**
 * The technicians a search finds, by id: a name, email address or specialty (ignoring case) or a
 * phone number (by its digits, so "212-555" finds "(212) 555-0151"). The text is bound as a
 * parameter and its wildcards are escaped, so what is typed means what it says. Specialties are
 * a list, which Prisma cannot match without regard to case, hence the one raw query.
 */
async function searchIds(db: DbClient, search: string): Promise<string[]> {
  const { text, phoneDigits } = customerSearchPatterns(search);
  const phone =
    phoneDigits === undefined
      ? Prisma.empty
      : Prisma.sql` OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE ${phoneDigits}`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM technicians
    WHERE name ILIKE ${text} OR email ILIKE ${text}${phone}
       OR EXISTS (SELECT 1 FROM unnest(specialties) AS tag WHERE tag ILIKE ${text})`;
  return rows.map((row) => row.id);
}

/** Everyone, whatever their state, A to Z by default, with the tab counts (FR-060). */
export async function listAdminTechnicians(
  deps: TechnicianDeps,
  query: AdminTechniciansQuery,
): Promise<AdminTechnicianListResponse> {
  const { prisma, clock } = deps;
  const timeZone = await loadTimeZone(prisma);
  const window = assignmentWindow(clock.now(), timeZone);

  const matching = query.q === undefined ? undefined : await searchIds(prisma, query.q);
  const where: Prisma.TechnicianWhereInput = {
    AND: [activeFilter(query.active), matching === undefined ? {} : { id: { in: matching } }],
  };
  const { skip, take, orderBy } = toPrismaPage(query);

  const [rows, totalItems, states, colors] = await Promise.all([
    prisma.technician.findMany({ where, skip, take, orderBy }),
    prisma.technician.count({ where }),
    prisma.technician.groupBy({ by: ["isActive"], _count: { _all: true } }),
    prisma.technician.findMany({ select: { calendarColor: true } }),
  ]);
  const upcoming = await summariseUpcoming(
    prisma,
    rows.map((row) => row.id),
    window,
  );

  const countOf = (isActive: boolean) =>
    states.find((state) => state.isActive === isActive)?._count._all ?? 0;
  const active = countOf(true);
  const inactive = countOf(false);

  return {
    ...paginated(
      rows.map((row) =>
        toTechnicianListItem(row, upcoming.get(row.id) ?? { count: 0, next: null }),
      ),
      query,
      totalItems,
    ),
    meta: {
      counts: { all: active + inactive, active, inactive },
      suggestedColor: pickCalendarColor(colors.map((row) => row.calendarColor)),
    },
  };
}

/** Active technicians only, A to Z: who a new job can be given to (FR-061). */
export async function listAssignableTechnicians(
  deps: Pick<AppDeps, "prisma">,
): Promise<AssignableTechnicianDto[]> {
  const rows = await deps.prisma.technician.findMany({
    where: { isActive: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return rows.map(toAssignableTechnicianDto);
}

/**
 * One technician in full: details, the assignments still to come in the next 14 days (soonest
 * first) and the minutes booked on each of the next 7 days, all from the real work orders. Both
 * lists are made from one read of the jobs that overlap the 14 days, then sorted out here.
 */
export async function getAdminTechnician(
  deps: TechnicianDeps,
  id: string,
): Promise<AdminTechnicianDto> {
  const { prisma, clock } = deps;
  const timeZone = await loadTimeZone(prisma);
  const window = assignmentWindow(clock.now(), timeZone);

  const row = await prisma.technician.findUnique({ where: { id } });
  if (row === null) {
    throw notFoundTechnician();
  }

  const jobs = await prisma.workOrder.findMany({
    where: {
      technicianId: id,
      status: { in: [...BOOKED_STATUSES] },
      // From the start of today, not now: a job that ran this morning still filled the day.
      scheduledEnd: { gt: window.since },
      scheduledStart: { lt: window.until },
    },
    select: {
      reference: true,
      serviceNameSnapshot: true,
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      customer: { select: { user: { select: { name: true } } } },
    },
    orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
  });

  const booked: AssignmentRow[] = jobs.flatMap((job) =>
    job.scheduledStart === null || job.scheduledEnd === null
      ? []
      : [
          {
            reference: job.reference,
            serviceNameSnapshot: job.serviceNameSnapshot,
            status: job.status,
            scheduledStart: job.scheduledStart,
            scheduledEnd: job.scheduledEnd,
            customerName: job.customer.user.name,
          },
        ],
  );

  return toAdminTechnicianDto(
    row,
    booked.filter((job) => isUpcoming(job, window)),
    scheduledMinutesPerDay(booked, window.days),
  );
}

// ---------------------------------------------------------------------------------------------
// Writing. Every change and its activity event are one transaction (D-29).
// ---------------------------------------------------------------------------------------------

async function actorName(tx: DbClient, auth: AuthContext): Promise<string> {
  const actor = await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true } });
  if (actor === null) {
    throw notFound();
  }
  return actor.name;
}

/**
 * The staff-only history line. The technician's name is in the sentence (it is internal, like a
 * service's name); the metadata holds field names and the flag only, never contact details or notes.
 */
function recordTechnicianEvent(
  tx: DbClient,
  auth: AuthContext,
  actor: string,
  technician: { id: string; name: string },
  event: {
    action: string;
    /** The verb phrase before the technician's name: "deactivated the technician". */
    staff: string;
    /** What follows the name, in brackets. */
    detail?: string;
    fromStatus?: TechnicianState;
    toStatus?: TechnicianState;
    changedFields?: readonly TechnicianField[];
    isActive?: boolean;
  },
) {
  const detail = event.detail === undefined ? "" : ` (${event.detail})`;
  return recordActivity(tx, {
    actorUserId: auth.userId,
    entityType: ActivityEntityType.TECHNICIAN,
    entityId: technician.id,
    action: event.action,
    ...(event.fromStatus !== undefined && { fromStatus: event.fromStatus }),
    ...(event.toStatus !== undefined && { toStatus: event.toStatus }),
    ...buildActivitySummaries({
      actor: { kind: "staff", name: actor },
      staff: `${event.staff} "${technician.name}"${detail}`,
    }),
    metadata: {
      ...(event.changedFields !== undefined && { changedFields: [...event.changedFields] }),
      ...(event.isActive !== undefined && { isActive: event.isActive }),
    },
  });
}

/** Adds a technician. They start active; without a colour they get the one the fewest others have. */
export async function createTechnician(
  deps: TechnicianDeps,
  auth: AuthContext,
  body: CreateTechnicianInput,
): Promise<AdminTechnicianDto> {
  const created = await deps.prisma.$transaction(async (tx) => {
    const actor = await actorName(tx, auth);
    const calendarColor =
      body.calendarColor ??
      pickCalendarColor(
        (await tx.technician.findMany({ select: { calendarColor: true } })).map(
          (row) => row.calendarColor,
        ),
      );
    const row = await tx.technician.create({
      data: {
        name: body.name,
        phone: body.phone,
        email: body.email,
        specialties: body.specialties,
        notes: body.notes,
        calendarColor,
      },
    });
    await recordTechnicianEvent(tx, auth, actor, row, {
      action: "technician.created",
      staff: "added the technician",
      toStatus: TechnicianState.ACTIVE,
      isActive: true,
    });
    return row;
  });
  return getAdminTechnician(deps, created.id);
}

/**
 * Edits the details. Only the fields that differ are written, so two admins changing different
 * fields do not undo each other; a save that changes nothing writes nothing and records nothing.
 * Active or inactive is not edited here (see {@link deactivateTechnician}).
 */
export async function updateTechnician(
  deps: TechnicianDeps,
  auth: AuthContext,
  id: string,
  body: UpdateTechnicianInput,
): Promise<AdminTechnicianDto> {
  await deps.prisma.$transaction(async (tx) => {
    const row = await tx.technician.findUnique({ where: { id } });
    if (row === null) {
      throw notFoundTechnician();
    }
    const current = valuesOf(row);
    const merged = mergeTechnicianValues(current, body);
    const changedFields = changedTechnicianFields(current, merged);
    if (changedFields.length === 0) {
      return;
    }
    // Only the changed fields, named from the closed `TECHNICIAN_FIELDS` list and already validated.
    const data = Object.fromEntries(
      changedFields.map((field) => [field, merged[field]]),
    ) as Prisma.TechnicianUncheckedUpdateInput;
    const updated = await tx.technician.update({ where: { id }, data });
    await recordTechnicianEvent(tx, auth, await actorName(tx, auth), updated, {
      action: "technician.updated",
      staff: "updated the technician",
      detail: `changed: ${changedFields.join(", ")}`,
      changedFields,
    });
  });
  return getAdminTechnician(deps, id);
}

/**
 * Makes a technician available (`isActive` true) or unavailable for new assignments, and says what
 * it did. It is idempotent: asking for the state they are already in changes nothing, records
 * nothing and answers `200` with the technician as they are. The write is conditional on the
 * opposite state, so of two simultaneous requests only one records the change. A deactivation never
 * touches the jobs already assigned (FR-060): they stay, and the answer's `upcomingJobCount` is how
 * many.
 */
async function setActive(
  deps: TechnicianDeps,
  auth: AuthContext,
  id: string,
  isActive: boolean,
): Promise<AdminTechnicianDto> {
  const timeZone = await loadTimeZone(deps.prisma);
  const window = assignmentWindow(deps.clock.now(), timeZone);

  await deps.prisma.$transaction(async (tx) => {
    const written = await tx.technician.updateMany({
      where: { id, isActive: !isActive },
      data: { isActive },
    });
    if (written.count === 0) {
      // Already in that state (nothing to do), or not there at all.
      const exists = await tx.technician.findUnique({ where: { id }, select: { id: true } });
      if (exists === null) {
        throw notFoundTechnician();
      }
      return;
    }
    const row = await tx.technician.findUniqueOrThrow({
      where: { id },
      select: { id: true, name: true },
    });
    const actor = await actorName(tx, auth);
    await recordTechnicianEvent(tx, auth, actor, row, {
      action: isActive ? "technician.activated" : "technician.deactivated",
      staff: isActive ? "reactivated the technician" : "deactivated the technician",
      ...(!isActive && { detail: keptAssignmentsPhrase(await countUpcoming(tx, id, window)) }),
      fromStatus: isActive ? TechnicianState.INACTIVE : TechnicianState.ACTIVE,
      toStatus: isActive ? TechnicianState.ACTIVE : TechnicianState.INACTIVE,
      isActive,
    });
  });
  return getAdminTechnician(deps, id);
}

export function deactivateTechnician(deps: TechnicianDeps, auth: AuthContext, id: string) {
  return setActive(deps, auth, id, false);
}

export function activateTechnician(deps: TechnicianDeps, auth: AuthContext, id: string) {
  return setActive(deps, auth, id, true);
}
