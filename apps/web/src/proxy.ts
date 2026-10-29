import { type NextRequest, NextResponse } from "next/server";

import { CURRENT_PATH_HEADER, protectionRedirect, SESSION_COOKIE_NAMES } from "@/lib/auth/paths";

/**
 * The first line of route protection (Next.js 16 calls the former "middleware" a proxy). A request
 * for `/app/*` or `/portal/*` without a session cookie is redirected to `/login?returnTo=…`. That
 * only saves a render for the obvious case: the layouts ask the API who the visitor is, and the API
 * enforces role and ownership on every call, so a forged cookie gets a sign-in redirect or a "no
 * access" page and no data (CLAUDE.md §7).
 *
 * The matcher keeps the proxy off the API rewrite (`/api/v1/*`), static files and public pages.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const redirect = protectionRedirect({
    pathname,
    search,
    hasSessionCookie: SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name)),
  });
  if (redirect !== undefined) {
    return NextResponse.redirect(new URL(redirect, request.nextUrl));
  }

  // A layout cannot see the URL, but needs it to build `returnTo` when the cookie turns out to be
  // stale. Set here, always overwriting whatever the client sent.
  const headers = new Headers(request.headers);
  headers.set(CURRENT_PATH_HEADER, `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/app/:path*", "/portal/:path*"],
};
