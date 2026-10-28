import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { cn } from "@/lib/utils";

export interface DataTableColumn<Row> {
  /** Stable id; also the sort field sent to `getSortHref` when `sortable`. */
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /**
   * The row's identity column (for example the reference). It carries the link to the record and
   * becomes the card title on narrow screens. Exactly one column should be primary.
   */
  primary?: boolean | undefined;
  sortable?: boolean | undefined;
  /** Right-align numbers and money. */
  align?: "left" | "right" | undefined;
  /** Hide this column in the stacked card layout. */
  hideOnCard?: boolean | undefined;
}

export interface DataTableSort {
  field: string;
  order: "asc" | "desc";
}

export interface DataTableProps<Row> {
  /** The table's accessible name ("Service requests"). Visually hidden; the page heading is visible. */
  caption: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** Where a row's record lives. Makes the primary cell a link and the whole row clickable. */
  rowHref?: ((row: Row) => string) | undefined;
  /** The current sort, from the URL. */
  sort?: DataTableSort | undefined;
  /** The link a sortable header goes to: the current URL with `sort`/`order` changed. */
  getSortHref?: ((field: string) => string) | undefined;
  /** Where the table becomes cards: below `md` (768 px, default) or below `lg` (1024 px) for wide tables. */
  breakpoint?: "md" | "lg" | undefined;
  className?: string | undefined;
}

const SHOW_TABLE = { md: "hidden md:block", lg: "hidden lg:block" } as const;
const SHOW_CARDS = { md: "md:hidden", lg: "lg:hidden" } as const;

/** The stretched link: its `::after` covers the whole row or card, so the row is one big target. */
const STRETCHED_LINK =
  "font-medium text-brand underline-offset-4 hover:underline after:absolute after:inset-0 after:content-['']";

function SortIcon({ active, order }: { active: boolean; order: "asc" | "desc" }) {
  if (!active) {
    return <ChevronsUpDown aria-hidden="true" className="size-3.5 text-ink-muted" />;
  }
  return order === "asc" ? (
    <ArrowUp aria-hidden="true" className="size-3.5" />
  ) : (
    <ArrowDown aria-hidden="true" className="size-3.5" />
  );
}

/**
 * A list of records. From the breakpoint up it is a real `<table>` with column headers, sort
 * links and a clickable row; below it, the same rows become stacked cards (UX-07), so nothing
 * needs sideways scrolling on a phone.
 *
 * Row links: the primary cell holds the one real link (`rowHref`), and its `::after` stretches
 * over the row, so a screen reader hears one link per row, a keyboard visits it once and a mouse
 * can click anywhere. Interactive elements inside a row (menus, buttons) need `relative z-10` to
 * stay above that layer. It is a server component: `cell` renderers run on the server.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowId,
  rowHref,
  sort,
  getSortHref,
  breakpoint = "md",
  className,
}: DataTableProps<Row>) {
  const primary = columns.find((column) => column.primary) ?? columns[0];

  const renderPrimary = (column: DataTableColumn<Row>, row: Row) => {
    const content = column.cell(row);
    if (rowHref && column === primary) {
      return (
        <Link href={rowHref(row)} className={STRETCHED_LINK}>
          {content}
        </Link>
      );
    }
    return content;
  };

  return (
    <div className={className}>
      <ScrollRegion
        label={caption}
        className={cn(SHOW_TABLE[breakpoint], "rounded-xl border border-border bg-surface")}
      >
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-muted text-xs font-semibold text-ink-secondary">
            <tr>
              {columns.map((column) => {
                const active = sort?.field === column.id;
                const ariaSort = column.sortable
                  ? active
                    ? sort.order === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                  : undefined;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn("px-4 py-3", column.align === "right" && "text-right")}
                  >
                    {column.sortable && getSortHref ? (
                      <Link
                        href={getSortHref(column.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm hover:text-ink",
                          active && "text-ink",
                        )}
                      >
                        {column.header}
                        <SortIcon active={active} order={sort?.order ?? "asc"} />
                      </Link>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr
                key={getRowId(row)}
                className={cn(
                  "relative",
                  rowHref && "transition-colors duration-150 hover:bg-surface-muted",
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      "px-4 py-3 align-middle",
                      column.align === "right" && "text-right tabular-nums",
                    )}
                  >
                    {renderPrimary(column, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>

      <ul className={cn(SHOW_CARDS[breakpoint], "grid gap-3")} aria-label={caption}>
        {rows.map((row) => (
          <li key={getRowId(row)}>
            <Card className="relative flex flex-col gap-3 p-4">
              {primary ? <div className="text-base">{renderPrimary(primary, row)}</div> : null}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {columns
                  .filter((column) => column !== primary && !column.hideOnCard)
                  .map((column) => (
                    <div key={column.id} className="min-w-0">
                      <dt className="text-xs text-ink-muted">{column.header}</dt>
                      <dd className="mt-0.5 text-ink">{column.cell(row)}</dd>
                    </div>
                  ))}
              </dl>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
