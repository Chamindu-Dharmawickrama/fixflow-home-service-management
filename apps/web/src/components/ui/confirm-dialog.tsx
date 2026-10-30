"use client";

import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { type ReactNode, useId, useRef, useState } from "react";

import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ConfirmReasonOptions {
  label: string;
  /** Fewer characters (after trimming) keeps the confirm button disabled. */
  minLength: number;
  maxLength?: number | undefined;
  placeholder?: string | undefined;
  /** Extra guidance; the minimum length is always added. */
  description?: string | undefined;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen, in plain words, including what cannot be undone. Required on purpose. */
  consequence: ReactNode;
  confirmLabel: string;
  cancelLabel?: string | undefined;
  /** Style the confirm button as destructive, for actions that cancel, void or remove. */
  destructive?: boolean | undefined;
  /** Ask for a written reason (void, cancel, correct); the reason is passed to `onConfirm`. */
  reason?: ConfirmReasonOptions | undefined;
  /**
   * Runs when the user confirms. While the returned promise is pending the dialog stays open, both
   * buttons are blocked and Escape is ignored. If it resolves the dialog closes; if it rejects the
   * dialog stays open and shows the error so nothing looks done that is not.
   */
  onConfirm: (reason: string | undefined) => void | Promise<void>;
}

const DEFAULT_REASON_MAX = 500;

/**
 * Confirms a destructive or irreversible action (UX-INT-02): it names the action, says what will
 * happen, and can require a reason. It is an alert dialog, so focus starts inside it (on the
 * reason box when there is one, otherwise on Cancel), stays trapped, and returns to the control
 * that opened it.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  reason,
  onConfirm,
}: ConfirmDialogProps) {
  const reasonId = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  // Radix returns focus only to a Trigger. This dialog is controlled and has none, so it remembers
  // the element that had focus when it opened and gives focus back there when it closes.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Closing the dialog clears what was typed and any error, so it opens fresh next time. State is
  // adjusted while rendering (not in an effect) so there is no extra render with stale content.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setReasonText("");
      setError(null);
      setPending(false);
    }
  }

  const trimmed = reasonText.trim();
  const reasonMissing = reason !== undefined && trimmed.length < reason.minLength;

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason ? trimmed : undefined);
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "The action could not be completed. Please try again.",
      );
      setPending(false);
    }
  };

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-brand-deep/60 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            returnFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            if (reason) {
              event.preventDefault();
              reasonRef.current?.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(event) => {
            if (pending) {
              event.preventDefault();
            }
          }}
          className={cn(
            "fixed inset-4 z-50 m-auto flex h-fit max-h-full w-auto max-w-md flex-col gap-4 overflow-y-auto rounded-2xl bg-surface p-5 shadow-lg sm:p-6",
            "duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex flex-col gap-2">
            <AlertDialogPrimitive.Title className="font-display text-xl font-semibold text-ink">
              {title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description asChild>
              <div className="text-sm text-ink-secondary">{consequence}</div>
            </AlertDialogPrimitive.Description>
          </div>

          {reason ? (
            <Field
              id={reasonId}
              label={reason.label}
              required
              description={
                reason.description
                  ? `${reason.description} Enter at least ${reason.minLength} characters.`
                  : `Enter at least ${reason.minLength} characters.`
              }
            >
              {(control) => (
                <Textarea
                  {...control}
                  ref={reasonRef}
                  value={reasonText}
                  onChange={(event) => setReasonText(event.target.value)}
                  maxLength={reason.maxLength ?? DEFAULT_REASON_MAX}
                  showCount
                  placeholder={reason.placeholder}
                  disabled={pending}
                />
              )}
            </Field>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-danger-soft p-3 text-sm font-medium text-danger"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" disabled={pending}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant={destructive ? "destructive" : "primary"}
              disabled={reasonMissing}
              loading={pending}
              loadingText={`${confirmLabel}…`}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
