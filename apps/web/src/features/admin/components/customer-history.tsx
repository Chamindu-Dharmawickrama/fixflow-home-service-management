import {
  type AdminCustomerSummaryDto,
  type CustomerHistoryInvoiceDto,
  type CustomerHistoryJobDto,
  type CustomerHistoryQuotationDto,
  type CustomerHistoryRequestDto,
  type CustomerHistoryResponse,
  type CustomerHistoryType,
  PREFERRED_WINDOWS,
} from "@fixflow/shared";
import { Briefcase, FileText, Inbox, type LucideIcon, Receipt } from "lucide-react";
import Link from "next/link";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { MoneyText } from "@/components/ui/money-text";
import { Pagination } from "@/components/ui/pagination";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SearchParamsInput } from "@/lib/url";

import { adminCustomerPath, RECORD_PATHS, tabHref } from "../lib/customers";
import { adminRequestPath } from "../lib/requests-queue";

/** One page of one kind of record, tied to the kind so each table knows its rows. */
export type CustomerHistoryPage = {
  [Type in CustomerHistoryType]: { tab: Type; response: CustomerHistoryResponse<Type> };
}[CustomerHistoryType];

const TAB_LABELS: Record<CustomerHistoryType, string> = {
  requests: "Requests",
  quotations: "Quotations",
  jobs: "Jobs",
  invoices: "Invoices",
};

const EMPTY: Record<
  CustomerHistoryType,
  { icon: LucideIcon; title: string; description: (name: string) => string }
> = {
  requests: {
    icon: Inbox,
    title: "No requests yet",
    description: (name) => `${name} hasn't sent a service request. When they do, it appears here.`,
  },
  quotations: {
    icon: FileText,
    title: "No quotations yet",
    description: (name) => `The quotations you prepare for ${name} appear here, with their status.`,
  },
  jobs: {
    icon: Briefcase,
    title: "No jobs yet",
    description: (name) => `A job starts when ${name} accepts a quotation, and appears here.`,
  },
  invoices: {
    icon: Receipt,
    title: "No invoices yet",
    description: (name) => `The invoices for ${name}'s completed jobs appear here.`,
  },
};

const PAGE_LABELS: Record<CustomerHistoryType, string> = {
  requests: "requests",
  quotations: "quotations",
  jobs: "jobs",
  invoices: "invoices",
};

/** How many records each tab holds, from the summary. */
function countOf(summary: AdminCustomerSummaryDto, tab: CustomerHistoryType): number {
  switch (tab) {
    case "requests":
      return summary.requestCount;
    case "quotations":
      return summary.quotationCount;
    case "jobs":
      return summary.jobCount;
    case "invoices":
      return summary.invoiceCount;
  }
}

/**
 * The request a record belongs to, as a link. A row whose record has a page of its own (a quotation
 * since T14) is one big link, stretched over the whole row; `relative z-10` keeps this second link
 * above that layer, so a mouse can still reach it.
 */
function RequestLink({ request }: { request: { id: string; reference: string } }) {
  return (
    <Link
      href={adminRequestPath(request.id)}
      className="relative z-10 font-medium text-brand underline-offset-4 hover:underline"
    >
      <ReferenceText reference={request.reference} />
    </Link>
  );
}

const NOTHING = <span className="text-ink-secondary">—</span>;

function requestColumns(timeZone: string): DataTableColumn<CustomerHistoryRequestDto>[] {
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
      cell: (request) => (
        <DateTimeText value={request.submittedAt} timeZone={timeZone} display="date" />
      ),
    },
  ];
}

function quotationColumns(timeZone: string): DataTableColumn<CustomerHistoryQuotationDto>[] {
  return [
    {
      id: "reference",
      header: "Quotation",
      primary: true,
      cell: (quotation) => <ReferenceText reference={quotation.reference} />,
    },
    {
      id: "request",
      header: "Request",
      cell: (quotation) => <RequestLink request={quotation.request} />,
    },
    {
      id: "status",
      header: "Status",
      cell: (quotation) => <StatusBadge kind="quotation" status={quotation.status} />,
    },
    {
      id: "total",
      header: "Total",
      align: "right",
      cell: (quotation) => (
        <MoneyText amount={quotation.totalAmount} currencyCode={quotation.currencyCode} />
      ),
    },
    {
      id: "validUntil",
      header: "Valid until",
      cell: (quotation) => <DateTimeText value={quotation.validUntil} timeZone={timeZone} />,
    },
    {
      id: "sentAt",
      header: "Sent",
      cell: (quotation) =>
        quotation.sentAt === null ? (
          <span className="text-ink-secondary">Not sent</span>
        ) : (
          <DateTimeText value={quotation.sentAt} timeZone={timeZone} display="date" />
        ),
    },
  ];
}

function jobColumns(timeZone: string): DataTableColumn<CustomerHistoryJobDto>[] {
  return [
    {
      id: "reference",
      header: "Job",
      primary: true,
      cell: (job) => <ReferenceText reference={job.reference} />,
    },
    { id: "request", header: "Request", cell: (job) => <RequestLink request={job.request} /> },
    { id: "service", header: "Service", cell: (job) => job.serviceName },
    {
      id: "status",
      header: "Status",
      cell: (job) => <StatusBadge kind="workOrder" status={job.status} />,
    },
    {
      id: "scheduledStart",
      header: "Scheduled",
      cell: (job) =>
        job.scheduledStart === null ? (
          <span className="text-ink-secondary">Not scheduled yet</span>
        ) : (
          <DateTimeText value={job.scheduledStart} timeZone={timeZone} />
        ),
    },
    {
      id: "completedAt",
      header: "Completed",
      cell: (job) =>
        job.completedAt === null ? (
          NOTHING
        ) : (
          <DateTimeText value={job.completedAt} timeZone={timeZone} display="date" />
        ),
    },
  ];
}

