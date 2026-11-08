"use client";

import { ErrorCode, type InvoiceStatus, LIMITS } from "@fixflow/shared";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/sonner";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

const STALE_MESSAGE =
  "Someone else changed this invoice, so the page has been reloaded. Check it and try again.";

export interface InvoiceVoidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  /** "INV-2026-00001", or "the draft invoice". */
  label: string;
  /** The status the page shows; the server refuses the change if the invoice has moved on (D-46). */
  status: InvoiceStatus;
  /** The invoice was issued, so the customer has been sent it and is told it was voided. */
  wasIssued: boolean;
  customerName: string;
  /** Runs after the server has voided it: the page moves on or reloads. */
  onVoided: () => void;
  /** Runs when the invoice had changed under the page, so the page can show the truth. */
  onConflict: () => void;
}

/**
 * Voids a draft or an issued invoice (FR-076, BR-16). It names the action, says what will happen to
 * the customer and the job, and requires a written reason that stays inside the business. Nothing is
 * announced as done until the server has said so; an invoice with payments on it is refused by the
 * server and the reason is shown.
 */
export function InvoiceVoidDialog({
  open,
  onOpenChange,
  invoiceId,
  label,
  status,
  wasIssued,
  customerName,
  onVoided,
  onConflict,
}: InvoiceVoidDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Void ${label}?`}
      consequence={
        wasIssued ? (
          <div className="flex flex-col gap-2">
            <p>
              {customerName} is told the invoice was voided, in their portal and by email, and does
              not need to pay it. The job can then be invoiced again.
            </p>
            <p>
              The invoice and its number stay in the history with your reason. This cannot be
              undone, and an invoice with payments recorded cannot be voided.
            </p>
          </div>
        ) : (
          <p>
            The draft is kept in the history with your reason. {customerName} never saw it, so they
            are not told. The job can then be invoiced again. This cannot be undone.
          </p>
        )
      }
      confirmLabel="Void invoice"
      cancelLabel="Keep invoice"
      destructive
      reason={{
        label: "Reason (internal)",
        minLength: LIMITS.reason.minLength,
        maxLength: LIMITS.reason.maxLength,
        description: "Only your team sees this.",
      }}
      onConfirm={async (reason) => {
        try {
          await apiFetch(`/admin/invoices/${encodeURIComponent(invoiceId)}/void`, {
            method: "POST",
            body: { reason, expectedStatus: status },
          });
        } catch (caught) {
          if (
            isApiError(caught) &&
            (caught.status === 404 ||
              caught.code === ErrorCode.STALE_STATE ||
              caught.code === ErrorCode.INVOICE_HAS_PAYMENTS)
          ) {
            onConflict();
          }
          throw new Error(
            isApiError(caught) && caught.code === ErrorCode.STALE_STATE
              ? STALE_MESSAGE
              : describeApiError(caught),
            { cause: caught },
          );
        }
        toast.success(`${label} was voided`, {
          description: "It stays in the history with your reason.",
        });
        onVoided();
      }}
    />
  );
}
