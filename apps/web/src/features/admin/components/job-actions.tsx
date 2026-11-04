"use client";

import {
  type AdminWorkOrderDto,
  ErrorCode,
  type TransitionWorkOrderBody,
  WorkOrderAction,
  type WorkOrderTransitionResponse,
} from "@fixflow/shared";
import {
  Ban,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  ChevronDown,
  CircleCheck,
  Play,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { apiFetchEnvelope, describeApiError, isApiError } from "@/lib/api";
import { formatDateTime, formatTimeRange, formatTimeZoneName } from "@/lib/formatting/datetime";

import {
  JOB_ACTION_LABELS,
  layoutJobActions,
  type LifecycleAction,
  NOTE_LIMITS,
  startsEarly,
} from "../lib/job-lifecycle";
import { adminJobPath } from "../lib/jobs";
import { ScheduleDialog } from "./schedule-dialog";

export interface JobActionsProps {
  job: Pick<
    AdminWorkOrderDto,
    | "id"
    | "reference"
    | "status"
    | "scheduledStart"
    | "scheduledEnd"
    | "technician"
    | "customer"
    | "availableActions"
  >;
  /** The business time zone (IANA), from the settings. */
  timeZone: string;
  /** The address asked for the dialog to be open (a job just made from a quotation lands this way). */
  openSchedule: boolean;
}

const STALE_MESSAGE =
  "Someone else changed this job, so the page has been reloaded. Check it and try again.";

/** The sentence for a failed change; a job that moved on says so in words the person can act on. */
function describeChangeError(caught: unknown): string {
  return isApiError(caught) && caught.code === ErrorCode.STALE_STATE
    ? STALE_MESSAGE
    : describeApiError(caught);
}

const ACTION_ICONS = {
  [WorkOrderAction.SCHEDULE]: CalendarPlus,
  [WorkOrderAction.RESCHEDULE]: CalendarClock,
  [WorkOrderAction.START]: Play,
  [WorkOrderAction.COMPLETE]: CircleCheck,
  [WorkOrderAction.MARK_NEEDS_RESCHEDULING]: CalendarX,
  [WorkOrderAction.CANCEL]: Ban,
} as const;

/**
 * The buttons on a job's page (D-24, D-43). The server names what may be done (`availableActions`);
 * this offers exactly that and nothing else: the action that moves the job on is the main button, a
 * scheduled job keeps "Reschedule" beside it, and "Needs rescheduling" and "Cancel job" are behind
 * "More actions". Every lifecycle action asks first, says what will happen to the customer, and
 * keeps what was typed if the server refuses. Nothing is announced as done until the server has said
 * so; a job that someone else changed meanwhile is reloaded behind the dialog so the page tells the
 * truth.
 */
export function JobActions({ job, timeZone, openSchedule }: JobActionsProps) {
  const router = useRouter();
  const { primary, secondary, menu } = layoutJobActions(job.availableActions);
  const canReschedule = job.availableActions.includes(WorkOrderAction.RESCHEDULE);
  const canSchedule = canReschedule || job.availableActions.includes(WorkOrderAction.SCHEDULE);

  const [scheduleOpen, setScheduleOpen] = useState(openSchedule && canSchedule);
  const [dialog, setDialog] = useState<LifecycleAction | null>(null);
  // Read once, when the start dialog opens, from the browser's clock: a hint only. The server judges.
  const [earlyHint, setEarlyHint] = useState(false);
  const scheduleButton = useRef<HTMLButtonElement>(null);

  // Managed focus. A menu item opens a dialog as the menu closes, so the menu must not take focus
  // back; and when a change removes the control that had focus (the main button changes from "Start
  // job" to "Complete job", or goes), focus moves to the page rather than being lost.
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const openingDialogFromMenu = useRef(false);
  const checkFocusOnUpdate = useRef(false);

  useEffect(() => {
    if (!checkFocusOnUpdate.current) return;
    checkFocusOnUpdate.current = false;
    const focused = document.activeElement;
    if (focused === null || focused === document.body || !focused.isConnected) {
      document.getElementById(MAIN_CONTENT_ID)?.focus();
    }
  }, [job.status, job.availableActions]);

  /** Sends the change. A job that has moved on is reloaded, so the page and the buttons catch up. */
  const change = async (
    body: Omit<TransitionWorkOrderBody, "expectedStatus">,
  ): Promise<WorkOrderTransitionResponse> => {
    let response: WorkOrderTransitionResponse;
    try {
      response = await apiFetchEnvelope<WorkOrderTransitionResponse>(
        `/admin/work-orders/${encodeURIComponent(job.id)}/transitions`,
        { method: "POST", body: { ...body, expectedStatus: job.status } },
      );
    } catch (caught) {
      if (isApiError(caught) && (caught.status === 404 || caught.status === 409)) {
        router.refresh();
      }
      throw new Error(describeChangeError(caught), { cause: caught });
    }
    checkFocusOnUpdate.current = true;
    router.refresh();
    return response;
  };

  const closeSchedule = (next: boolean) => {
    setScheduleOpen(next);
    // The address that opened the dialog is not the page's address any more.
    if (!next && openSchedule) {
      router.replace(adminJobPath(job.id), { scroll: false });
    }
  };

  const closeDialog = (open: boolean) => {
    if (open) return;
    setDialog(null);
    // The menu item that opened the dialog is gone; the menu's own button is the next best place.
    if (openingDialogFromMenu.current) {
      setTimeout(() => menuTriggerRef.current?.focus(), 0);
    }
  };

  const choose = (action: WorkOrderAction, fromMenu: boolean) => {
    if (action === WorkOrderAction.SCHEDULE || action === WorkOrderAction.RESCHEDULE) {
      setScheduleOpen(true);
      return;
    }
    if (
      action !== WorkOrderAction.START &&
      action !== WorkOrderAction.COMPLETE &&
      action !== WorkOrderAction.MARK_NEEDS_RESCHEDULING &&
      action !== WorkOrderAction.CANCEL
    ) {
      return;
    }
    openingDialogFromMenu.current = fromMenu;
    if (action === WorkOrderAction.START) {
      setEarlyHint(startsEarly(job.scheduledStart, new Date().getTime()));
    }
    setDialog(action);
  };

  if (primary === undefined && menu.length === 0) {
    return null;
  }

  const PrimaryIcon = primary === undefined ? null : ACTION_ICONS[primary];
  const SecondaryIcon = secondary === undefined ? null : ACTION_ICONS[secondary];
  const customerName = job.customer.name;
  const scheduledFor =
    job.scheduledStart === null || job.scheduledEnd === null
      ? null
      : `${formatDateTime(job.scheduledStart, timeZone)} to ${formatTimeRange(
          job.scheduledStart,
          job.scheduledEnd,
          timeZone,
        )} ${formatTimeZoneName(job.scheduledStart, timeZone)}`;

  return (
    <>
      {primary === undefined || PrimaryIcon === null ? null : (
        <Button
          ref={
            primary === WorkOrderAction.SCHEDULE || primary === WorkOrderAction.RESCHEDULE
              ? scheduleButton
              : undefined
          }
          onClick={() => choose(primary, false)}
        >
          <PrimaryIcon aria-hidden="true" />
          {JOB_ACTION_LABELS[primary]}
        </Button>
      )}

      {secondary === undefined || SecondaryIcon === null ? null : (
        <Button ref={scheduleButton} variant="outline" onClick={() => choose(secondary, false)}>
          <SecondaryIcon aria-hidden="true" />
          {JOB_ACTION_LABELS[secondary]}
        </Button>
      )}

      {menu.length === 0 ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={menuTriggerRef} variant="outline">
              More actions
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            onCloseAutoFocus={(event) => {
              if (openingDialogFromMenu.current) {
                event.preventDefault();
              }
            }}
          >
            {menu.map((action) => {
              const Icon = ACTION_ICONS[action];
              return (
                <DropdownMenuItem
                  key={action}
                  destructive={action === WorkOrderAction.CANCEL}
                  onSelect={() => choose(action, true)}
                >
                  <Icon aria-hidden="true" />
                  {JOB_ACTION_LABELS[action]}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {canSchedule ? (
        <ScheduleDialog
          open={scheduleOpen}
          onOpenChange={closeSchedule}
          rescheduling={canReschedule}
          timeZone={timeZone}
          returnFocusTo={scheduleButton}
          job={{
            id: job.id,
            reference: job.reference,
            status: job.status,
            scheduledStart: job.scheduledStart,
            scheduledEnd: job.scheduledEnd,
            technicianId: job.technician?.id ?? null,
            customerName,
          }}
          onScheduled={(saved) => {
            closeSchedule(false);
            toast.success(
              canReschedule
                ? `${saved.reference} was rescheduled`
                : `${saved.reference} is scheduled`,
              {
                description: `${customerName} is told the date and time by notification and email.`,
              },
            );
            router.refresh();
          }}
          onStale={() => router.refresh()}
        />
      ) : null}

      <ConfirmDialog
        open={dialog === WorkOrderAction.START}
        onOpenChange={closeDialog}
        title={`Start ${job.reference}?`}
        consequence={
          <div className="flex flex-col gap-3">
            <p>
              The job becomes In progress and the time you start is recorded. {customerName} sees
              &ldquo;In progress&rdquo; on their job page. They are not sent a message.
            </p>
            {earlyHint && scheduledFor !== null ? (
              <p
                role="note"
                className="rounded-lg bg-attention-soft p-3 font-medium text-attention"
              >
                This job is booked for {scheduledFor}, which is later than now. You can still start
                it; the start recorded is the moment you confirm.
              </p>
            ) : null}
          </div>
        }
        confirmLabel="Start job"
        cancelLabel="Not yet"
        onConfirm={async () => {
          const { meta } = await change({ action: WorkOrderAction.START });
          if (meta.startedBeforeSchedule) {
            toast.warning(`${job.reference} was started before its booked time`, {
              description: "The start is recorded as now.",
            });
          } else {
            toast.success(`${job.reference} is in progress`, {
              description: `${customerName} sees it as In progress.`,
            });
          }
        }}
      />

      <ConfirmDialog
        open={dialog === WorkOrderAction.COMPLETE}
        onOpenChange={closeDialog}
        title={`Complete ${job.reference}?`}
        consequence={
          <div className="flex flex-col gap-2">
            <p>
              The job is marked completed and cannot be changed afterwards. {customerName} is told
              in their portal and by email, and reads the summary below on their job page.
            </p>
            <p>The job then appears under Ready to invoice.</p>
          </div>
        }
        confirmLabel="Complete job"
        reason={{
          label: "Completion summary for the customer",
          minLength: NOTE_LIMITS.completionSummary.minLength,
          maxLength: NOTE_LIMITS.completionSummary.maxLength,
          description:
            "What was done, parts replaced, any advice. The customer reads this on their job page.",
        }}
        secondary={{
          label: "Internal note (optional)",
          maxLength: NOTE_LIMITS.internalNote.maxLength,
          description: "Only your team sees this. It is never shown to the customer.",
        }}
        onConfirm={async (completionNote, internalNote) => {
          await change({
            action: WorkOrderAction.COMPLETE,
            ...(completionNote !== undefined && { completionNote }),
            ...(internalNote !== undefined && { internalNote }),
          });
          toast.success(`${job.reference} is complete`, {
            description: `${customerName} is told, and the job is ready to invoice.`,
          });
        }}
      />

      <ConfirmDialog
        open={dialog === WorkOrderAction.MARK_NEEDS_RESCHEDULING}
        onOpenChange={closeDialog}
        title={`${job.reference} needs a new time?`}
        consequence={
          <div className="flex flex-col gap-2">
            <p>
              The booked time is released, so the technician is free for it, and the job moves to
              Needs rescheduling until you book a new one. {customerName} is told we need to find a
              new time, in their portal and by email.
            </p>
            <p>
              They read only the message you write below, or a short standard line if you leave it
              empty. Your reason stays inside the business.
            </p>
          </div>
        }
        confirmLabel="Mark as needing a new time"
        cancelLabel="Keep the booking"
        reason={{
          label: "Reason (internal)",
          minLength: NOTE_LIMITS.needsReschedulingReason.minLength,
          maxLength: NOTE_LIMITS.needsReschedulingReason.maxLength,
          description: "Only your team sees this.",
        }}
        secondary={{
          label: "Message to the customer",
          maxLength: NOTE_LIMITS.customerMessage.maxLength,
          description: "Optional. The customer reads this in the email.",
        }}
        onConfirm={async (reason, customerMessage) => {
          await change({
            action: WorkOrderAction.MARK_NEEDS_RESCHEDULING,
            ...(reason !== undefined && { reason }),
            ...(customerMessage !== undefined && { customerMessage }),
          });
          toast.success(`${job.reference} needs a new time`, {
            description: "Book one with Schedule when you have agreed it.",
          });
        }}
      />

      <ConfirmDialog
        open={dialog === WorkOrderAction.CANCEL}
        onOpenChange={closeDialog}
        title={`Cancel ${job.reference}?`}
        consequence={
          <div className="flex flex-col gap-2">
            <p>
              The job is closed and cannot be reopened. Any booked time is released. {customerName}{" "}
              is told it was cancelled, in their portal and by email.
            </p>
            <p>
              They read only the message you write below, or a short standard line if you leave it
              empty. Your reason stays inside the business.
            </p>
          </div>
        }
        confirmLabel="Cancel job"
        cancelLabel="Keep job"
        destructive
        reason={{
          label: "Reason (internal)",
          minLength: NOTE_LIMITS.cancelReason.minLength,
          maxLength: NOTE_LIMITS.cancelReason.maxLength,
          description: "Only your team sees this.",
        }}
        secondary={{
          label: "Message to the customer",
          maxLength: NOTE_LIMITS.customerMessage.maxLength,
          description: "Optional. The customer reads this in the email.",
        }}
        onConfirm={async (reason, customerMessage) => {
          await change({
            action: WorkOrderAction.CANCEL,
            ...(reason !== undefined && { reason }),
            ...(customerMessage !== undefined && { customerMessage }),
          });
          toast.success(`${job.reference} was cancelled`, {
            description: "It stays in the history with your reason.",
          });
        }}
      />
    </>
  );
}
