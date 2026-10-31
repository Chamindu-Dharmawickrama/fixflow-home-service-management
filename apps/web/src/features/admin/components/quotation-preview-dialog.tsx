"use client";

import type { CustomerQuotationDto } from "@fixflow/shared";
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

import { QuotationDocument } from "./quotation-document";

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; quotation: CustomerQuotationDto }
  | { status: "failed"; message: string };

/**
 * What the customer will see (FR-043, UX-QB-QUO). It asks the server for the customer's shape of the
 * saved draft (`GET /quotations/:id?preview=1`), so the preview is the customer's view of what is
 * stored, not a guess from the form: it cannot show a total the server would not. It says plainly
 * that nothing has been sent. Closing it returns focus to the button that opened it.
 */
export function QuotationPreviewDialog({
  open,
  onOpenChange,
  quotationId,
  timeZone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quotationId: string;
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
    apiFetch<CustomerQuotationDto>(`/quotations/${encodeURIComponent(quotationId)}?preview=1`, {
      signal: controller.signal,
    })
      .then((quotation) => {
        setState({ status: "ready", quotation });
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: "failed", message: describeApiError(caught) });
        }
      });
    return () => {
      controller.abort();
    };
  }, [open, quotationId, attempt]);

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
          <DialogTitle>Preview for the customer</DialogTitle>
          <DialogDescription>
            This is how the quotation will look to the customer. It has not been sent.
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
          <QuotationDocument quotation={state.quotation} timeZone={timeZone} idPrefix="preview-" />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
