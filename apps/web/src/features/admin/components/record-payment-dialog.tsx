"use client";

import { dateOnlyInTimeZone, ErrorCode } from "@fixflow/shared";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";

import { Field } from "@/components/forms/field";
import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";
import { formatMoney } from "@/lib/formatting/money";

import {
  firstPaymentFieldWithMessage,
  initialPaymentValues,
  PAYMENT_HELPER_TEXT,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_SENSITIVE_WARNING,
  type PaymentField,
  type PaymentFormErrors,
  type PaymentFormValues,
  splitServerPaymentErrors,
  toRecordPaymentBody,
  validatePaymentForm,
} from "../lib/payments";

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    /** "INV-2026-00007". */
    invoiceNumber: string;
    customerName: string;
    currencyCode: string;
    /** What the page shows as still owed, a decimal string. The server judges the real balance. */
    balanceDue: string;
  };
  /** The business time zone (IANA): "today" is its date, not the browser's. */
  timeZone: string;
  /** Where focus goes when the dialog closes: the button that opened it. */
  returnFocusTo?: RefObject<HTMLElement | null> | undefined;
  /** The server recorded the payment: the page reloads to show it. */
  onRecorded: () => void;
  /** The page is out of date (someone else changed the invoice): reload it. */
  onStale: () => void;
}

const FIELD_IDS: Record<PaymentField, string> = {
  amount: "payment-amount",
  paymentDate: "payment-date",
  method: "payment-method",
  reference: "payment-reference",
  notes: "payment-notes",
};

