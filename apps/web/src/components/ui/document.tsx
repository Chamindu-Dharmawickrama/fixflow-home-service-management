import { MoneyText } from "@/components/ui/money-text";
import { cn } from "@/lib/utils";

export interface DocumentLine {
  id: string;
  description: string;
  /** A decimal string such as `"1.5"`. */
  quantity: string;
  unitPrice: string;
  /** Calculated by the server. */
  lineTotal: string;
}

/**
 * The line items of a quotation or invoice. From `sm` up it is a table with right-aligned
 * tabular amounts; on phones each line stacks (description above, quantity × price and total
 * below), so a document never scrolls sideways. All amounts are the server's decimal strings.
 */
export function DocumentLines({
  lines,
  currencyCode,
  caption,
  className,
}: {
  lines: readonly DocumentLine[];
  currencyCode: string;
  caption: string;
  className?: string | undefined;
}) {
  return (
    <div className={className}>
      <table className="hidden w-full border-collapse text-left text-sm sm:table">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border-strong text-xs font-semibold text-ink-secondary">
          <tr>
            <th scope="col" className="py-2 pr-4">
              Description
            </th>
            <th scope="col" className="px-4 py-2 text-right">
              Qty
            </th>
            <th scope="col" className="px-4 py-2 text-right">
              Unit price
            </th>
            <th scope="col" className="py-2 pl-4 text-right">
              Amount
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((line) => (
            <tr key={line.id}>
              <td className="py-3 pr-4 text-ink">{line.description}</td>
              <td className="px-4 py-3 text-right tabular-nums">{line.quantity}</td>
              <td className="px-4 py-3 text-right">
                <MoneyText amount={line.unitPrice} currencyCode={currencyCode} />
              </td>
              <td className="py-3 pl-4 text-right font-medium">
                <MoneyText amount={line.lineTotal} currencyCode={currencyCode} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul aria-label={caption} className="divide-y divide-border border-y border-border sm:hidden">
        {lines.map((line) => (
          <li key={line.id} className="flex flex-col gap-1 py-3 text-sm">
            <p className="text-ink">{line.description}</p>
            <p className="flex items-baseline justify-between gap-3 text-ink-secondary">
              <span className="tabular-nums">
                {line.quantity} × <MoneyText amount={line.unitPrice} currencyCode={currencyCode} />
              </span>
              <MoneyText
                amount={line.lineTotal}
                currencyCode={currencyCode}
                className="font-medium text-ink"
              />
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface DocumentTotalRow {
  label: string;
  amount: string;
  /** Emphasise the row (the total or the balance due). */
  strong?: boolean | undefined;
}

/** The totals under the lines, right-aligned. Each amount is calculated by the server. */
export function DocumentTotals({
  rows,
  currencyCode,
  className,
}: {
  rows: readonly DocumentTotalRow[];
  currencyCode: string;
  className?: string | undefined;
}) {
  return (
    <dl className={cn("ml-auto flex w-full flex-col gap-2 text-sm sm:max-w-xs", className)}>
      {rows.map((row) => (
        <div
          key={row.label}
          className={cn(
            "flex items-baseline justify-between gap-4",
            row.strong && "border-t border-border-strong pt-2 text-base font-semibold text-ink",
          )}
        >
          <dt className={row.strong ? undefined : "text-ink-secondary"}>{row.label}</dt>
          <dd>
            <MoneyText amount={row.amount} currencyCode={currencyCode} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
