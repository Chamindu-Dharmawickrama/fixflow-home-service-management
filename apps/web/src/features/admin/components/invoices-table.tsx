import { type AdminInvoiceListItemDto, InvoiceStatus } from "@fixflow/shared";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { MoneyText } from "@/components/ui/money-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";

import { adminInvoicePath, overdueSentence } from "../lib/invoices";

function columnsFor(timeZone: string): DataTableColumn<AdminInvoiceListItemDto>[] {
  return [
    {
      id: "invoiceNumber",
      header: "Invoice",
      primary: true,
      // A draft has no number yet (D-17), so the row says what it is instead of showing a blank.
      cell: (invoice) =>
        invoice.invoiceNumber === null ? (
          <span className="text-ink-secondary">Draft</span>
        ) : (
          <ReferenceText reference={invoice.invoiceNumber} />
        ),
    },
    {
      id: "customer",
      header: "Customer",
      cell: (invoice) => <span className="[overflow-wrap:anywhere]">{invoice.customerName}</span>,
    },
    {
      id: "job",
      header: "Job",
      cell: (invoice) => <ReferenceText reference={invoice.jobReference} />,
    },
    {
      id: "issueDate",
      header: "Issued",
      sortable: true,
      cell: (invoice) =>
        invoice.issueDate === null ? (
          <span className="text-ink-secondary">Not issued</span>
        ) : (
          <DateTimeText value={invoice.issueDate} timeZone={timeZone} display="date" />
        ),
    },
    {
      id: "dueDate",
      header: "Due",
      sortable: true,
      cell: (invoice) =>
        invoice.dueDate === null ? (
          <span className="text-ink-secondary">No due date</span>
        ) : (
          <DateTimeText value={invoice.dueDate} timeZone={timeZone} display="date" />
        ),
    },
    {
      id: "totalAmount",
      header: "Total",
      sortable: true,
      align: "right",
      cell: (invoice) => (
        <MoneyText amount={invoice.totalAmount} currencyCode={invoice.currencyCode} />
      ),
    },
    {
      id: "balance",
      header: "Balance",
      align: "right",
      cell: (invoice) =>
        // A draft or a voided invoice owes nothing yet or any more; a dash is clearer than 0.00.
        invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.VOID ? (
          <span className="text-ink-secondary" aria-label="Not applicable">
            –
          </span>
        ) : (
          <MoneyText amount={invoice.balanceDue} currencyCode={invoice.currencyCode} />
        ),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      cell: (invoice) => (
        <span className="flex min-w-0 flex-col items-start gap-1">
          <StatusBadge kind="invoice" status={invoice.status} />
          {invoice.status === InvoiceStatus.OVERDUE ? (
            <span className="text-xs font-medium text-danger">
              {overdueSentence(invoice.daysOverdue)}
            </span>
          ) : null}
        </span>
      ),
    },
  ];
}

export interface InvoicesTableProps {
  invoices: readonly AdminInvoiceListItemDto[];
  timeZone: string;
  sort: { field: string; order: "asc" | "desc" };
  /** The link a sortable column header goes to. */
  getSortHref: (field: string) => string;
}

/**
 * The invoices as a table, or as cards below 1024 px where eight columns do not fit. The number is
 * the link to the invoice. Dates are days on the business's calendar and amounts are the server's
 * decimal strings, shown with the invoice's own currency.
 */
export function InvoicesTable({ invoices, timeZone, sort, getSortHref }: InvoicesTableProps) {
  return (
    <DataTable<AdminInvoiceListItemDto>
      caption="Invoices"
      rows={invoices}
      getRowId={(invoice) => invoice.id}
      rowHref={(invoice) => adminInvoicePath(invoice.id)}
      sort={sort}
      getSortHref={getSortHref}
      columns={columnsFor(timeZone)}
      breakpoint="lg"
    />
  );
}
