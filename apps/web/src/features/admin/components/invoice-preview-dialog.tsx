"use client";

import type { AdminInvoiceDto } from "@fixflow/shared";
import { useEffect, useRef, useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, describeApiError } from "@/lib/api";

import { InvoiceDocument } from "./invoice-document";

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; invoice: AdminInvoiceDto }
  | { status: "failed"; message: string };

/**
 * What the invoice will look like (FR-072, UX-QB-INV). It asks the server for the saved draft, so the
 * preview is the stored invoice, not a guess from the form: it cannot show a total the server would
 * not. It says plainly that nothing has been issued: the number is not taken until then, and the
 * business details shown are the current ones, which are frozen at the moment of issue. Closing it
 * returns focus to the button that opened it.
 */
export function InvoicePreviewDialog({
  open,
  onOpenChange,
  invoiceId,
  timeZone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  timeZone: string;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  // Radix returns focus only to a Trigger. This dialog is controlled and has none, so it remembers
  // the element that had focus when it opened (the Preview button) and gives focus back there.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Bumped by "Try again", so the effect below runs once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const controller = new AbortController();
    apiFetch<AdminInvoiceDto>(`/admin/invoices/${encodeURIComponent(invoiceId)}`, {
      signal: controller.signal,
    })
      .then((invoice) => {
        setState({ status: "ready", invoice });
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: "failed", message: describeApiError(caught) });
        }
      });
    return () => {
      controller.abort();
    };
  }, [open, invoiceId, attempt]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // Closed: the next opening starts from "loading", never from a stale preview.
          setState({ status: "loading" });
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-3xl"
        onOpenAutoFocus={() => {
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>Preview of the invoice</DialogTitle>
          <DialogDescription>
            This is how the invoice will look. It has not been issued: the number is assigned and
            the details below are frozen when you issue it.
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" ? (
          <div role="status" aria-label="Loading the preview" className="flex flex-col gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : null}

        {state.status === "failed" ? (
          <div className="flex flex-col items-start gap-3">
            <FormAlert tone="error" className="w-full">
              {state.message}
            </FormAlert>
            <Button
              variant="outline"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((count) => count + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {state.status === "ready" ? (
          <InvoiceDocument invoice={state.invoice} timeZone={timeZone} idPrefix="preview-" />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
