import type { CustomerRequestListItemDto } from "@fixflow/shared";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";

import { requestPath } from "../lib/requests-list";

function columnsFor(timeZone: string): DataTableColumn<CustomerRequestListItemDto>[] {
  return [
    {
      id: "reference",
      header: "Reference",
      primary: true,
      cell: (request) => <ReferenceText reference={request.reference} />,
    },
    { id: "service", header: "Service", cell: (request) => request.serviceName },
    {
      id: "status",
      header: "Status",
      cell: (request) => <StatusBadge kind="request" status={request.status} />,
    },
    {
      id: "submittedAt",
      header: "Submitted",
      cell: (request) => (
        <DateTimeText value={request.submittedAt} timeZone={timeZone} display="date" />
      ),
    },
    {
      id: "nextStep",
      header: "What happens next",
      cell: (request) => <span className="text-ink-secondary">{request.nextStep}</span>,
    },
  ];
}

/**
 * The customer's requests as a table, or as cards on a phone: reference, service, status, when it
 * was sent and what happens next. The row opens the request by its id.
 */
export function RequestsTable({
  requests,
  timeZone,
}: {
  requests: readonly CustomerRequestListItemDto[];
  timeZone: string;
}) {
  return (
    <DataTable<CustomerRequestListItemDto>
      caption="Your service requests"
      rows={requests}
      getRowId={(request) => request.id}
      rowHref={(request) => requestPath(request.id)}
      columns={columnsFor(timeZone)}
    />
  );
}