/**
 * Records money the business has already received outside FixFlow (FR-073, D-27). FixFlow does not
 * take, process or check a payment, and the dialog says so in its helper text. The amount starts as
 * the remaining balance and can be changed; the date starts as today on the business's calendar. The
 * form tells the person what is wrong beside each field, but the server judges the amount again
 * against the balance under a lock, and its refusal (with the balance that is left) is shown beside
 * the amount with everything typed kept. Nothing is announced as recorded until the server says so.
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  returnFocusTo,
  ...rest
}: RecordPaymentDialogProps) {
  // A save in flight cannot be dismissed: Escape, a click outside and the close button all wait.
  const pending = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // The content is unmounted when the dialog closes, so focus is handed back here in the same commit.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      returnFocusRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending.current) return;
        onOpenChange(next);
      }}
    >
      {open ? (
        <RecordPaymentContent
          {...rest}
          onOpenChange={onOpenChange}
          pending={pending}
          returnFocusRef={returnFocusRef}
          returnFocusTo={returnFocusTo}
        />
      ) : null}
    </Dialog>
  );
}

function RecordPaymentContent({
  invoice,
  timeZone,
  onOpenChange,
  onRecorded,
  onStale,
  pending: pendingRef,
  returnFocusRef,
  returnFocusTo,
}: Omit<RecordPaymentDialogProps, "open"> & {
  pending: { current: boolean };
  returnFocusRef: { current: HTMLElement | null };
}) {
  const [today] = useState(() => dateOnlyInTimeZone(new Date(), timeZone));
  const [values, setValues] = useState<PaymentFormValues>(() =>
    initialPaymentValues(invoice.balanceDue, today),
  );
  const [errors, setErrors] = useState<PaymentFormErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Focus goes to the first field with a message from an effect, which runs after the commit that
  // enables the inputs again (a disabled input cannot take focus).
  const focusAfterRef = useRef<PaymentField | null>(null);
  useEffect(() => {
    const field = focusAfterRef.current;
    if (field !== null) {
      focusAfterRef.current = null;
      document.getElementById(FIELD_IDS[field])?.focus();
    }
  });

  const edit = (patch: Partial<PaymentFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const field of Object.keys(patch) as PaymentField[]) {
        delete next[field];
      }
      return next;
    });
    setAlert(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const found = validatePaymentForm(values, {
      balanceDue: invoice.balanceDue,
      currencyCode: invoice.currencyCode,
      today,
    });
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setAlert(null);
      focusAfterRef.current = firstPaymentFieldWithMessage(found);
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setErrors({});
    setAlert(null);
    try {
      await apiFetch(`/admin/invoices/${encodeURIComponent(invoice.id)}/payments`, {
        method: "POST",
        body: toRecordPaymentBody(values),
      });
      pendingRef.current = false;
      toast.success("Payment recorded", {
        description: `${formatMoney(values.amount.trim(), invoice.currencyCode)} was recorded against ${invoice.invoiceNumber}.`,
      });
      onOpenChange(false);
      onRecorded();
      return;
    } catch (caught) {
      if (isApiError(caught) && caught.status === 422) {
        const { fields, loose } = splitServerPaymentErrors(caught.fieldErrors);
        if (caught.code === ErrorCode.PAYMENT_EXCEEDS_BALANCE) {
          // Someone else recorded a payment since this page loaded: show the balance that is left.
          onStale();
        }
        if (Object.keys(fields).length > 0) {
          setErrors(fields);
          focusAfterRef.current = firstPaymentFieldWithMessage(fields);
          setAlert(loose.length > 0 ? loose.join(" ") : null);
        } else {
          setAlert(describeApiError(caught));
        }
      } else if (
        isApiError(caught) &&
        (caught.code === ErrorCode.INVOICE_NOT_PAYABLE ||
          caught.code === ErrorCode.STALE_STATE ||
          caught.status === 404)
      ) {
        setAlert(
          caught.status === 404
            ? "This invoice could not be found. The page has been reloaded."
            : `${caught.message} The page has been reloaded.`,
        );
        onStale();
      } else {
        setAlert(describeApiError(caught));
      }
    }
    pendingRef.current = false;
    setPending(false);
  };

  return (
    <DialogContent
      hideCloseButton={pending}
      onOpenAutoFocus={() => {
        returnFocusRef.current =
          returnFocusTo?.current ??
          (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      }}
    >
      <DialogHeader>
        <DialogTitle className="break-words">Record payment</DialogTitle>
        <DialogDescription className="break-words">
          {invoice.invoiceNumber} for {invoice.customerName}. Balance due{" "}
          <span className="font-medium text-ink">
            {formatMoney(invoice.balanceDue, invoice.currencyCode)}
          </span>
          . {PAYMENT_HELPER_TEXT} {invoice.customerName} is told it was recorded.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id={FIELD_IDS.amount} label="Amount received" required error={errors.amount}>
            {(control) => (
              <Input
                {...control}
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                value={values.amount}
                disabled={pending}
                onChange={(event) => edit({ amount: event.target.value })}
              />
            )}
          </Field>
          <Field
            id={FIELD_IDS.paymentDate}
            label="Date received"
            required
            error={errors.paymentDate}
          >
            {(control) => (
              <DateInput
                {...control}
                name="paymentDate"
                value={values.paymentDate}
                max={today}
                disabled={pending}
                onChange={(event) => edit({ paymentDate: event.target.value })}
              />
            )}
          </Field>
        </div>

        <Field id={FIELD_IDS.method} label="How it was received" required error={errors.method}>
          {(control) => (
            <Select
              {...control}
              name="method"
              placeholder="Choose a method"
              value={values.method}
              disabled={pending}
              onChange={(event) =>
                edit({ method: event.target.value as PaymentFormValues["method"] })
              }
            >
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id={FIELD_IDS.reference}
          label="Reference (optional)"
          error={errors.reference}
          description={`A cheque or transfer number, for your records. ${PAYMENT_SENSITIVE_WARNING}`}
        >
          {(control) => (
            <Input
              {...control}
              name="reference"
              autoComplete="off"
              maxLength={100}
              value={values.reference}
              disabled={pending}
              onChange={(event) => edit({ reference: event.target.value })}
            />
          )}
        </Field>

        <Field
          id={FIELD_IDS.notes}
          label="Notes (optional)"
          error={errors.notes}
          description={`Only your team sees this. ${PAYMENT_SENSITIVE_WARNING}`}
        >
          {(control) => (
            <Textarea
              {...control}
              name="notes"
              maxLength={500}
              showCount
              value={values.notes}
              disabled={pending}
              onChange={(event) => edit({ notes: event.target.value })}
            />
          )}
        </Field>

        {alert === null ? null : <FormAlert tone="error">{alert}</FormAlert>}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" loading={pending} loadingText="Recording the payment…">
            Record payment
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
