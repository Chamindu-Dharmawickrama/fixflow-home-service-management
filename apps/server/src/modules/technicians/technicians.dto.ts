import {
  type AdminTechnicianDto,
  type AdminTechnicianListItemDto,
  type AssignableTechnicianDto,
  isTechnicianColor,
  TECHNICIAN_COLORS,
  type TechnicianAssignmentDto,
  type TechnicianAvailabilityDayDto,
  type TechnicianColor,
  type WorkOrderStatus,
} from "@fixflow/shared";

import type { Technician } from "../../generated/prisma/client.js";
import { availableActions } from "./technicians.domain.js";

/**
 * Serializers for technician resources. Every shape here is the admin's: a technician's internal
 * notes, contact details and workload are staff matters, and the customer's own view of a job
 * (T18) names the technician by display name only and is built by its own function.
 */

/** The first colour of the palette, for a stored key that is not on it (it should never happen). */
const FALLBACK_COLOR: TechnicianColor = TECHNICIAN_COLORS[0];

/** The column is free text; the DTO promises a palette key, so anything else is shown as the first one. */
export function colorOf(stored: string): TechnicianColor {
  return isTechnicianColor(stored) ? stored : FALLBACK_COLOR;
}

/** What the list shows of a technician's workload. */
export interface UpcomingSummary {
  count: number;
  next: { reference: string; scheduledStart: Date } | null;
}

export function toTechnicianListItem(
  row: Technician,
  upcoming: UpcomingSummary,
): AdminTechnicianListItemDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    specialties: [...row.specialties],
    calendarColor: colorOf(row.calendarColor),
    isActive: row.isActive,
    upcomingJobCount: upcoming.count,
    nextJob:
      upcoming.next === null
        ? null
        : {
            reference: upcoming.next.reference,
            scheduledStart: upcoming.next.scheduledStart.toISOString(),
          },
    availableActions: availableActions(row.isActive),
  };
}

/** An upcoming job as read from the database, with its customer's name. */
export interface AssignmentRow {
  reference: string;
  serviceNameSnapshot: string;
  status: WorkOrderStatus;
  scheduledStart: Date;
  scheduledEnd: Date;
  customerName: string;
}

export function toAssignmentDto(row: AssignmentRow): TechnicianAssignmentDto {
  return {
    reference: row.reference,
    customerName: row.customerName,
    serviceName: row.serviceNameSnapshot,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    status: row.status,
  };
}

/** `assignments` are the upcoming ones, soonest first; the count and the next job follow from them. */
export function toAdminTechnicianDto(
  row: Technician,
  assignments: readonly AssignmentRow[],
  availability: TechnicianAvailabilityDayDto[],
): AdminTechnicianDto {
  const [next] = assignments;
  return {
    ...toTechnicianListItem(row, {
      count: assignments.length,
      next: next === undefined ? null : next,
    }),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    upcomingAssignments: assignments.map(toAssignmentDto),
    availability,
  };
}

export function toAssignableTechnicianDto(row: Technician): AssignableTechnicianDto {
  return {
    id: row.id,
    name: row.name,
    specialties: [...row.specialties],
    calendarColor: colorOf(row.calendarColor),
  };
}
