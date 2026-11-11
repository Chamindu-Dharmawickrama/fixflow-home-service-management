"use client";

import type { ExportKind } from "@fixflow/shared";
import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { describeApiError, isApiError } from "@/lib/api";
import { errorFromResponse, networkError } from "@/lib/api/errors";

import { fileNameFrom } from "../../portal/components/download-invoice-pdf-button";
import { EXPORT_LABELS, exportPath, fallbackExportName } from "../lib/exports";

export interface ExportCsvButtonProps {
  kind: ExportKind;
  /** The list's own API query string: the file holds what the screen is filtered to. */
  query: string;
}

/**
 * "Export CSV" on a list (FR-084): asks the API for the rows the list would show for its current
 * filters and saves them as a file. The button shows it is working and refuses a second click
 * meanwhile; if the API refuses (for example when asked too often) or cannot be reached it says so in
 * a toast and saves nothing. It never leaves the page, so a failure changes nothing.
 */
export function ExportCsvButton({ kind, query }: ExportCsvButtonProps) {
  const [pending, setPending] = useState(false);

  async function download() {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      let response: Response;
      try {
        response = await fetch(exportPath(kind, query), {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "text/csv" },
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
        fallbackExportName(kind),
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 10_000);
    } catch (error) {
      toast.error(`The ${EXPORT_LABELS[kind]} could not be exported`, {
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
      variant="outline"
      loading={pending}
      loadingText="Preparing the file…"
      onClick={() => {
        void download();
      }}
    >
      <Download aria-hidden="true" />
      Export CSV
    </Button>
  );
}
