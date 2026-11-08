"use client";

import { type AdminInvoiceDto, ErrorCode } from "@fixflow/shared";
import { Receipt } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import { adminInvoicePath } from "../lib/invoices";

export interface CreateInvoiceButtonProps {
  /** The completed job to invoice. */
  jobId: string;
  /** Names the job for screen readers when the button sits in a list ("Create invoice for JOB-…"). */
  jobReference?: string | undefined;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}

/**
 * "Create invoice" (FR-070, workflow 7.6): starts the draft invoice for a completed job, filled in
 * from the quotation the customer accepted, and goes straight to it, because adding any extra parts
 * and issuing it is the next thing to do. Nothing is typed again. It is safe to press twice: the
 * server refuses a second invoice for the job and names the first, and the button then goes there. It
 * stays blocked from the press until the page has moved on. A failure is shown as a message, so a
 * button in a table row needs no room of its own for it.
 */
export function CreateInvoiceButton({
  jobId,
  jobReference,
  size,
  variant,
}: CreateInvoiceButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const create = async () => {
    setPending(true);
    try {
      const invoice = await apiFetch<Pick<AdminInvoiceDto, "id">>(
        `/admin/work-orders/${encodeURIComponent(jobId)}/invoice`,
        { method: "POST", body: {} },
      );
      router.push(adminInvoicePath(invoice.id));
      return;
    } catch (caught) {
      if (isApiError(caught) && caught.code === ErrorCode.INVOICE_EXISTS) {
        // Someone (or an earlier press) already made it: take the person to it.
        const existing = caught.details?.invoiceId;
        toast.info("This job already has an invoice", { description: "Opening it now." });
        if (typeof existing === "string") {
          router.push(adminInvoicePath(existing));
          return;
        }
        router.refresh();
      } else {
        // The job is not as the page showed it: reload, so the page tells the truth.
        if (isApiError(caught) && (caught.status === 404 || caught.status === 409)) {
          router.refresh();
        }
        toast.error("We couldn't create the invoice", { description: describeApiError(caught) });
      }
    }
    setPending(false);
  };

  return (
    <Button
      {...(size !== undefined && { size })}
      {...(variant !== undefined && { variant })}
      onClick={() => void create()}
      loading={pending}
      loadingText="Creating the invoice…"
      aria-label={jobReference === undefined ? undefined : `Create invoice for ${jobReference}`}
    >
      <Receipt aria-hidden="true" />
      Create invoice
    </Button>
  );
}