function invoiceColumns(timeZone: string): DataTableColumn<CustomerHistoryInvoiceDto>[] {
  return [
    {
      id: "number",
      header: "Invoice",
      primary: true,
      cell: (invoice) =>
        invoice.invoiceNumber === null ? (
          <span className="text-ink-secondary">Draft</span>
        ) : (
          <ReferenceText reference={invoice.invoiceNumber} />
        ),
    },
    {
      id: "request",
      header: "Request",
      cell: (invoice) => <RequestLink request={invoice.request} />,
    },
    {
      id: "status",
      header: "Status",
      cell: (invoice) => <StatusBadge kind="invoice" status={invoice.status} />,
    },
    {
      id: "total",
      header: "Total",
      align: "right",
      cell: (invoice) => (
        <MoneyText amount={invoice.totalAmount} currencyCode={invoice.currencyCode} />
      ),
    },
    {
      id: "paid",
      header: "Paid",
      align: "right",
      cell: (invoice) => (
        <MoneyText amount={invoice.amountPaid} currencyCode={invoice.currencyCode} />
      ),
    },
    {
      id: "balance",
      header: "Balance due",
      align: "right",
      cell: (invoice) => (
        <MoneyText amount={invoice.balanceDue} currencyCode={invoice.currencyCode} />
      ),
    },
    {
      id: "dueDate",
      header: "Due",
      cell: (invoice) =>
        invoice.dueDate === null ? (
          NOTHING
        ) : (
          <DateTimeText value={invoice.dueDate} timeZone={timeZone} />
        ),
    },
  ];
}

/**
 * Where a row of this kind opens, or nothing while that kind has no page of its own yet: a row never
 * links to a page that does not exist.
 */
function rowHrefFor(type: CustomerHistoryType): ((row: { id: string }) => string) | undefined {
  const open = RECORD_PATHS[type];
  return open === null ? undefined : (row) => open(row.id);
}

function HistoryTable({ page, timeZone }: { page: CustomerHistoryPage; timeZone: string }) {
  switch (page.tab) {
    case "requests":
      return (
        <DataTable<CustomerHistoryRequestDto>
          caption="Requests"
          rows={page.response.data}
          getRowId={(request) => request.id}
          rowHref={rowHrefFor("requests")}
          columns={requestColumns(timeZone)}
        />
      );
    case "quotations":
      return (
        <DataTable<CustomerHistoryQuotationDto>
          caption="Quotations"
          rows={page.response.data}
          getRowId={(quotation) => quotation.id}
          rowHref={rowHrefFor("quotations")}
          columns={quotationColumns(timeZone)}
          breakpoint="lg"
        />
      );
    case "jobs":
      return (
        <DataTable<CustomerHistoryJobDto>
          caption="Jobs"
          rows={page.response.data}
          getRowId={(job) => job.id}
          rowHref={rowHrefFor("jobs")}
          columns={jobColumns(timeZone)}
          breakpoint="lg"
        />
      );
    case "invoices":
      return (
        <DataTable<CustomerHistoryInvoiceDto>
          caption="Invoices"
          rows={page.response.data}
          getRowId={(invoice) => invoice.id}
          rowHref={rowHrefFor("invoices")}
          columns={invoiceColumns(timeZone)}
          breakpoint="lg"
        />
      );
  }
}

export interface CustomerHistoryProps {
  customerId: string;
  customerName: string;
  summary: AdminCustomerSummaryDto;
  tab: CustomerHistoryType;
  /** The open tab and its page of records. */
  page: CustomerHistoryPage;
  timeZone: string;
  /** The page's `searchParams`, so each link keeps the rest of the address. */
  params: SearchParamsInput;
}

/** The tab strip with a count on each tab. Each tab is a link, so the open tab lives in the address (D-40). */
export function CustomerHistoryTabs({
  customerId,
  summary,
  tab,
  params,
}: Pick<CustomerHistoryProps, "customerId" | "summary" | "tab" | "params">) {
  return (
    <LinkTabs
      label="Customer history"
      items={(Object.keys(TAB_LABELS) as CustomerHistoryType[]).map((type) => ({
        label: TAB_LABELS[type],
        href: tabHref(customerId, params, type),
        count: countOf(summary, type),
        current: type === tab,
      }))}
    />
  );
}

/**
 * One tab of the customer's history: its records, newest first, a page at a time, with a status
 * badge on each, a link to the request each belongs to, and a guided empty state. Only the tab that
 * is open is loaded.
 */
export function CustomerHistoryPanel({
  customerId,
  customerName,
  tab,
  page,
  timeZone,
  params,
}: Omit<CustomerHistoryProps, "summary">) {
  const { response } = page;
  const empty = EMPTY[tab];

  if (response.pagination.totalItems === 0) {
    return (
      <EmptyState
        icon={empty.icon}
        titleAs="h3"
        title={empty.title}
        description={empty.description(customerName)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <HistoryTable page={page} timeZone={timeZone} />
      <Pagination
        page={response.pagination.page}
        pageSize={response.pagination.pageSize}
        totalItems={response.pagination.totalItems}
        basePath={adminCustomerPath(customerId)}
        searchParams={params}
        itemLabel={PAGE_LABELS[tab]}
      />
    </div>
  );
}
