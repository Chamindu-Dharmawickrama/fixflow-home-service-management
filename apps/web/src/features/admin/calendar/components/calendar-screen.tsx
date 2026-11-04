"use client";

import {
  type AdminWorkOrderDto,
  type CalendarDto,
  type CalendarItemDto,
  type CalendarWaitingJobDto,
} from "@fixflow/shared";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { toast } from "@/components/ui/sonner";
import {
  ScheduleDialog,
  type ScheduleDialogJob,
} from "@/features/admin/components/schedule-dialog";
import { describeSlot } from "@/features/admin/lib/schedule-form";

import { calendarHref, type CalendarQuery } from "../lib/calendar-url";
import { weekDays } from "../lib/dates";
import { useBusinessNow, useViewForWidth } from "../lib/use-calendar-clock";
import { businessDateOf, type LegendTechnician, legendTechnicians } from "../lib/visits";
import { AgendaView } from "./agenda-view";
import { CalendarLegend } from "./calendar-legend";
import { CalendarEmpty, CalendarSkeleton, TruncatedNotice } from "./calendar-states";
import { CalendarToolbar } from "./calendar-toolbar";
import { DayView } from "./day-view";
import { NeedsSchedulingPanel } from "./needs-scheduling-panel";
import { VisitDrawer } from "./visit-drawer";
import { WeekView } from "./week-view";

export interface CalendarScreenProps {
  data: CalendarDto;
  /** Every technician, whatever their state: the filter and the legend choose from them. */
  technicians: readonly LegendTechnician[];
  /** What the address says. */
  query: CalendarQuery;
  /** Today on the business's calendar, from the server. */
  today: string;
}

/** What the scheduling dialog is open for: moving a booked visit, or giving a waiting job its first time. */
type ScheduleTarget =
  { kind: "visit"; job: ScheduleDialogJob } | { kind: "waiting"; job: ScheduleDialogJob };

/**
 * The scheduling calendar (IA-A06, FR-052, FR-053). The server sends one week of visits and the jobs
 * waiting for a time; this draws them as a week, a day or an agenda (the address chooses, or the width
 * of the window when it does not), opens a drawer for a visit, and reschedules with the same dialog
 * the job page uses, so the conflict check, the reason and the server's refusal behave identically.
 * After the server accepts a change the page is refreshed (one request) and focus returns to the
 * visit, so a keyboard user is never left on a control that has gone.
 */
