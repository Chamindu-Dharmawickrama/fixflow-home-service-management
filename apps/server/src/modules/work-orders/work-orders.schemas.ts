import {
  ADMIN_WORK_ORDER_SORT_FIELDS,
  isDateOnly,
  SCHEDULE_RULES,
  WORK_ORDER_VIEWS,
  WorkOrderStatus,
} from "@fixflow/shared";
import { z } from "zod";

import { createPaginationSchema } from "../../lib/pagination.js";
import { enumListFilter, requiredText } from "../../lib/zod-fields.js";

const statusValues = Object.values(WorkOrderStatus) as [WorkOrderStatus, ...WorkOrderStatus[]];

const ISO_INSTANT = z.iso.datetime({ offset: true });

/**
 * An instant written ISO 8601 with `Z` or an offset (`2026-03-03T15:00:00Z`), read into a `Date`.
 * The check aborts: otherwise Zod keeps the raw text of a bad value, goes on to the checks of the
 * object around it, and those would be handed a string where they expect a `Date`.
 */
const instant = (label: string) =>
  z
    .string({ error: `${label} must be a date and time like 2026-03-03T15:00:00Z.` })
    .refine((value) => ISO_INSTANT.safeParse(value).success, {
      error: `${label} must be a date and time like 2026-03-03T15:00:00Z.`,
      abort: true,
    })
    .transform((value) => new Date(value));

const dateOnly = (label: string) =>
  z
    .string({ error: `${label} must be a single date written YYYY-MM-DD.` })
    .refine(isDateOnly, `${label} must be a date written YYYY-MM-DD.`);

export const workOrderIdParamsSchema = z.object({
  id: z.uuid({ error: "The job id must be a valid id." }),
});

export const quotationIdParamsSchema = z.object({
  id: z.uuid({ error: "The quotation id must be a valid id." }),
});

/**
 * `PATCH /admin/work-orders/:id/schedule` (FR-053, FR-054, FR-057). Strict: nothing but the
 * appointment, the technician and the status the screen saw can be sent, so a status, a reference or
 * a customer cannot be. Whether the times make a sensible appointment is `validateSchedule`'s call,
 * made with the server's clock; whether a reason is needed depends on the job's status, which only
 * the service knows.
 */
export const scheduleWorkOrderBodySchema = z.strictObject({
  scheduledStart: instant("scheduledStart"),
  scheduledEnd: instant("scheduledEnd"),
  technicianId: z.uuid({ error: "Choose a technician." }),
  expectedStatus: z.enum(statusValues, {
    error: "expectedStatus must be the status the job had when you loaded it.",
  }),
  reason: requiredText("reason", {
    min: SCHEDULE_RULES.rescheduleReasonMinLength,
    max: SCHEDULE_RULES.rescheduleReasonMaxLength,
    multiline: true,
  }).optional(),
});

export type ScheduleWorkOrderInput = z.output<typeof scheduleWorkOrderBodySchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `GET /admin/work-orders/conflicts?technicianId&start&end&excludeId`: the read-only pre-check. The
 * window is bounded (a week), because the screen asks about one appointment or one day.
 */
export const conflictsQuerySchema = z
  .object({
    technicianId: z.uuid({ error: "technicianId must be a valid id." }),
    start: instant("start"),
    end: instant("end"),
    excludeId: z.uuid({ error: "excludeId must be a valid id." }).optional(),
  })
  .superRefine((query, ctx) => {
    if (query.end.getTime() <= query.start.getTime()) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "end must be after start." });
    } else if (
      query.end.getTime() - query.start.getTime() >
      SCHEDULE_RULES.maxConflictWindowDays * DAY_MS
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: `The window can be at most ${SCHEDULE_RULES.maxConflictWindowDays} days.`,
      });
    }
  });

export type ConflictsQuery = z.output<typeof conflictsQuerySchema>;

/**
 * `GET /admin/work-orders` (FR-052): search, filters, sort and a page. `view` is the preset behind
 * each tab; `status` narrows it further (or stands alone, for a link that names the statuses).
 */
export const adminWorkOrdersQuerySchema = createPaginationSchema({
  sortFields: ADMIN_WORK_ORDER_SORT_FIELDS,
  defaultSort: "createdAt",
  defaultOrder: "desc",
})
  .extend({
    /** Reference, customer name or customer email; case-insensitive; blank means no search. */
    q: z
      .string({ error: "q must be a single piece of text." })
      .trim()
      .max(100, "q must be 100 characters or fewer.")
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
    view: z
      .enum(WORK_ORDER_VIEWS, `view must be one of: ${WORK_ORDER_VIEWS.join(", ")}.`)
      .optional(),
    status: enumListFilter(statusValues, "status"),
    technicianId: z.uuid({ error: "technicianId must be a valid id." }).optional(),
    customerId: z.uuid({ error: "customerId must be a valid id." }).optional(),
    /** Days on the business's calendar, inclusive, matched against the appointment's start. */
    scheduledFrom: dateOnly("scheduledFrom").optional(),
    scheduledTo: dateOnly("scheduledTo").optional(),
  })
  .refine(
    (query) =>
      query.scheduledFrom === undefined ||
      query.scheduledTo === undefined ||
      query.scheduledFrom <= query.scheduledTo,
    { path: ["scheduledTo"], message: "scheduledTo must not be before scheduledFrom." },
  );

export type AdminWorkOrdersQuery = z.output<typeof adminWorkOrdersQuerySchema>;
