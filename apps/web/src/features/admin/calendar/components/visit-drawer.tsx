import { type CalendarItemDto, WorkOrderAction } from "@fixflow/shared";
import { CalendarClock, ExternalLink } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { adminJobPath } from "@/features/admin/lib/jobs";
import { TECHNICIAN_COLOR_STYLES } from "@/features/admin/lib/technician-colors";
import { formatTimeZoneName } from "@/lib/formatting/datetime";
import { cn } from "@/lib/utils";

import { longDateLabel } from "../lib/dates";
import { visitTimeRange } from "../lib/visit-text";
import { businessDateOf } from "../lib/visits";

export interface VisitDrawerProps {
  /** The visit to show. Kept after the drawer closes so its content does not vanish mid-animation. */
  visit: CalendarItemDto | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeZone: string;
  /** Start moving the visit: the parent closes the drawer and opens the scheduling dialog. */
  onReschedule: (visit: CalendarItemDto) => void;
  /** Where focus goes when the drawer closes (the parent decides: the block, or nowhere if a dialog opens). */
  onClosed: () => void;
}

/**
 * The job drawer (FR-052): opens when a block or card is activated, and says what the visit is,
 * where it stands, and what can be done to it. The actions are the server's word (`availableActions`,
 * D-43): "Reschedule" only for a visit that can be moved, and "Open the job" always, because the job
 * page has everything the drawer leaves out (the address, the customer's phone, the history).
 */
export function VisitDrawer({
  visit,
  open,
  onOpenChange,
  timeZone,
  onReschedule,
  onClosed,
}: VisitDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton
        className="w-full max-w-md overflow-y-auto p-5 sm:p-6"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        {visit === undefined ? (
          <SheetTitle className="sr-only">Visit</SheetTitle>
        ) : (
          <DrawerContent visit={visit} timeZone={timeZone} onReschedule={onReschedule} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerContent({
  visit,
  timeZone,
  onReschedule,
}: {
  visit: CalendarItemDto;
  timeZone: string;
  onReschedule: VisitDrawerProps["onReschedule"];
}) {
  const color =
    visit.technician === null ? null : TECHNICIAN_COLOR_STYLES[visit.technician.calendarColor];
  const canReschedule = visit.availableActions.includes(WorkOrderAction.RESCHEDULE);

  return (
    <>
      <SheetHeader className="pr-8">
        <SheetTitle className="break-words">{visit.reference}</SheetTitle>
        <SheetDescription className="break-words text-ink-secondary">
          {visit.serviceName} for {visit.customerName}
        </SheetDescription>
        <div className="pt-1">
          <StatusBadge kind="workOrder" status={visit.status} />
        </div>
      </SheetHeader>

      <DescriptionList>
        <DescriptionItem term="When">
          <span className="block font-medium">
            {longDateLabel(businessDateOf(visit.start, timeZone))}
          </span>
          <span className="block tabular-nums">
            {visitTimeRange(visit, timeZone)} {formatTimeZoneName(visit.start, timeZone)}
          </span>
        </DescriptionItem>
        <DescriptionItem term="Technician">
          {visit.technician === null ? (
            "No technician assigned"
          ) : (
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn("size-2.5 shrink-0 rounded-full", color?.dot)}
              />
              <span className="min-w-0">{visit.technician.name}</span>
            </span>
          )}
        </DescriptionItem>
        <DescriptionItem term="Customer">{visit.customerName}</DescriptionItem>
        <DescriptionItem term="Service">{visit.serviceName}</DescriptionItem>
        <DescriptionItem term="Area">{visit.city}</DescriptionItem>
      </DescriptionList>

      <div className="mt-auto flex flex-col gap-2 sm:flex-row-reverse">
        {canReschedule ? (
          <Button onClick={() => onReschedule(visit)}>
            <CalendarClock aria-hidden="true" />
            Reschedule
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href={adminJobPath(visit.id)}>
            Open the job
            <ExternalLink aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </>
  );
}
