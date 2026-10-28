/** The `searchParams` object a Next.js page receives. */
export type SearchParamsInput = Record<string, string | string[] | undefined>;

/** Values to set on top of the current query; `null`, `undefined` and `""` remove the parameter. */
export type SearchParamsPatch = Record<string, string | number | null | undefined>;

/**
 * Builds a link that keeps the current query string and changes some parameters. List screens keep
 * their filters, sort and page in the URL (D-40), so every pagination, sort and filter link is
 * built from the current `searchParams` with only the changed parameters replaced.
 *
 * ```ts
 * buildHref("/app/requests", { status: "SUBMITTED", page: "3" }, { page: 4 })
 * // → "/app/requests?status=SUBMITTED&page=4"
 * ```
 */
export function buildHref(
  basePath: string,
  current: SearchParamsInput,
  patch: SearchParamsPatch = {},
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    if (key in patch || value === undefined) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item);
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  return query.length > 0 ? `${basePath}?${query}` : basePath;
}
