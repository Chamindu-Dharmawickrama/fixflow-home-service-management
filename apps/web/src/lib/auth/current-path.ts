import { headers } from "next/headers";

import { CURRENT_PATH_HEADER } from "./paths";

/**
 * The path and query of the page being rendered, as the proxy recorded it, or `undefined` when the
 * proxy did not run. Layouts use it to send a visitor with a stale session back where they were
 * after signing in again. A request-time read: call it behind a `<Suspense>` boundary.
 */
export async function currentPath(): Promise<string | undefined> {
  return (await headers()).get(CURRENT_PATH_HEADER) ?? undefined;
}
