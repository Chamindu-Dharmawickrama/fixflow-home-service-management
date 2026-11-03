import type { PaginatedResponse } from "./api.js";
import type { WorkOrderStatus } from "./enums.js";

/**
 * Technician resources as the API serves them (FR-060 to FR-062, T16). A technician is a record the
 * business schedules, not a person who signs in (FR-063 is excluded), so everything here is the
 * admin's view. Customers are only ever shown a technician's display name (T18).
 */

/** How far ahead a technician's "upcoming" assignments reach, counted in business-calendar days from today. */
export const TECHNICIAN_UPCOMING_DAYS = 14;

/** How many days the availability summary covers, starting with today. */
export const TECHNICIAN_AVAILABILITY_DAYS = 7;

/**
 * The calendar colours a technician can be given: keys, never colour values. Each key has tokens in
 * the web app's `globals.css` (`--color-cal-<key>` for text and the edge, `-soft` for the fill of a
 * block) whose contrast is tested, so a block of any colour stays readable on the scheduling calendar
 * (T19). The order is the order they are offered, and the order a new technician is given one.
 */
export const TECHNICIAN_COLORS = [
  "blue",
  "green",
  "amber",
  "purple",
  "rose",
  "teal",
  "orange",
  "slate",
] as const;
export type TechnicianColor = (typeof TECHNICIAN_COLORS)[number];

export function isTechnicianColor(value: unknown): value is TechnicianColor {
  return TECHNICIAN_COLORS.some((color) => color === value);
}

/** What the admin can do to a technician from their current state (D-43). The UI shows only these. */
export const TechnicianAction = {
  EDIT: "EDIT",
  DEACTIVATE: "DEACTIVATE",
  ACTIVATE: "ACTIVATE",
} as const;
export type TechnicianAction = (typeof TechnicianAction)[keyof typeof TechnicianAction];

/** The `active` filter of `GET /admin/technicians`. Leave it out, or send `all`, for everyone. */
export const TECHNICIAN_ACTIVE_FILTERS = ["true", "false", "all"] as const;
export type TechnicianActiveFilter = (typeof TECHNICIAN_ACTIVE_FILTERS)[number];

/** The `sort` fields of `GET /admin/technicians`. */
export const ADMIN_TECHNICIAN_SORT_FIELDS = ["name"] as const;
export type AdminTechnicianSortField = (typeof ADMIN_TECHNICIAN_SORT_FIELDS)[number];

/** The job a technician does next, for the list. */
export interface TechnicianNextJobDto {
  /** The job's id, for its page (`/app/jobs/:id`); the reference is a label, never the address. */
  id: string;
  /** `JOB-YYYY-NNNNN`. */
  reference: string;
  /** ISO 8601 instant. */
  scheduledStart: string;
}

/** A technician in the list. Their internal notes are not part of it. */
export interface AdminTechnicianListItemDto {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Free tags such as "Heat pumps", in the order they were entered. */
  specialties: string[];
  calendarColor: TechnicianColor;
  isActive: boolean;
  /**
   * Assignments that have not finished yet and start within the next {@link TECHNICIAN_UPCOMING_DAYS}
   * days: scheduled or in progress, whose appointment has not ended (D-103).
   */
  upcomingJobCount: number;
  /** The first of those, or `null` when there are none. */
  nextJob: TechnicianNextJobDto | null;
  availableActions: TechnicianAction[];
}

/** One upcoming assignment on a technician's page. */
export interface TechnicianAssignmentDto {
  /** The job's id, for its page (`/app/jobs/:id`). */
  id: string;
  reference: string;
  customerName: string;
  serviceName: string;
  /** ISO 8601 instants. */
  scheduledStart: string;
  scheduledEnd: string;
  status: WorkOrderStatus;
}

/** How much of one business day a technician is booked for. */
export interface TechnicianAvailabilityDayDto {
  /** The business-calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Minutes of appointments that fall on that day (one that crosses midnight is split between the days). */
  scheduledMinutes: number;
}

/**
 * One technician in full: the answer of every single-technician endpoint (read, create, edit,
 * activate, deactivate). After a deactivation `upcomingJobCount` is the number of assignments that
 * stay with them, which the page tells the admin about (FR-060).
 */
export interface AdminTechnicianDto extends AdminTechnicianListItemDto {
  /** Internal. Never in a customer-facing shape. */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Soonest first, within the next {@link TECHNICIAN_UPCOMING_DAYS} days. */
  upcomingAssignments: TechnicianAssignmentDto[];
  /** Today and the following days, {@link TECHNICIAN_AVAILABILITY_DAYS} in all, oldest first. */
  availability: TechnicianAvailabilityDayDto[];
}

export interface AdminTechnicianListMeta {
  /** Technicians per tab, ignoring the search text, so the tabs can say how many each holds. */
  counts: { all: number; active: number; inactive: number };
  /** The colour a new technician is offered first: the one the fewest technicians have. */
  suggestedColor: TechnicianColor;
}

/** `GET /admin/technicians`: the standard list envelope plus the tab counts. */
export interface AdminTechnicianListResponse extends PaginatedResponse<AdminTechnicianListItemDto> {
  meta: AdminTechnicianListMeta;
}

/** `GET /admin/technicians/assignable`: who can be given a new job. */
export interface AssignableTechnicianDto {
  id: string;
  name: string;
  specialties: string[];
  calendarColor: TechnicianColor;
}

/**
 * `POST /admin/technicians`. Every field but the name may be left out; a blank phone, email or notes
 * is stored as nothing. Without a colour the technician gets the one the fewest others have.
 */
export interface CreateTechnicianBody {
  name: string;
  phone?: string | null;
  email?: string | null;
  specialties?: string[];
  notes?: string | null;
  calendarColor?: TechnicianColor;
}

/** `PATCH /admin/technicians/:id`: any subset, at least one field. Use the activate and deactivate endpoints for `isActive`. */
export type UpdateTechnicianBody = Partial<CreateTechnicianBody>;
