"use client";

import { ErrorCode, LIMITS } from "@fixflow/shared";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/sonner";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";
import { formatMoney } from "@/lib/formatting/money";

import { voidPaymentConsequence } from "../lib/payments";

const CHANGED_MESSAGE =
  "This payment or invoice was changed by someone else, so the page has been reloaded. Check it and try again.";

export interface VoidPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  currencyCode: string;
  /** What the page shows as still owed. */
  balanceDue: string;
  /** The payment to void; `null` while the dialog is closed. */
  payment: { id: string; amount: string; paymentDate: string } | null;
  /** The date as the page writes it, for the sentence ("Mar 2, 2026"). */
  paymentDateLabel: string;
  /** Runs after the server has voided it: the page reloads. */
  onVoided: () => void;
  /** Runs when the payment or invoice had changed under the page. */
  onConflict: () => void;
}

/**
 * Voids a recorded payment (FR-076, BR-16): the correction for one entered wrongly. It says in
 * numbers what will happen (the balance goes up by the amount, and the customer is told), requires a
 * written reason that stays inside the business, and never deletes anything: the payment stays in the
 * list marked Voided. Nothing is announced until the server has said so.
 */
export function VoidPaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  customerName,
  currencyCode,
  balanceDue,
  payment,
  paymentDateLabel,
  onVoided,
  onConflict,
}: VoidPaymentDialogProps) {
  const consequence =
    payment === null
      ? null
      : voidPaymentConsequence({ amount: payment.amount, balanceDue, currencyCode });

  return (
    <ConfirmDialog
      open={open && payment !== null}
      onOpenChange={onOpenChange}
      title={
        payment === null
          ? "Void payment?"
          : `Void the ${formatMoney(payment.amount, currencyCode)} payment?`
      }
      consequence={
        consequence === null ? null : (
          <div className="flex flex-col gap-2">
            <p>
              The invoice balance will increase by {consequence.raises}, to {consequence.newBalance}
              . {customerName} is told in their portal that the payment record dated{" "}
              {paymentDateLabel} was reversed.
            </p>
            <p>
              The payment stays in the list on {invoiceNumber}, marked Voided, with your reason.
              This cannot be undone. If it was recorded wrongly, record the correct payment after
              voiding this one.
            </p>
          </div>
        )
      }
      confirmLabel="Void payment"
      cancelLabel="Keep payment"
      destructive
      reason={{
        label: "Reason (internal)",
        minLength: LIMITS.reason.minLength,
        maxLength: LIMITS.reason.maxLength,
        description: "Only your team sees this.",
      }}
      onConfirm={async (reason) => {
        if (payment === null) return;
        try {
          await apiFetch(
            `/admin/invoices/${encodeURIComponent(invoiceId)}/payments/${encodeURIComponent(payment.id)}/void`,
            { method: "POST", body: { reason } },
          );
        } catch (caught) {
          const changed =
            isApiError(caught) &&
            (caught.status === 404 ||
              caught.code === ErrorCode.PAYMENT_ALREADY_VOIDED ||
              caught.code === ErrorCode.INVALID_STATE_TRANSITION);
          if (changed) {
            onConflict();
          }
          throw new Error(changed ? CHANGED_MESSAGE : describeApiError(caught), { cause: caught });
        }
        toast.success("Payment voided", {
          description: "It stays in the list, marked Voided, with your reason.",
        });
        onVoided();
      }}
    />
  );
}
