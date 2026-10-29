import type { AdminServiceListResponse } from "@fixflow/shared";

import { serverApiGetEnvelope } from "@/lib/api/server";

export interface CatalogueContext {
  /** Categories already in use, for the form's suggestions (so "Cleaning" is not typed three ways). */
  categories: string[];
  /** The business currency, for the price box. */
  currencyCode: string;
}

/**
 * What the service form needs besides the service itself. One request for up to a hundred services
 * is plenty for a catalogue of a small business; the categories are the distinct ones, sorted. Call
 * it from a Server Component behind a `<Suspense>` boundary.
 */
export async function loadCatalogueContext(): Promise<CatalogueContext> {
  const list = await serverApiGetEnvelope<AdminServiceListResponse>(
    "/admin/services?page=1&pageSize=100&sort=category&order=asc",
  );
  const categories = [...new Set(list.data.map((service) => service.category))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  return { categories, currencyCode: list.meta.currencyCode };
}
