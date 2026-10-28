import { ServiceRequestStatus } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterBarField } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { MoneyText } from "@/components/ui/money-text";
import { Pagination } from "@/components/ui/pagination";
import { ReferenceText } from "@/components/ui/reference-text";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { statusLabel } from "@/lib/formatting/status";
import { buildHref, type SearchParamsInput } from "@/lib/url";

import {
  BUSINESS_TIME_ZONE,
  CURRENCY_CODE,
  isRequestSortField,
  queryRequests,
  type RequestRow,
} from "../_lib/fixtures";

const PAGE_SIZE = 8;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatus(value: string | undefined): ServiceRequestStatus | undefined {
  return Object.values(ServiceRequestStatus).find((status) => status === value);
}

export interface RequestQueueProps {
  /** The page this queue is on; filters, sort and page live in its query string. */
  basePath: string;
  searchParams: SearchParamsInput;
  /** Where a row leads. */
  rowHref: string;
}

/**
 * The request-queue pattern (admin screen blueprint): search and status filters in the URL, a
 * sortable table that becomes cards on phones, URL-driven pagination, and an empty state with a
 * way out when the filters match nothing. The data is fictional; the markup is the pattern.
 */
export function RequestQueue({ basePath, searchParams, rowHref }: RequestQueueProps) {
  const requestedSort = first(searchParams.sort);
  const sort = isRequestSortField(requestedSort) ? requestedSort : "submittedAt";
  const order = first(searchParams.order) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(first(searchParams.page) ?? "1", 10) || 1);
  const status = parseStatus(first(searchParams.status));
  const search = first(searchParams.q)?.trim() || undefined;

  const { rows, totalItems } = queryRequests({
    sort,
    order,
    page,
    pageSize: PAGE_SIZE,
    status,
    search,
  });

  const columns: DataTableColumn<RequestRow>[] = [
    {
      id: "reference",
      header: "Reference",
      primary: true,
      sortable: true,
      cell: (row) => <ReferenceText reference={row.reference} />,
    },
    { id: "customer", header: "Customer", sortable: true, cell: (row) => row.customer },
    { id: "service", header: "Service", cell: (row) => row.service },
    {
      id: "status",
      header: "Status",
      sortable: true,
      cell: (row) => <StatusBadge kind="request" status={row.status} />,
    },
    {
      id: "submittedAt",
      header: "Submitted",
      sortable: true,
      cell: (row) => <DateTimeText value={row.submittedAt} timeZone={BUSINESS_TIME_ZONE} />,
    },
    {
      id: "quoted",
      header: "Quoted",
      sortable: true,
      align: "right",
      cell: (row) =>
        row.quoted ? (
          <MoneyText amount={row.quoted} currencyCode={CURRENCY_CODE} />
        ) : (
          <span className="text-ink-muted">Not quoted</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        action={basePath}
        label="Filter requests"
        preserve={{ sort: requestedSort, order: first(searchParams.order) }}
        hasActiveFilters={Boolean(status ?? search)}
      >
        <FilterBarField id="queue-search" label="Search" grow>
          <Input
            id="queue-search"
            name="q"
            type="search"
            placeholder="Name, reference or service"
            defaultValue={search}
          />
        </FilterBarField>
        <FilterBarField id="queue-status" label="Status">
          <Select id="queue-status" name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {Object.values(ServiceRequestStatus).map((value) => (
              <option key={value} value={value}>
                {statusLabel("request", value)}
              </option>
            ))}
          </Select>
        </FilterBarField>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No requests match these filters"
          description="Try a different search term or status, or clear the filters to see every request."
          action={
            <Button variant="outline" asChild>
              <Link href={basePath}>Clear filters</Link>
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            caption="Service requests"
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            rowHref={() => rowHref}
            sort={{ field: sort, order }}
            getSortHref={(field) =>
              buildHref(basePath, searchParams, {
                sort: field,
                order: sort === field && order === "asc" ? "desc" : "asc",
                page: null,
              })
            }
            breakpoint="md"
          />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={totalItems}
            basePath={basePath}
            searchParams={searchParams}
            itemLabel="requests"
          />
        </>
      )}
    </div>
  );
}
