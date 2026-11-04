import {
  ADMIN_WORK_ORDER_SORT_FIELDS,
  CUSTOMER_WORK_ORDER_GROUPS,
  isDateOnly,
  SCHEDULE_RULES,
  TRANSITION_RULES,
  WORK_ORDER_TRANSITION_ACTIONS,
  WORK_ORDER_VIEWS,
  WorkOrderAction,
  WorkOrderStatus,
  type WorkOrderTransitionAction,
} from "@fixflow/shared";
import { z } from "zod";

import { createPaginationSchema } from "../../lib/pagination.js";
import { enumListFilter, optionalText, requiredText } from "../../lib/zod-fields.js";

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

// ---- Starting, finishing, cancelling (T18) -----------------------------------------------------

type TransitionField = "completionNote" | "internalNote" | "reason" | "customerMessage";

const TRANSITION_FIELDS: readonly TransitionField[] = [
  "completionNote",
  "internalNote",
  "reason",
  "customerMessage",
];

/** What each action needs, and what else it may carry. Every other field is refused. */
const FIELDS_FOR_ACTION: Readonly<
  Record<
    WorkOrderTransitionAction,
    { required: readonly TransitionField[]; optional: readonly TransitionField[] }
  >
> = {
  [WorkOrderAction.START]: { required: [], optional: [] },
  [WorkOrderAction.MARK_NEEDS_RESCHEDULING]: {
    required: ["reason"],
    optional: ["customerMessage"],
  },
  [WorkOrderAction.COMPLETE]: { required: ["completionNote"], optional: ["internalNote"] },
  [WorkOrderAction.CANCEL]: { required: ["reason"], optional: ["customerMessage"] },
};

const MISSING_MESSAGES: Readonly<Record<TransitionField, string>> = {
  completionNote: `Enter a completion summary of ${TRANSITION_RULES.completionNote.minLength} to ${TRANSITION_RULES.completionNote.maxLength} characters, so the customer knows what was done.`,
  internalNote: "Enter the internal note.",
  reason: "Enter a reason, so the history says why.",
  customerMessage: "Enter the message for the customer.",
};

const FIELD_LABELS: Readonly<Record<TransitionField, string>> = {
  completionNote: "a completion summary",
  internalNote: "an internal note",
  reason: "a reason",
  customerMessage: "a message for the customer",
};

/**
 * `POST /admin/work-orders/:id/transitions` (FR-055, D-24). Strict: the status itself cannot be
 * sent, only one of the four actions that lead to one. Each action needs its own text and refuses
 * the others, so a cancellation cannot carry a completion summary and a completion cannot carry a
 * reason; the screens send exactly what their dialog collects.
 *
 * - `COMPLETE` needs the **customer-visible** `completionNote` and may carry an `internalNote`;
 * - `MARK_NEEDS_RESCHEDULING` and `CANCEL` need an internal `reason` and may carry a
 *   `customerMessage`, the one thing the customer is told in the business's own words.
 *
 * Whether the action is allowed in the job's status is the service's call: that is `409`, and this
 * schema's `422` comes first.
 */
export const transitionWorkOrderBodySchema = z
  .strictObject({
    action: z.enum(WORK_ORDER_TRANSITION_ACTIONS, {
      error: `action must be one of: ${WORK_ORDER_TRANSITION_ACTIONS.join(", ")}.`,
    }),
    expectedStatus: z.enum(statusValues, {
      error: "expectedStatus must be the status the job had when you loaded it.",
    }),
    completionNote: requiredText("completion summary", {
      min: TRANSITION_RULES.completionNote.minLength,
      max: TRANSITION_RULES.completionNote.maxLength,
      multiline: true,
    }).optional(),
    internalNote: optionalText("internal note", {
      max: TRANSITION_RULES.internalNote.maxLength,
      multiline: true,
    }).optional(),
    reason: requiredText("reason", {
      min: TRANSITION_RULES.cancelReason.minLength,
      max: TRANSITION_RULES.cancelReason.maxLength,
      multiline: true,
    }).optional(),
    customerMessage: optionalText("message for the customer", {
      max: TRANSITION_RULES.customerMessage.maxLength,
      multiline: true,
    }).optional(),
  })
  .superRefine((body, ctx) => {
    const rules = FIELDS_FOR_ACTION[body.action];
    for (const field of TRANSITION_FIELDS) {
      const value = body[field];
      // A blank optional text is null: it says "none", so it does not count as present.
      const present = value !== undefined && value !== null;
      const needed = rules.required.includes(field);
      if (needed && value === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: MISSING_MESSAGES[field] });
      } else if (present && !needed && !rules.optional.includes(field)) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `This action does not take ${FIELD_LABELS[field]}.`,
        });
      }
    }
    // A job that needs a new time keeps its reason in the history line, which is short.
    if (
      body.action === WorkOrderAction.MARK_NEEDS_RESCHEDULING &&
      body.reason !== undefined &&
      body.reason.length > TRANSITION_RULES.needsReschedulingReason.maxLength
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: `The reason must be ${TRANSITION_RULES.needsReschedulingReason.maxLength} characters or fewer.`,
      });
    }
  });

export type TransitionWorkOrderInput = z.output<typeof transitionWorkOrderBodySchema>;

// ---- The customer's list (T18) -----------------------------------------------------------------

/**
 * `GET /work-orders/me`: the customer's jobs, upcoming first and then finished and cancelled ones.
 * The order is the list's own (it is not a column), so there is no real choice of `sort`. `group`
 * asks for one section only, which is how the portal fills "Upcoming visits" and "Past jobs".
 */
export const listMyWorkOrdersQuerySchema = createPaginationSchema({
  sortFields: ["scheduledStart"],
  defaultSort: "scheduledStart",
  defaultOrder: "asc",
}).extend({
  group: z
    .enum(CUSTOMER_WORK_ORDER_GROUPS, {
      error: `group must be one of: ${CUSTOMER_WORK_ORDER_GROUPS.join(", ")}.`,
    })
    .optional(),
});

export type ListMyWorkOrdersQuery = z.output<typeof listMyWorkOrdersQuerySchema>;
