import { formatTaxRate } from "@fixflow/shared";

import type { DocumentTotalRow } from "@/components/ui/document";

import { isZeroAmount } from "./money";

/** The amounts a quotation or an invoice prints under its lines, as the server worked them out. */
export interface DocumentAmounts {
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
}

/**
 * The rows under a document's lines: subtotal, the discount (only when there is one), tax with its
 * rate, and the total. Every figure is a decimal string, so nothing here is arithmetic. The
 * discount is shown as a negative amount. Shared by the quotation editor's preview, the document
 * views, and (T20) the invoice.
 */
export function documentTotalRows(amounts: DocumentAmounts, taxRate: string): DocumentTotalRow[] {
  const rows: DocumentTotalRow[] = [{ label: "Subtotal", amount: amounts.subtotal }];
  if (!isZeroAmount(amounts.discountAmount)) {
    rows.push({ label: "Discount", amount: `-${amounts.discountAmount}` });
  }
  rows.push(
    { label: `Tax (${formatTaxRate(taxRate)}%)`, amount: amounts.taxAmount },
    { label: "Total", amount: amounts.totalAmount, strong: true },
  );
  return rows;
}
