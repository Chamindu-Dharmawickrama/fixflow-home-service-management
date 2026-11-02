import { type AdminTechnicianListItemDto, technicianState } from "@fixflow/shared";
import { Mail, Phone } from "lucide-react";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

import { TECHNICIAN_COLOR_STYLES } from "../lib/technician-colors";
import { adminTechnicianPath } from "../lib/technicians";
import { SpecialtyTags } from "./specialty-tags";

/** A technician's name with the colour of their jobs beside it. The dot is decoration: the name says who. */
export function TechnicianName({
  name,
  color,
  className,
}: {
  name: string;
  color: AdminTechnicianListItemDto["calendarColor"];
  className?: string | undefined;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className={cn("size-3 shrink-0 rounded-full", TECHNICIAN_COLOR_STYLES[color].dot)}
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
    </span>
  );
}

function columnsFor(timeZone: string): DataTableColumn<AdminTechnicianListItemDto>[] {
  return [
    {
      id: "name",
      header: "Technician",
      primary: true,
      sortable: true,
      cell: (technician) => (
        <TechnicianName name={technician.name} color={technician.calendarColor} />
      ),
    },
    {
      id: "specialties",
      header: "Specialties",
      cell: (technician) =>
        technician.specialties.length === 0 ? (
          <span className="text-ink-secondary">None added</span>
        ) : (
          <SpecialtyTags tags={technician.specialties} label="Specialties" />
        ),
    },
    {
      id: "contact",
      header: "Contact",
      cell: (technician) =>
        technician.email === null && technician.phone === null ? (
          <span className="text-ink-secondary">No contact details</span>
        ) : (
          <span className="flex min-w-0 flex-col gap-1">
            {technician.email === null ? null : (
              <span className="flex items-center gap-1.5 break-all">
                <Mail aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
                <span>
                  <span className="sr-only">Email:</span> {technician.email}
                </span>
              </span>
            )}
            {technician.phone === null ? null : (
              <span className="flex items-center gap-1.5">
                <Phone aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
                <span>
                  <span className="sr-only">Phone:</span> {technician.phone}
                </span>
              </span>
            )}
          </span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (technician) => <StatusBadge kind="technician" status={technicianState(technician)} />,
    },
    {
      id: "upcomingJobCount",
      header: "Upcoming jobs",
      align: "right",
      cell: (technician) => technician.upcomingJobCount,
    },
    {
      id: "nextJob",
      header: "Next job",
      cell: (technician) =>
        technician.nextJob === null ? (
          <span className="text-ink-secondary">None scheduled</span>
        ) : (
          <span className="flex flex-col">
            <DateTimeText
              value={technician.nextJob.scheduledStart}
              timeZone={timeZone}
              display="dateTime"
            />
            <ReferenceText
              reference={technician.nextJob.reference}
              className="text-xs font-normal text-ink-secondary"
            />
          </span>
        ),
    },
  ];
}

export interface TechniciansTableProps {
  technicians: readonly AdminTechnicianListItemDto[];
  timeZone: string;
  sort: { field: string; order: "asc" | "desc" };
  /** The link the "Technician" column header goes to. */
  getSortHref: (field: string) => string;
}

/**
 * The technicians as a table, or as cards below 1024 px where six columns do not fit. The name is
 * the link to the technician's page. Times are shown in the business's time zone, from its settings.
 */
export function TechniciansTable({
  technicians,
  timeZone,
  sort,
  getSortHref,
}: TechniciansTableProps) {
  return (
    <DataTable<AdminTechnicianListItemDto>
      caption="Technicians"
      rows={technicians}
      getRowId={(technician) => technician.id}
      rowHref={(technician) => adminTechnicianPath(technician.id)}
      sort={sort}
      getSortHref={getSortHref}
      columns={columnsFor(timeZone)}
      breakpoint="lg"
    />
  );
}