export function CalendarScreen({ data, technicians, query, today }: CalendarScreenProps) {
  const router = useRouter();
  const ids = useId();
  const headingId = `${ids}-range`;
  const titleId = `${ids}-title`;
  const { timeZone } = data;

  const viewForWidth = useViewForWidth();
  const view = query.view ?? viewForWidth;
  const now = useBusinessNow(timeZone);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [schedule, setSchedule] = useState<{ open: boolean; target: ScheduleTarget | null }>({
    open: false,
    target: null,
  });

  const triggerRef = useRef<HTMLElement | null>(null);
  const panelButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterRefresh = useRef<string | null>(null);

  const selected = data.items.find((item) => item.id === selectedId);
  // A visit that has left the week (it was moved) closes its own drawer.
  const showDrawer = drawerOpen && selected !== undefined;

  // After the server accepts a change and the page is refreshed, focus goes to the visit that was
  // changed, wherever it now is; if it has left this week, to the calendar's own heading.
  useEffect(() => {
    const id = focusAfterRefresh.current;
    if (id === null) return;
    focusAfterRefresh.current = null;
    const block = document.querySelector<HTMLElement>(`[data-visit-id="${CSS.escape(id)}"]`);
    (block ?? document.getElementById(headingId))?.focus({ preventScroll: true });
  }, [data, headingId]);

  const openVisit = (visit: CalendarItemDto, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setSelectedId(visit.id);
    setDrawerOpen(true);
  };

  const startReschedule = (visit: CalendarItemDto) => {
    setDrawerOpen(false);
    setSchedule({
      open: true,
      target: {
        kind: "visit",
        job: {
          id: visit.id,
          reference: visit.reference,
          status: visit.status,
          scheduledStart: visit.start,
          scheduledEnd: visit.end,
          technicianId: visit.technician?.id ?? null,
          customerName: visit.customerName,
        },
      },
    });
  };

  const startSchedule = (job: CalendarWaitingJobDto) => {
    setPanelOpen(false);
    setSchedule({
      open: true,
      target: {
        kind: "waiting",
        job: {
          id: job.id,
          reference: job.reference,
          status: job.status,
          scheduledStart: job.scheduledStart,
          scheduledEnd: job.scheduledEnd,
          technicianId: job.technician?.id ?? null,
          customerName: job.customerName,
        },
      },
    });
  };

  const scheduled = (job: AdminWorkOrderDto) => {
    const moved = schedule.target?.kind === "visit";
    setSchedule((current) => ({ ...current, open: false }));
    focusAfterRefresh.current = job.id;
    if (job.scheduledStart !== null && job.scheduledEnd !== null) {
      const newDate = businessDateOf(job.scheduledStart, timeZone);
      const offScreen = !weekDays(query.date).includes(newDate);
      toast.success(moved ? `${job.reference} moved` : `${job.reference} scheduled`, {
        description: `${describeSlot(job.scheduledStart, job.scheduledEnd, timeZone)}${
          job.technician === null ? "" : ` with ${job.technician.name}`
        }.`,
        ...(offScreen && {
          action: {
            label: "Show that week",
            onClick: () => router.push(calendarHref({ ...query, date: newDate })),
          },
        }),
      });
    }
    router.refresh();
  };

  const filtered = query.technicianId !== null;
  const empty = data.items.length === 0;

  return (
    <section
      aria-labelledby={`${titleId} ${headingId}`}
      data-testid="calendar"
      className="flex flex-col gap-4"
    >
      <span id={titleId} className="sr-only">
        Calendar
      </span>
      <CalendarToolbar
        query={query}
        view={view}
        technicians={technicians}
        headingId={headingId}
        needsSchedulingTotal={data.needsSchedulingTotal}
        panelButtonRef={panelButtonRef}
        onOpenPanel={() => setPanelOpen(true)}
      />
      <CalendarLegend technicians={legendTechnicians(technicians, data.items)} items={data.items} />
      {data.truncated ? <TruncatedNotice /> : null}

      {view === null ? (
        <CalendarSkeleton label="Choosing the view for this window" />
      ) : empty ? (
        <CalendarEmpty
          view={view}
          date={query.date}
          today={today}
          needsSchedulingTotal={data.needsSchedulingTotal}
          filtered={filtered}
        />
      ) : view === "week" ? (
        <WeekView
          items={data.items}
          date={query.date}
          today={today}
          timeZone={timeZone}
          now={now}
          onOpen={openVisit}
        />
      ) : view === "day" ? (
        <DayView
          items={data.items}
          date={query.date}
          today={today}
          timeZone={timeZone}
          now={now}
          split={query.split && !filtered}
          onOpen={openVisit}
        />
      ) : (
        <AgendaView items={data.items} today={today} timeZone={timeZone} onOpen={openVisit} />
      )}

      <VisitDrawer
        visit={selected}
        open={showDrawer}
        onOpenChange={setDrawerOpen}
        timeZone={timeZone}
        onReschedule={startReschedule}
        onClosed={() => {
          // The dialog that opens from the drawer takes focus itself; otherwise it goes back to the visit.
          if (!schedule.open) triggerRef.current?.focus({ preventScroll: true });
        }}
      />

      <NeedsSchedulingPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        jobs={data.needsScheduling}
        total={data.needsSchedulingTotal}
        timeZone={timeZone}
        onSchedule={startSchedule}
        onClosed={() => {
          if (!schedule.open) panelButtonRef.current?.focus({ preventScroll: true });
        }}
      />

      {schedule.target === null ? null : (
        <ScheduleDialog
          open={schedule.open}
          onOpenChange={(open) => setSchedule((current) => ({ ...current, open }))}
          job={schedule.target.job}
          rescheduling={schedule.target.kind === "visit"}
          timeZone={timeZone}
          returnFocusTo={schedule.target.kind === "visit" ? triggerRef : panelButtonRef}
          onScheduled={scheduled}
          onStale={() => router.refresh()}
        />
      )}
    </section>
  );
}
