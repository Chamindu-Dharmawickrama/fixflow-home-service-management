"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Toaster as SonnerToaster } from "sonner";

export { toast } from "sonner";

/**
 * The single toast region, mounted once in the root layout. Show a success toast only after the
 * server has confirmed the change (never optimistically), and keep the wording specific: say what
 * happened and, where useful, what happens next ("Quotation QT-2026-00042 sent to Morgan Reyes").
 * Errors that need action belong inline or in an `ErrorState`, not only in a toast that vanishes.
 */
export function Toaster() {
  return (
    <SonnerToaster
      theme="light"
      position="bottom-right"
      closeButton
      visibleToasts={3}
      icons={{
        success: <CircleCheck aria-hidden="true" className="size-5 text-success" />,
        error: <CircleAlert aria-hidden="true" className="size-5 text-danger" />,
        warning: <TriangleAlert aria-hidden="true" className="size-5 text-attention" />,
        info: <Info aria-hidden="true" className="size-5 text-info" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-start gap-3 rounded-xl border border-border bg-surface p-4 text-sm text-ink shadow-lg sm:w-96",
          success: "border-success-edge",
          error: "border-danger-edge",
          warning: "border-attention-edge",
          info: "border-info-edge",
          icon: "mt-0.5 shrink-0",
          // min-w-0 and overflow-wrap: a long word in a message (a name, an address) wraps instead
          // of pushing the toast past a phone's edge (F-75).
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "font-medium text-ink [overflow-wrap:anywhere]",
          description: "text-ink-secondary [overflow-wrap:anywhere]",
          actionButton:
            "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-surface hover:bg-brand-hover",
          cancelButton:
            "rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted",
          closeButton:
            "absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-muted hover:text-ink",
        },
      }}
    />
  );
}
