import type { ExportKind } from "@fixflow/shared";

import { apiPath } from "@/lib/api";

/** What a list is called in the file name and in the messages. */
export const EXPORT_LABELS: Readonly<Record<ExportKind, string>> = {
  requests: "requests",
  jobs: "jobs",
  invoices: "invoices",
};

/**
 * The address of a CSV export, through the same-origin proxy (D-06). `query` is the list's own API
 * query string, so the file holds what the screen is filtered to; the page number and size in it are
 * ignored by the server, because an export is the whole list.
 */
export function exportPath(kind: ExportKind, query: string): string {
  const route = `/admin/exports/${kind}.csv` as const;
  return query === "" ? apiPath(route) : `${apiPath(route)}?${query}`;
}

/** The name the file gets if the server does not name it. */
export function fallbackExportName(kind: ExportKind): string {
  return `fixflow-${EXPORT_LABELS[kind]}.csv`;
}
