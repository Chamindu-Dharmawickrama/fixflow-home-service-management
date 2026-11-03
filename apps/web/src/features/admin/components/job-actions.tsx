"use client";

import { type AdminWorkOrderDto, WorkOrderAction } from "@fixflow/shared";
import { CalendarClock, CalendarPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

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

/**
 * The buttons on a job's page (D-43): the one that gives it a time, which the server names in
 * `availableActions` (`SCHEDULE` for a job with no appointment, `RESCHEDULE` for one that has it).
 * The actions T18 adds (start, complete, cancel) are listed by the server already, and get their
 * controls with that task; nothing is drawn for them here, so there is no button that does nothing.
 */
export function JobActions({ job, timeZone, openSchedule }: JobActionsProps) {
  const router = useRouter();
  const canReschedule = job.availableActions.includes(WorkOrderAction.RESCHEDULE);
  const canSchedule = canReschedule || job.availableActions.includes(WorkOrderAction.SCHEDULE);
  const [open, setOpen] = useState(openSchedule && canSchedule);
  const button = useRef<HTMLButtonElement>(null);

  if (!canSchedule) {
    return null;
  }

  const close = (next: boolean) => {
    setOpen(next);
    // The address that opened the dialog is not the page's address any more.
    if (!next && openSchedule) {
      router.replace(adminJobPath(job.id), { scroll: false });
    }
  };

  const Icon = canReschedule ? CalendarClock : CalendarPlus;
  return (
    <>
      <Button ref={button} onClick={() => setOpen(true)}>
        <Icon aria-hidden="true" />
        {canReschedule ? "Reschedule" : "Schedule"}
      </Button>

      <ScheduleDialog
        open={open}
        onOpenChange={close}
        rescheduling={canReschedule}
        timeZone={timeZone}
        returnFocusTo={button}
        job={{
          id: job.id,
          reference: job.reference,
          status: job.status,
          scheduledStart: job.scheduledStart,
          scheduledEnd: job.scheduledEnd,
          technicianId: job.technician?.id ?? null,
          customerName: job.customer.name,
        }}
        onScheduled={(saved) => {
          close(false);
          toast.success(
            canReschedule
              ? `${saved.reference} was rescheduled`
              : `${saved.reference} is scheduled`,
            {
              description: `${job.customer.name} is told the date and time by notification and email.`,
            },
          );
          router.refresh();
        }}
        onStale={() => router.refresh()}
      />
    </>
  );
}
