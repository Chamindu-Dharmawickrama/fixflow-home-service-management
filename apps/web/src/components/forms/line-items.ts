import { type DocumentTotalsResult, LIMITS, tryCalculateDocumentTotals } from "@fixflow/shared";

/**
 * The line items of a quotation or an invoice as a form holds them: every number is the text typed,
 * never a float (CLAUDE.md §9). The amounts are worked out by the shared calculation, the very code
 * the server runs, so what the preview shows is what a save will store.
 */
export interface LineItemFormValue {
  description: string;
  /** Greater than zero, two decimal places at most: `"1"`, `"1.5"`. */
  quantity: string;
  /** Zero or more, two decimal places at most: `"85.00"`. */
  unitPrice: string;
  taxable: boolean;
}

/** What "Add line" appends: one of something, taxable like most lines are, with a price still to enter. */
export const EMPTY_LINE: LineItemFormValue = {
  description: "",
  quantity: "1",
  unitPrice: "",
  taxable: true,
};

export const MIN_LINES = LIMITS.lineItems.min;
export const MAX_LINES = LIMITS.lineItems.max;

/** What a line shows as its total while its quantity or price cannot be used yet. */
export const NO_LINE_TOTAL = "—";

/**
 * The total of each line by itself, so a line shows its amount as soon as its own numbers are valid
 * even while another line is still being typed. `undefined` for a line that cannot be added up yet.
 */
export function lineTotalsOf(lines: readonly LineItemFormValue[]): (string | undefined)[] {
  return lines.map((line) => {
    const result = tryCalculateDocumentTotals({
      lines: [{ quantity: line.quantity, unitPrice: line.unitPrice, taxable: line.taxable }],
      discountAmount: "0",
      taxRate: "0",
    });
    return result.ok ? result.totals.lines[0]?.lineSubtotal : undefined;
  });
}

export interface DocumentPreview {
  /** The document's totals, or `null` while something in the lines, discount or tax rate cannot be used. */
  totals: DocumentTotalsResult | null;
  /** Each line's own total, by row. */
  lineTotals: (string | undefined)[];
}

/** The live preview of a document: the shared calculation over what is typed right now. */
export function previewDocument(input: {
  lines: readonly LineItemFormValue[];
  discountAmount: string;
  taxRate: string;
}): DocumentPreview {
  const result = tryCalculateDocumentTotals({
    lines: input.lines.map(({ quantity, unitPrice, taxable }) => ({
      quantity,
      unitPrice,
      taxable,
    })),
    discountAmount: input.discountAmount,
    taxRate: input.taxRate,
  });
  return { totals: result.ok ? result.totals : null, lineTotals: lineTotalsOf(input.lines) };
}
