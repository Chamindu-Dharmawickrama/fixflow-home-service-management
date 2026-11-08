import {
  type AdminWorkOrderDto,
  TRANSITION_RULES,
  WORK_ORDER_STATUS_LABELS,
  WorkOrderAction,
  WorkOrderStatus,
} from "@fixflow/shared";

/**
 * What the job page shows of a job's lifecycle (T18, D-24, D-43). The server decides what may be
 * done (`availableActions`); everything here only chooses how to lay that out, and nothing decides
 * whether an action is allowed.
 */

/** What each action is called on its button and in the menu. */
export const JOB_ACTION_LABELS: Readonly<Record<WorkOrderAction, string>> = {
  [WorkOrderAction.SCHEDULE]: "Schedule",
  [WorkOrderAction.RESCHEDULE]: "Reschedule",
  [WorkOrderAction.START]: "Start job",
  [WorkOrderAction.COMPLETE]: "Complete job",
  [WorkOrderAction.MARK_NEEDS_RESCHEDULING]: "Needs rescheduling",
  [WorkOrderAction.CANCEL]: "Cancel job",
  [WorkOrderAction.CREATE_INVOICE]: "Create invoice",
};

/** The actions the main button can be, in the order of preference: the one that moves the job on. */
const PRIMARY_ORDER: readonly WorkOrderAction[] = [
  WorkOrderAction.START,
  WorkOrderAction.COMPLETE,
  WorkOrderAction.SCHEDULE,
  WorkOrderAction.RESCHEDULE,
];

/** The actions the lifecycle dialogs perform: they move the job's status (the rest is the schedule dialog's). */
export type LifecycleAction =
  | typeof WorkOrderAction.START
  | typeof WorkOrderAction.COMPLETE
  | typeof WorkOrderAction.MARK_NEEDS_RESCHEDULING
  | typeof WorkOrderAction.CANCEL;

export interface JobActionLayout {
  /** The one filled button. */
  primary: WorkOrderAction | undefined;
  /** A second, outlined button: moving a scheduled job is as likely as starting it. */
  secondary: WorkOrderAction | undefined;
  /** What goes behind "More actions": the actions that end the job or take it off the calendar. */
  menu: LifecycleAction[];
}

/**
 * Lays out the actions the server lists. The action that moves the job on is the main button
 * (start a scheduled job, complete one under way, schedule one with no time). A scheduled job also
 * keeps "Reschedule" in view as an outline button. Everything else, including every action that
 * ends the job or takes it off the calendar, is behind "More actions".
 */
export function layoutJobActions(actions: readonly WorkOrderAction[]): JobActionLayout {
  const primary = PRIMARY_ORDER.find((action) => actions.includes(action));
  const secondary =
    primary === WorkOrderAction.START && actions.includes(WorkOrderAction.RESCHEDULE)
      ? WorkOrderAction.RESCHEDULE
      : undefined;
  const menu = actions.filter(
    (action): action is LifecycleAction =>
      action !== primary &&
      action !== secondary &&
      (action === WorkOrderAction.MARK_NEEDS_RESCHEDULING ||
        action === WorkOrderAction.CANCEL ||
        action === WorkOrderAction.COMPLETE ||
        action === WorkOrderAction.START),
  );
  return { primary, secondary, menu };
}

/**
 * Whether starting now is earlier than the visit's start. This is a hint for the confirmation
 * dialog only, read from the browser's clock; the server decides (`startedBeforeSchedule`).
 */
export function startsEarly(scheduledStart: string | null, nowMs: number): boolean {
  if (scheduledStart === null) return false;
  const start = Date.parse(scheduledStart);
  return !Number.isNaN(start) && nowMs < start;
}

/** The limits the dialogs show, from the one place the server takes them. */
export const NOTE_LIMITS = {
  completionSummary: TRANSITION_RULES.completionNote,
  internalNote: TRANSITION_RULES.internalNote,
  needsReschedulingReason: TRANSITION_RULES.needsReschedulingReason,
  cancelReason: TRANSITION_RULES.cancelReason,
  customerMessage: TRANSITION_RULES.customerMessage,
} as const;

// ---- The progress indicator ----------------------------------------------------------------------

const S = WorkOrderStatus;

/** The usual path of a job, in order. */
export const PROGRESS_STEPS = [
  S.PENDING_SCHEDULING,
  S.SCHEDULED,
  S.IN_PROGRESS,
  S.COMPLETED,
] as const;

export type ProgressStepState = "done" | "current" | "upcoming";

export interface ProgressStep {
  status: (typeof PROGRESS_STEPS)[number];
  label: string;
  state: ProgressStepState;
}

export interface JobProgress {
  steps: ProgressStep[];
  /** Set when the job has left the usual path: it needs a new time, or it was cancelled. */
  exit: { status: typeof S.NEEDS_RESCHEDULING | typeof S.CANCELLED; label: string } | null;
}

/**
 * Where a job stands on its usual path. A job on the path has the steps before it done, its own step
 * current and the rest ahead. A job that left the path (needs a new time, cancelled) keeps the steps
 * it had reached as done, with none current, and shows the way out as well. What it had reached is
 * read from its appointment: one that was ever given a time got as far as Scheduled. (Whether it was
 * also started is not recorded on the job, so it is not claimed.)
 */
export function jobProgress(
  job: Pick<AdminWorkOrderDto, "status" | "scheduledStart">,
): JobProgress {
  const exited = job.status === S.NEEDS_RESCHEDULING || job.status === S.CANCELLED;
  const position = PROGRESS_STEPS.findIndex((step) => step === job.status);
  const reached = exited ? (job.scheduledStart === null ? 0 : 1) : position;

  const steps = PROGRESS_STEPS.map((status, index): ProgressStep => {
    const state: ProgressStepState = exited
      ? index <= reached
        ? "done"
        : "upcoming"
      : index < reached
        ? "done"
        : index === reached
          ? "current"
          : "upcoming";
    return { status, label: WORK_ORDER_STATUS_LABELS[status], state };
  });
  return {
    steps,
    exit: exited
      ? {
          status: job.status as typeof S.NEEDS_RESCHEDULING | typeof S.CANCELLED,
          label: WORK_ORDER_STATUS_LABELS[job.status],
        }
      : null,
  };
}
