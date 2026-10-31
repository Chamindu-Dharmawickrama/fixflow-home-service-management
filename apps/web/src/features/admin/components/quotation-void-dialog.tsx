"use client";

import { ErrorCode, LIMITS, QuotationStatus } from "@fixflow/shared";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/sonner";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

const STALE_MESSAGE =
  "Someone else changed this quotation, so the page has been reloaded. Check it and try again.";

export interface QuotationVoidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quotationId: string;
  reference: string;
  /** The status the page shows; the server refuses the change if the quotation has moved on (D-46). */
  status: typeof QuotationStatus.DRAFT | typeof QuotationStatus.SENT;
  customerName: string;
  /** Runs after the server has voided it: the page moves on or reloads. */
  onVoided: () => void;
  /** Runs when the quotation had changed under the page, so the page can show the truth. */
  onConflict: () => void;
}

/**
 * Voids a draft or a sent quotation (FR-046, BR-16). It names the action, says what will happen to
 * the customer and the request, and requires a written reason that stays inside the business. For a
 * sent quotation an optional message for the customer can go with the notice; without one they get
 * a standard line. Nothing is announced as done until the server has said so.
 */
export function QuotationVoidDialog({
  open,
  onOpenChange,
  quotationId,
  reference,
  status,
  customerName,
  onVoided,
  onConflict,
}: QuotationVoidDialogProps) {
  const isSent = status === QuotationStatus.SENT;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Void ${reference}?`}
      consequence={
        isSent ? (
          <div className="flex flex-col gap-2">
            <p>
              {customerName} is told it was withdrawn, in their portal and by email, and can no
              longer accept it. If it is the only quotation sent for the request, the request goes
              back under review so you can prepare another.
            </p>
            <p>It stays in the history with your reason. This cannot be undone.</p>
          </div>
        ) : (
          <p>
            The draft is kept in the history with your reason. {customerName} never saw it, so they
            are not told. This cannot be undone.
          </p>
        )
      }
      confirmLabel="Void quotation"
      cancelLabel="Keep quotation"
      destructive
      reason={{
        label: "Reason (internal)",
        minLength: LIMITS.reason.minLength,
        maxLength: LIMITS.reason.maxLength,
        description: "Only your team sees this.",
      }}
      secondary={
        isSent
          ? {
              label: "Message to the customer",
              maxLength: LIMITS.reason.maxLength,
              description:
                "Optional. The customer reads this in their portal and in the email. Without one they are told the quotation was withdrawn.",
            }
          : undefined
      }
      onConfirm={async (reason, customerMessage) => {
        try {
          await apiFetch(`/admin/quotations/${encodeURIComponent(quotationId)}/void`, {
            method: "POST",
            body: {
              reason,
              expectedStatus: status,
              ...(customerMessage !== undefined && { customerMessage }),
            },
          });
        } catch (caught) {
          if (isApiError(caught) && (caught.status === 404 || caught.status === 409)) {
            onConflict();
          }
          throw new Error(
            isApiError(caught) && caught.code === ErrorCode.STALE_STATE
              ? STALE_MESSAGE
              : describeApiError(caught),
            { cause: caught },
          );
        }
        toast.success(`${reference} was voided`, {
          description: "It stays in the history with your reason.",
        });
        onVoided();
      }}
    />
  );
}
