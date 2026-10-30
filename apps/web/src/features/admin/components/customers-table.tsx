import type { AdminCustomerListItemDto } from "@fixflow/shared";
import { Mail, Phone } from "lucide-react";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { MoneyText } from "@/components/ui/money-text";
import { cn } from "@/lib/utils";

import { adminCustomerPath, isZeroAmount } from "../lib/customers";

/** Money owed is the figure a scan of the list is looking for, so a balance of zero is quiet. */
function Balance({ customer }: { customer: AdminCustomerListItemDto }) {
  const owes = !isZeroAmount(customer.outstandingBalance);
  return (
    <MoneyText
      amount={customer.outstandingBalance}
      currencyCode={customer.currencyCode}
      className={cn(owes ? "font-semibold text-ink" : "text-ink-secondary")}
    />
  );
}

function columnsFor(timeZone: string): DataTableColumn<AdminCustomerListItemDto>[] {
  return [
    {
      id: "name",
      header: "Customer",
      primary: true,
      sortable: true,
      cell: (customer) => <span className="break-words">{customer.name}</span>,
    },
    {
      id: "contact",
      header: "Contact",
      cell: (customer) => (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1.5 break-all">
            <Mail aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
            <span>
              <span className="sr-only">Email:</span> {customer.email}
            </span>
          </span>
          {customer.phone ? (
            <span className="flex items-center gap-1.5">
              <Phone aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
              <span>
                <span className="sr-only">Phone:</span> {customer.phone}
              </span>
            </span>
          ) : (
            <span className="text-xs text-ink-secondary">No phone number</span>
          )}
        </span>
      ),
    },
    {
      id: "city",
      header: "City",
      cell: (customer) =>
        customer.city === null ? (
          <span className="text-ink-secondary">No address saved</span>
        ) : (
          <span className="break-words">{customer.city}</span>
        ),
    },
    {
      id: "requestCount",
      header: "Requests",
      align: "right",
      cell: (customer) => customer.requestCount,
    },
    {
      id: "openJobCount",
      header: "Open jobs",
      align: "right",
      cell: (customer) => customer.openJobCount,
    },
    {
      id: "outstandingBalance",
      header: "Outstanding",
      align: "right",
      cell: (customer) => <Balance customer={customer} />,
    },
    {
      id: "lastActivityAt",
      header: "Last activity",
      sortable: true,
      cell: (customer) => (
        <DateTimeText value={customer.lastActivityAt} timeZone={timeZone} display="date" />
      ),
    },
  ];
}

export interface CustomersTableProps {
  customers: readonly AdminCustomerListItemDto[];
  timeZone: string;
  sort: { field: string; order: "asc" | "desc" };
  /** The link a sortable column header goes to. */
  getSortHref: (field: string) => string;
}

/**
 * The directory as a table, or as cards below 1024 px where seven columns do not fit. The name is
 * the link to the customer's page. When the customer signed up is not a column (it would squeeze
 * the contact details): the "Sort by" control sorts by it, and their own page shows the date. The outstanding balance is shown with its currency code, from
 * the business's settings, never inferred from the browser.
 */
export function CustomersTable({ customers, timeZone, sort, getSortHref }: CustomersTableProps) {
  return (
    <DataTable<AdminCustomerListItemDto>
      caption="Customers"
      rows={customers}
      getRowId={(customer) => customer.id}
      rowHref={(customer) => adminCustomerPath(customer.id)}
      sort={sort}
      getSortHref={getSortHref}
      columns={columnsFor(timeZone)}
      breakpoint="lg"
    />
  );
}
