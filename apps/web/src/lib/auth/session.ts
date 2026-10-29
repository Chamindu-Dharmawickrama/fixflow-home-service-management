import type { AuthCustomerDto, AuthMeDto, AuthUserDto } from "@fixflow/shared";
import { cache } from "react";

import { isApiError } from "@/lib/api/errors";
import { serverApiGet } from "@/lib/api/server";

/** What the API says about the visitor's session. */
export type SessionState =
  | { status: "signed-in"; user: AuthUserDto; customer: AuthCustomerDto | undefined }
  /** No cookie, or one that is expired, revoked or forged. */
  | { status: "signed-out" }
  /** Signed in, but the account has no access to anything (an admin removed from the allowlist). */
  | { status: "no-access" };

/**
 * Asks the API who the visitor is (`GET /auth/me`), once per request (React `cache` shares the
 * answer between a layout and its page). An API outage throws, so the error boundary shows a retry
 * screen instead of pretending the visitor is signed out. Call it only behind a `<Suspense>`
 * boundary: it reads cookies, which is a request-time read.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  try {
    const me = await serverApiGet<AuthMeDto>("/auth/me");
    return { status: "signed-in", user: me.user, customer: me.customer };
  } catch (error) {
    if (isApiError(error)) {
      if (error.status === 401) return { status: "signed-out" };
      if (error.status === 403) return { status: "no-access" };
    }
    throw error;
  }
});

/** The signed-in user and customer record, or `null` when there is no usable session. */
export async function getCurrentUser(): Promise<AuthMeDto | null> {
  const session = await getSession();
  return session.status === "signed-in"
    ? { user: session.user, ...(session.customer !== undefined && { customer: session.customer }) }
    : null;
}
