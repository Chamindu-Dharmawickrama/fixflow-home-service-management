"use client";

import {
  type AdminWorkOrderDto,
  ErrorCode,
  SCHEDULE_RULES,
  type WorkOrderStatus,
} from "@fixflow/shared";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";

import { Field } from "@/components/forms/field";
import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { DateInput, TimeInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";
import { formatDate, formatTime, formatTimeZoneName } from "@/lib/formatting/datetime";

import {
  conflictSentence,
  dayRequest,
  describeJobTime,
  describeMove,
  durationChoices,
  formatDuration,
  initialScheduleValues,
  mapServerFieldErrors,
  resolveSchedule,
  type ScheduleField,
  type ScheduleFormErrors,
  type ScheduleFormValues,
  toScheduleBody,
  validateScheduleForm,
} from "../lib/schedule-form";
import {
  CONFLICT_CHECK_DEBOUNCE_MS,
  useAssignableTechnicians,
  useJobsInWindow,
  windowQuery,
} from "../lib/use-scheduling-checks";

/** The job as the dialog needs to know it. */
export interface ScheduleDialogJob {
  id: string;
  reference: string;
  /** The status the page showed: the server refuses the booking if the job has moved on (D-46). */
  status: WorkOrderStatus;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** The technician now on the job, if any. */
  technicianId: string | null;
  customerName: string;
}

export interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: ScheduleDialogJob;
  /** The job has an appointment to move (it is `SCHEDULED`): a reason is needed, and the form starts from it. */
  rescheduling: boolean;
  /** The business time zone (IANA), from the settings. */
  timeZone: string;
  /** Where focus goes when the dialog closes: the button that opened it. */
  returnFocusTo?: RefObject<HTMLElement | null> | undefined;
  /** The server accepted the booking and returned the job. */
  onScheduled: (job: AdminWorkOrderDto) => void;
  /** The job is not as the page showed it (someone else changed it): reload the page. */
  onStale: () => void;
}

const STALE_MESSAGE =
  "Someone else changed this job, so the page has been reloaded. Check the details and save again.";

const FIELD_IDS: Record<ScheduleField, string> = {
  date: "schedule-date",
  startTime: "schedule-start-time",
  duration: "schedule-duration",
  technicianId: "schedule-technician",
  reason: "schedule-reason",
};

const FIELD_ORDER: readonly ScheduleField[] = [
  "date",
  "startTime",
  "duration",
  "technicianId",
  "reason",
];

