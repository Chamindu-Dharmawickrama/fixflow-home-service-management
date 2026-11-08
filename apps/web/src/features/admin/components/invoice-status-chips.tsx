import type { AdminInvoiceListMeta, InvoiceStatus } from "@fixflow/shared";
import Link from "next/link";

import { statusLabel } from "@/lib/formatting";
import type { SearchParamsInput } from "@/lib/url";
import { cn } from "@/lib/utils";

import { INVOICE_STATUS_ORDER, invoicesStatusHref } from "../lib/invoices";

export interface InvoiceStatusChipsProps {
  /** The status in the filter now, or none for every invoice. */
  selected: InvoiceStatus | undefined;
  /** Per status, for the search and dates in force but ignoring the status filter. */
  counts: AdminInvoiceListMeta["counts"];
  /** The page's `searchParams`, so every chip keeps the search, dates and sort. */
  params: SearchParamsInput;
}

const CHIP =
  "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 ease-standard";

function Count({ children, selected }: { children: number; selected: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs tabular-nums",
        selected ? "bg-surface text-brand" : "bg-surface-muted text-ink-secondary",
      )}
    >
      {children}
    </span>
  );
}

function Chip({
  href,
  selected,
  label,
  count,
}: {
  href: string;
  selected: boolean;
  label: string;
  count: number;
}) {
  return (
    <li className="shrink-0">
      <Link
        href={href}
        aria-current={selected ? "true" : undefined}
        className={cn(
          CHIP,
          selected
            ? "border-brand bg-brand-soft text-brand"
            : "border-border bg-surface text-ink-secondary hover:border-border-strong hover:text-ink",
        )}
      >
        {label} <Count selected={selected}>{count}</Count>
      </Link>
    </li>
  );
}

/**
 * The status filter of the invoice list (FR-074): "All" and one chip for each status, with how many
 * invoices each would show. The chips are links, so the choice lives in the URL and works before any
 * JavaScript loads (D-40). A selected chip is marked with `aria-current` and with its colour; the
 * count is part of the link's name ("Overdue 3"). The status is what the invoice is now, so an
 * invoice past its due date is under Overdue.
 */
export function InvoiceStatusChips({ selected, counts, params }: InvoiceStatusChipsProps) {
  return (
    <nav aria-label="Filter invoices by status">
      <ul className="flex gap-2 overflow-x-auto pb-1">
        <Chip
          href={invoicesStatusHref(params, undefined)}
          selected={selected === undefined}
          label="All"
          count={counts.all}
        />
        {INVOICE_STATUS_ORDER.map((status) => (
          <Chip
            key={status}
            href={invoicesStatusHref(params, status)}
            selected={selected === status}
            label={statusLabel("invoice", status)}
            count={counts[status]}
          />
        ))}
      </ul>
    </nav>
  );
}
