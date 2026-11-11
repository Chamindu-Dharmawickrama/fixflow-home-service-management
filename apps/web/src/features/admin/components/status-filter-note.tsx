import { Filter } from "lucide-react";
import Link from "next/link";

export interface StatusFilterNoteProps {
  /** What the list holds, in the plural: "invoices", "jobs". */
  noun: string;
  /** The statuses the list is limited to, as their labels. */
  labels: readonly string[];
  /** The same list without the status filter, keeping everything else. */
  clearHref: string;
}

/** "Issued, Part paid or Overdue": the labels read as a choice. */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1] ?? ""}`;
}

/**
 * Says that a list is limited to some statuses, with the way out. The dashboard's links name several
 * statuses at once ("unpaid" is issued, part paid and overdue), which no single chip can show, so
 * the filter is stated in words instead of being left invisible in the address.
 */
export function StatusFilterNote({ noun, labels, clearHref }: StatusFilterNoteProps) {
  if (labels.length === 0) {
    return null;
  }
  return (
    <p
      role="status"
      data-testid="status-filter-note"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-ink-secondary"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Filter aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          Showing {noun} that are {joinLabels(labels)}.
        </span>
      </span>
      <Link
        href={clearHref}
        className="rounded-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
      >
        Show all {noun}
      </Link>
    </p>
  );
}
