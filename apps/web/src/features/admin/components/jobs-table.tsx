import type { AdminWorkOrderListItemDto } from "@fixflow/shared";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";

import { adminJobPath } from "../lib/jobs";
import { JobScheduleText } from "./job-schedule-text";
import { TechnicianName } from "./technicians-table";

function columnsFor(timeZone: string): DataTableColumn<AdminWorkOrderListItemDto>[] {
  return [
    {
      id: "reference",
      header: "Job",
      primary: true,
      cell: (job) => <ReferenceText reference={job.reference} />,
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      cell: (job) => <StatusBadge kind="workOrder" status={job.status} />,
    },
    {
      id: "customer",
      header: "Customer",
      cell: (job) => (
        <span className="flex min-w-0 flex-col">
          <span className="[overflow-wrap:anywhere]">{job.customerName}</span>
          <span className="text-ink-secondary [overflow-wrap:anywhere]">{job.city}</span>
        </span>
      ),
    },
    {
      id: "service",
      header: "Service",
      cell: (job) => <span className="[overflow-wrap:anywhere]">{job.serviceName}</span>,
    },
    {
      id: "scheduledStart",
      header: "Scheduled",
      sortable: true,
      cell: (job) => (
        <JobScheduleText start={job.scheduledStart} end={job.scheduledEnd} timeZone={timeZone} />
      ),
    },
    {
      id: "technician",
      header: "Technician",
      cell: (job) =>
        job.technician === null ? (
          <span className="text-ink-secondary">Unassigned</span>
        ) : (
          <TechnicianName name={job.technician.name} color={job.technician.calendarColor} />
        ),
    },
    {
      id: "createdAt",
      header: "Created",
      sortable: true,
      cell: (job) => <DateTimeText value={job.createdAt} timeZone={timeZone} display="date" />,
    },
  ];
}

export interface JobsTableProps {
  jobs: readonly AdminWorkOrderListItemDto[];
  timeZone: string;
  sort: { field: string; order: "asc" | "desc" };
  /** The link a sortable column header goes to. */
  getSortHref: (field: string) => string;
}

/**
 * The jobs as a table, or as cards below 1024 px where seven columns do not fit. The reference is
 * the link to the job. Times are shown in the business's time zone, from its settings.
 */
export function JobsTable({ jobs, timeZone, sort, getSortHref }: JobsTableProps) {
  return (
    <DataTable<AdminWorkOrderListItemDto>
      caption="Jobs"
      rows={jobs}
      getRowId={(job) => job.id}
      rowHref={(job) => adminJobPath(job.id)}
      sort={sort}
      getSortHref={getSortHref}
      columns={columnsFor(timeZone)}
      breakpoint="lg"
    />
  );
}
