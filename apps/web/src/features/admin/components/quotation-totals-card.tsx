import type { DocumentTotalsResult } from "@fixflow/shared";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentTotals } from "@/components/ui/document";
import { documentTotalRows } from "@/lib/formatting/document-totals";

/** The sentence under the heading, word for word: the numbers here are the editor's, not the server's. */
export const TOTALS_PREVIEW_NOTE = "Preview — final totals are calculated when you save";

/**
 * The live totals beside the lines (FR-042, UX-QB-QUO). They come from the shared calculation, the
 * very code the server runs, over what is typed right now, so the draft does not surprise on save;
 * but the stored totals are the server's, worked out again from the saved lines, and the heading
 * says so. While something typed cannot be added up (a quantity of "abc") no number is shown rather
 * than a wrong one.
 */
export function QuotationTotalsCard({
  totals,
  taxRate,
  currencyCode,
}: {
  totals: DocumentTotalsResult | null;
  taxRate: string;
  currencyCode: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Totals</CardTitle>
        <CardDescription>{TOTALS_PREVIEW_NOTE}</CardDescription>
      </CardHeader>
      <CardContent>
        {totals === null ? (
          <p className="text-sm text-ink-secondary">
            The totals appear once every quantity, price, the discount and the tax rate are valid.
            The fields to fix are marked.
          </p>
        ) : (
          <DocumentTotals currencyCode={currencyCode} rows={documentTotalRows(totals, taxRate)} />
        )}
      </CardContent>
    </Card>
  );
}