/** The first field, in the order the person meets them, that has a message. */
function firstWithMessage(errors: ScheduleFormErrors): ScheduleField | null {
  return FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

/**
 * Schedules a job, or moves its appointment (FR-053, FR-054, FR-057). The admin types a day and a
 * start time as they read on the business's clocks, with the time zone said out loud, and chooses
 * how long the visit lasts and who goes. While they choose, the dialog shows the technician's other
 * jobs that day and asks the server whether the exact time is free. That is a convenience: saving
 * asks the server again under the technician's lock, and a refusal is shown here with the job it
 * collided with, the inputs untouched.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  returnFocusTo,
  ...rest
}: ScheduleDialogProps) {
  // A save in flight cannot be dismissed: Escape, a click outside and the close button all wait.
  const pending = useRef(false);
  // The control that had focus when the dialog opened (or the one the page says to return to).
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // The content is unmounted the moment the dialog closes, so focus is given back here, in the
  // same commit, instead of relying on the library's deferred hand-back. Without it focus would be
  // lost to the page behind (D-73 lesson: a controlled dialog has no trigger to return to).
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      returnFocusRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending.current) return;
        onOpenChange(next);
      }}
    >
      {open ? (
        <ScheduleDialogContent
          {...rest}
          pending={pending}
          returnFocusRef={returnFocusRef}
          returnFocusTo={returnFocusTo}
        />
      ) : null}
    </Dialog>
  );
}

function ScheduleDialogContent({
  job,
  rescheduling,
  timeZone,
  onScheduled,
  onStale,
  pending: pendingRef,
  returnFocusRef,
  returnFocusTo,
}: Omit<ScheduleDialogProps, "open" | "onOpenChange"> & {
  pending: { current: boolean };
  returnFocusRef: { current: HTMLElement | null };
}) {
  const [values, setValues] = useState<ScheduleFormValues>(() =>
    initialScheduleValues(
      {
        rescheduling,
        scheduledStart: job.scheduledStart,
        scheduledEnd: job.scheduledEnd,
        technicianId: job.technicianId,
      },
      timeZone,
    ),
  );
  const [errors, setErrors] = useState<ScheduleFormErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  /** The server refused the booking because of an overlap (the alert says with which job). */
  const [refused, setRefused] = useState(false);
  const [pending, setPending] = useState(false);

  // Focus goes to the first field with a message from an effect, which runs after the commit that
  // enables the inputs again. Calling `focus()` in the `catch` would run while they are still
  // disabled (they stay disabled while a save is in flight), and a disabled input cannot take it.
  const focusAfterRef = useRef<ScheduleField | null>(null);
  useEffect(() => {
    const field = focusAfterRef.current;
    if (field !== null) {
      focusAfterRef.current = null;
      document.getElementById(FIELD_IDS[field])?.focus();
    }
  });

  const technicians = useAssignableTechnicians();
  const assignable = technicians.lookup.status === "ready" ? technicians.lookup.value : [];
  // A technician who is no longer on the list (deactivated since the job was given to them) is not
  // a choice: the field starts empty and asks for someone else.
  const technicianId = assignable.some((candidate) => candidate.id === values.technicianId)
    ? values.technicianId
    : "";
  const technician = assignable.find((candidate) => candidate.id === technicianId);

  const resolved = resolveSchedule(values, timeZone);
  const window = resolved.ok ? resolved.window : null;

  const day = dayRequest(values.date, technicianId, job.id, timeZone);
  const dayJobs = useJobsInWindow(windowQuery(day), 0);
  const exact =
    window === null || technicianId === ""
      ? null
      : { technicianId, start: window.start, end: window.end, excludeId: job.id };
  const conflicts = useJobsInWindow(windowQuery(exact), CONFLICT_CHECK_DEBOUNCE_MS);

  // Moving a visit states the change in words before it is saved: from where, to where, with whom.
  const move =
    rescheduling && window !== null && job.scheduledStart !== null && job.scheduledEnd !== null
      ? describeMove(
          {
            reference: job.reference,
            current: { start: job.scheduledStart, end: job.scheduledEnd },
            next: window,
            technicianChanged: technicianId !== "" && technicianId !== job.technicianId,
            technicianName: technician?.name,
          },
          timeZone,
        )
      : null;

  const edit = (patch: Partial<ScheduleFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const field of Object.keys(patch) as ScheduleField[]) {
        delete next[field];
      }
      return next;
    });
    setAlert(null);
    setRefused(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const submitted = { ...values, technicianId };
    const found = validateScheduleForm(submitted, timeZone, rescheduling);
    const ready = resolveSchedule(submitted, timeZone);
    if (Object.keys(found).length > 0 || !ready.ok) {
      setErrors(found);
      setAlert(null);
      focusAfterRef.current = firstWithMessage(found);
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setErrors({});
    setAlert(null);
    setRefused(false);
    try {
      const saved = await apiFetch<AdminWorkOrderDto>(
        `/admin/work-orders/${encodeURIComponent(job.id)}/schedule`,
        {
          method: "PATCH",
          body: toScheduleBody(ready.window, submitted, job.status, rescheduling),
        },
      );
      pendingRef.current = false;
      onScheduled(saved);
      return;
    } catch (caught) {
      if (isApiError(caught) && caught.code === ErrorCode.SCHEDULING_CONFLICT) {
        // The server's word: show the job it collided with, and leave every input as it was typed.
        setRefused(true);
        setAlert(caught.message);
      } else if (
        isApiError(caught) &&
        (caught.code === ErrorCode.STALE_STATE ||
          caught.code === ErrorCode.INVALID_STATE_TRANSITION ||
          caught.status === 404)
      ) {
        setAlert(STALE_MESSAGE);
        onStale();
      } else if (isApiError(caught) && caught.status === 422) {
        const mapped = mapServerFieldErrors(caught.fieldErrors);
        if (caught.code === ErrorCode.TECHNICIAN_INACTIVE) {
          technicians.retry();
        }
        if (Object.keys(mapped).length > 0) {
          setErrors(mapped);
          focusAfterRef.current = firstWithMessage(mapped);
        } else {
          setAlert(describeApiError(caught));
        }
      } else {
        setAlert(describeApiError(caught));
      }
    }
    pendingRef.current = false;
    setPending(false);
  };

  const zoneName =
    window === null ? null : formatTimeZoneName(window.start.toISOString(), timeZone);

  return (
    <DialogContent
      hideCloseButton={pending}
      onOpenAutoFocus={() => {
        returnFocusRef.current =
          returnFocusTo?.current ??
          (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      }}
    >
      <DialogHeader>
        <DialogTitle className="break-words">
          {rescheduling ? "Reschedule visit" : "Schedule visit"}
        </DialogTitle>
        <DialogDescription className="break-words">
          {job.reference} for {job.customerName}. The customer is told the new date and time when
          you save.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-secondary">
          Times in <span className="font-medium text-ink">{timeZone}</span>
          {zoneName === null ? null : <> ({zoneName})</>}, the business&apos;s clocks, whatever time
          zone this device is set to.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id={FIELD_IDS.date} label="Date" required error={errors.date}>
            {(control) => (
              <DateInput
                {...control}
                name="date"
                value={values.date}
                disabled={pending}
                onChange={(event) => edit({ date: event.target.value })}
              />
            )}
          </Field>
          <Field id={FIELD_IDS.startTime} label="Start time" required error={errors.startTime}>
            {(control) => (
              <TimeInput
                {...control}
                name="startTime"
                value={values.startTime}
                disabled={pending}
                onChange={(event) => edit({ startTime: event.target.value })}
              />
            )}
          </Field>
        </div>

        <Field
          id={FIELD_IDS.duration}
          label="How long"
          required
          error={errors.duration}
          description={
            window === null
              ? undefined
              : `Ends at ${formatTime(window.end.toISOString(), timeZone)}${
                  formatDate(window.end.toISOString(), timeZone) ===
                  formatDate(window.start.toISOString(), timeZone)
                    ? ""
                    : ` on ${formatDate(window.end.toISOString(), timeZone)}`
                }.`
          }
        >
          {(control) => (
            <Select
              {...control}
              name="duration"
              value={values.duration}
              disabled={pending}
              onChange={(event) => edit({ duration: event.target.value })}
            >
              {durationChoices(Number(values.duration)).map((minutes) => (
                <option key={minutes} value={String(minutes)}>
                  {formatDuration(minutes)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id={FIELD_IDS.technicianId} label="Technician" required error={errors.technicianId}>
          {(control) => (
            <Select
              {...control}
              name="technicianId"
              value={technicianId}
              disabled={pending || technicians.lookup.status !== "ready"}
              placeholder={
                technicians.lookup.status === "loading"
                  ? "Loading technicians…"
                  : "Choose a technician"
              }
              onChange={(event) => edit({ technicianId: event.target.value })}
            >
              {assignable.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {technicians.lookup.status === "error" ? (
          <FormAlert tone="error">
            <span className="flex flex-col items-start gap-2">
              {technicians.lookup.message}
              <Button type="button" variant="outline" size="sm" onClick={technicians.retry}>
                Try again
              </Button>
            </span>
          </FormAlert>
        ) : null}
        {technicians.lookup.status === "ready" && assignable.length === 0 ? (
          <FormAlert tone="info">
            There are no active technicians to give this job to. Add or reactivate one under
            Technicians first.
          </FormAlert>
        ) : null}

        {technician === undefined || values.date === "" ? null : (
          <section aria-label={`${technician.name}'s other jobs that day`} className="text-sm">
            <h3 className="font-medium text-ink">
              {technician.name}&apos;s other jobs on{" "}
              {formatDate(day === null ? values.date : day.start.toISOString(), timeZone)}
            </h3>
            <div aria-live="polite" className="mt-1 text-ink-secondary">
              {dayJobs.status === "loading" ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Checking their day…
                </span>
              ) : dayJobs.status === "error" ? (
                <span>{dayJobs.message}</span>
              ) : dayJobs.status === "ready" && dayJobs.value.length === 0 ? (
                <span>None. They are free all day.</span>
              ) : dayJobs.status === "ready" ? (
                <ul className="flex flex-col gap-1">
                  {dayJobs.value.map((other) => (
                    <li key={other.id} className="break-words">
                      {describeJobTime(other, timeZone)}{" "}
                      <span className="text-ink-muted">· {other.customerName}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        )}

        <div aria-live="polite" data-testid="conflict-check">
          {exact === null ? null : conflicts.status === "loading" ? (
            <p className="flex items-center gap-2 text-sm text-ink-secondary">
              <Spinner /> Checking that time…
            </p>
          ) : conflicts.status === "error" ? (
            <p className="text-sm text-ink-secondary">
              We couldn&apos;t check for conflicts just now. You can still save: the server checks
              again.
            </p>
          ) : conflicts.status === "ready" && conflicts.value.length > 0 ? (
            <p className="flex items-start gap-2 text-sm font-medium text-danger">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 break-words">
                {conflictSentence(conflicts.value, timeZone)} Choose another time or technician.
              </span>
            </p>
          ) : conflicts.status === "ready" ? (
            <p className="flex items-start gap-2 text-sm font-medium text-success">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 break-words">
                {technician?.name ?? "They"} is free at that time.
              </span>
            </p>
          ) : null}
        </div>

        {move === null ? null : (
          <p
            data-testid="move-summary"
            aria-live="polite"
            className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm font-medium text-ink [overflow-wrap:anywhere]"
          >
            {move}
          </p>
        )}

        {rescheduling ? (
          <Field
            id={FIELD_IDS.reason}
            label="Reason for moving it"
            required
            error={errors.reason}
            description="Only your team sees this. The customer is told the new time, not why."
          >
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                value={values.reason}
                disabled={pending}
                maxLength={SCHEDULE_RULES.rescheduleReasonMaxLength}
                showCount
                onChange={(event) => edit({ reason: event.target.value })}
              />
            )}
          </Field>
        ) : null}

        {alert === null ? null : (
          <FormAlert tone="error">
            <span className="flex flex-col gap-1">
              {/* The server's sentence names the job it collided with and when it is. */}
              <span>{alert}</span>
              {refused ? (
                <span className="font-normal">
                  Your entries are kept: change the time or the technician and save again.
                </span>
              ) : null}
            </span>
          </FormAlert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            loading={pending}
            loadingText={rescheduling ? "Rescheduling the visit…" : "Scheduling the visit…"}
          >
            {rescheduling ? "Reschedule visit" : "Schedule visit"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
