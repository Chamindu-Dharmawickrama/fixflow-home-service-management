"use client";

import { type AdminInvoiceDto, InvoiceAction } from "@fixflow/shared";
import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";
import { DownloadInvoicePdfButton } from "@/features/portal/components/download-invoice-pdf-button";

import { invoiceTitle } from "../lib/invoices";
import { InvoiceVoidDialog } from "./invoice-void-dialog";

/**
 * The buttons on an issued (or voided) invoice's page (D-26, D-43): print, and Void when the server
 * lists it. The server names what may be done (`availableActions`); this offers exactly that. An
 * invoice with a payment on it is not offered Void at all, and the endpoint refuses it too.
 */
export function InvoiceActions({ invoice }: { invoice: AdminInvoiceDto }) {
  const router = useRouter();
  const [voidOpen, setVoidOpen] = useState(false);
  const canVoid = invoice.availableActions.includes(InvoiceAction.VOID);

  return (
    <>
      <DownloadInvoicePdfButton invoiceId={invoice.id} label={invoiceTitle(invoice)} />
      <PrintButton>Print</PrintButton>
      {canVoid ? (
        <Button variant="outline" className="print:hidden" onClick={() => setVoidOpen(true)}>
          <Ban aria-hidden="true" />
          Void invoice…
        </Button>
      ) : null}

      <InvoiceVoidDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        invoiceId={invoice.id}
        label={invoiceTitle(invoice)}
        status={invoice.status}
        wasIssued={invoice.invoiceNumber !== null}
        customerName={invoice.customer.name}
        onVoided={() => router.refresh()}
        onConflict={() => router.refresh()}
      />
    </>
  );
}
