import type { ComponentProps } from "react";

import { formatMoney } from "@/lib/formatting/money";
import { cn } from "@/lib/utils";

export interface MoneyTextProps extends Omit<ComponentProps<"span">, "children"> {
  /** A decimal string from the API, for example `"1284.50"`. Never a number. */
  amount: string;
  /** ISO 4217 code from the document or business settings, never inferred from the browser. */
  currencyCode: string;
}

/**
 * A money amount in tabular figures, so columns of amounts line up. It formats the string
 * exactly; there is no floating-point conversion anywhere on the way.
 */
export function MoneyText({ amount, currencyCode, className, ...props }: MoneyTextProps) {
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)} {...props}>
      {formatMoney(amount, currencyCode)}
    </span>
  );
}
