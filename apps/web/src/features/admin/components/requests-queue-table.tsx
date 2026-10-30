import { type AdminRequestListItemDto, PREFERRED_WINDOWS } from "@fixflow/shared";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";

import { adminRequestPath } from "../lib/requests-queue";

function columnsFor(timeZone: string): DataTableColumn<AdminRequestListItemDto>[] {
  return [
    {
      id: "reference",
      header: "Reference",
      primary: true,
      sortable: true,
      cell: (request) => (
        <span className="flex flex-wrap items-center gap-2">
          <ReferenceText reference={request.reference} />
          {request.isNew ? <Badge tone="brand">New</Badge> : null}
        </span>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      cell: (request) => (
        <span className="flex min-w-0 flex-col">
          <span className="break-words">{request.customerName}</span>
          <span className="break-words text-xs text-ink-secondary">{request.city}</span>
        </span>
      ),
    },
    { id: "service", header: "Service", cell: (request) => request.serviceName },
    {
      id: "status",
      header: "Status",
      sortable: true,
      cell: (request) => <StatusBadge kind="request" status={request.status} />,
    },
    {
      id: "preferred",
      header: "Preferred time",
      cell: (request) => (
        <span className="flex flex-col">
          <DateTimeText value={request.preferredDate} timeZone={timeZone} />
          <span className="text-xs text-ink-secondary">
            {PREFERRED_WINDOWS[request.preferredWindow].label}
          </span>
        </span>
      ),
    },
    {
      id: "submittedAt",
      header: "Submitted",
      sortable: true,
      cell: (request) => (
        <DateTimeText value={request.submittedAt} timeZone={timeZone} display="date" />
      ),
    },
    {
      id: "updatedAt",
      header: "Updated",
      sortable: true,
      cell: (request) => (
        <DateTimeText value={request.updatedAt} timeZone={timeZone} display="date" />
      ),
    },
  ];
}

export interface RequestsQueueTableProps {
  requests: readonly AdminRequestListItemDto[];
  timeZone: string;
  sort: { field: string; order: "asc" | "desc" };
  /** The link a sortable column header goes to. */
  getSortHref: (field: string) => string;
}

/**
 * The queue as a table, or as cards below 1024 px where seven columns do not fit. The reference is
 * the link to the request; a request waiting for its first look carries a "New" marker beside it
 * as well as its "Submitted" status, so it stands out when the list is scanned.
 */
export function RequestsQueueTable({
  requests,
  timeZone,
  sort,
  getSortHref,
}: RequestsQueueTableProps) {
  return (
    <DataTable<AdminRequestListItemDto>
      caption="Service requests"
      rows={requests}
      getRowId={(request) => request.id}
      rowHref={(request) => adminRequestPath(request.id)}
      sort={sort}
      getSortHref={getSortHref}
      columns={columnsFor(timeZone)}
      breakpoint="lg"
    />
  );
}
