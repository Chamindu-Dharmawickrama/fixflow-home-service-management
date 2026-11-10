import type { AppDeps } from "../../deps.js";
import type { AuthContext } from "../auth/auth.types.js";
import { toInvoicePdfSnapshot } from "./invoices.customer.dto.js";
import { authorizeInvoiceRead, readCustomerInvoiceRow } from "./invoices.customer.service.js";
import { syncOverdueInvoicesIfDue } from "./invoices.service.js";
import { buildInvoicePdf } from "./pdf/invoice-pdf.js";

/** A built invoice: the bytes and the name the download is saved under. */
export interface InvoicePdfFile {
  buffer: Buffer;
  /** `INV-2026-00012.pdf`, or `invoice-draft.pdf` for a draft that has no number yet. */
  filename: string;
}

/** The file name of an invoice's download: its number (which is `INV-YYYY-NNNNN`, safe in a header). */
export function invoicePdfFilename(invoiceNumber: string | null): string {
  return invoiceNumber === null
    ? "invoice-draft.pdf"
    : `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
}

/**
 * `GET /invoices/:id/pdf` (FR-072, SEC-FILE-01, SEC-FILE-02, spec §15.4): the invoice as a PDF.
 *
 * 1. **Authorize first**, from the owner's id alone: the owner of an issued invoice, or an admin.
 *    Anyone else gets `404` (a draft is the business's, so a customer's own draft is `404` too) and no
 *    PDF work is done.
 * 2. Save any overdue invoice that is due, so the document says what the screen says.
 * 3. Read the persisted invoice (the snapshot taken at issue, the lines, the payments that stand) and
 *    build the PDF from that alone: the settings as they are now cannot change an issued document.
 *
 * It writes nothing, so a builder failure leaves every record as it was; the route turns it into a
 * safe `500`.
 */
export async function getInvoicePdf(
  deps: Pick<AppDeps, "prisma" | "clock" | "config">,
  auth: AuthContext,
  id: string,
): Promise<InvoicePdfFile> {
  await authorizeInvoiceRead(deps, auth, id, { allowDraftForAdmin: true });
  await syncOverdueInvoicesIfDue(deps);
  const { row, settings } = await readCustomerInvoiceRow(deps.prisma, id);
  const snapshot = toInvoicePdfSnapshot({
    row,
    context: { now: deps.clock.now(), timeZone: settings.timeZone },
    settings,
  });
  return {
    buffer: await buildInvoicePdf(snapshot),
    filename: invoicePdfFilename(row.invoiceNumber),
  };
}
