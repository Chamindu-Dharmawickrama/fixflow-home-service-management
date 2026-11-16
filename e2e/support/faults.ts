import type { BrowserContext } from "@playwright/test";

import { FAULT_PROXY_URL } from "./env.js";

/**
 * Makes the API fail for one browser context only (T25), through the fault proxy that sits between
 * the E2E web server and the API (`support/fault-proxy.ts`). Playwright's `page.route` sees only the
 * browser's own requests; a page whose data the web server reads (every list and detail page) can only
 * be made to fail here. The fault is tied to the context's session cookie, so parallel tests never
 * see each other's faults.
 */

const SESSION_COOKIES = ["fixflow_session", "__Host-fixflow_session"];

export async function sessionCookieOf(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((candidate) =>
    SESSION_COOKIES.includes(candidate.name),
  );
  if (cookie === undefined) {
    throw new Error("This context has no session cookie: sign in before injecting a fault.");
  }
  return cookie.value;
}

export interface FaultOptions {
  /** Matched against the request's path and query, for example `/^\/api\/v1\/admin\/requests(\?|$)/`. */
  path: RegExp;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** `error` answers 500 in the API's error format; `drop` closes the connection (the API is down). */
  mode?: "error" | "drop";
  /** The status of an `error` answer; 500 by default. */
  status?: number;
  /** How many requests it fails; every matching request when left out. */
  times?: number;
}

export async function injectFault(context: BrowserContext, options: FaultOptions): Promise<void> {
  const response = await fetch(`${FAULT_PROXY_URL}/__faults`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session: await sessionCookieOf(context),
      path: options.path.source,
      method: options.method,
      mode: options.mode ?? "error",
      status: options.status,
      times: options.times,
    }),
  });
  if (response.status !== 201) {
    throw new Error(`The fault proxy refused the fault: ${String(response.status)}`);
  }
}

/** Removes every fault of this context, so the next request reaches the API again. */
export async function clearFaults(context: BrowserContext): Promise<void> {
  const session = await sessionCookieOf(context);
  await fetch(`${FAULT_PROXY_URL}/__faults?session=${encodeURIComponent(session)}`, {
    method: "DELETE",
  });
}
