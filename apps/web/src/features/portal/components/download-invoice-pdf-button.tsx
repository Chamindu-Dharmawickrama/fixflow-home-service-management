"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { describeApiError, isApiError } from "@/lib/api";
import { errorFromResponse, networkError } from "@/lib/api/errors";

import { fallbackPdfName, invoicePdfPath } from "../lib/invoices";

/** The file name the server chose (`INV-2026-00012.pdf`), from its `Content-Disposition`. */
export function fileNameFrom(contentDisposition: string | null, fallback: string): string {
  const match = contentDisposition === null ? null : /filename="([^"]+)"/.exec(contentDisposition);
  const name = match?.[1];
  // A name with a path in it would be a server fault; the browser would strip it, but do not rely on it.
  return name === undefined || /[\\/]/.test(name) ? fallback : name;
}

export interface DownloadInvoicePdfButtonProps {
  invoiceId: string;
  /** Names the file when the server does not, and the toast: `INV-2026-00012`, or `draft invoice`. */
  label: string;
  variant?: "primary" | "outline";
  /** Holds the button back, for a draft whose changes are not saved yet (the PDF is of the saved draft). */
  disabled?: boolean;
  "aria-describedby"?: string | undefined;
}

/**
 * "Download PDF": asks the API for the invoice's PDF and saves it (FR-072). The server builds the
 * document on request, so the button shows it is working, refuses a second click meanwhile, and says
 * what went wrong in a toast if the API refuses or cannot be reached; nothing is saved then. It never
 * navigates away from the page, so a failure leaves everything as it was.
 */
export function DownloadInvoicePdfButton({
  invoiceId,
  label,
  variant = "outline",
  disabled = false,
  "aria-describedby": describedBy,
}: DownloadInvoicePdfButtonProps) {
  const [pending, setPending] = useState(false);

  async function download() {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      let response: Response;
      try {
        response = await fetch(invoicePdfPath(invoiceId), {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/pdf" },
        });
      } catch {
        throw networkError();
      }
      if (!response.ok) {
        throw await errorFromResponse(response);
      }
      const blob = await response.blob();
      const name = fileNameFrom(
        response.headers.get("Content-Disposition"),
        fallbackPdfName(label),
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
      // The browser has what it needs once the click is handled; free the blob a moment later.
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 10_000);
    } catch (error) {
      toast.error("The PDF could not be downloaded", {
        description: isApiError(error)
          ? describeApiError(error)
          : "Something went wrong. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant={variant}
      className="print:hidden"
      loading={pending}
      disabled={disabled}
      aria-describedby={describedBy}
      loadingText="Preparing the PDF…"
      onClick={() => {
        void download();
      }}
    >
      <Download aria-hidden="true" />
      Download PDF
    </Button>
  );
}
