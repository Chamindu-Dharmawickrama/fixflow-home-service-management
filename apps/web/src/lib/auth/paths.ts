import { Role, ROLE_HOME_PATH } from "@fixflow/shared";

import { sanitizeReturnTo } from "./return-to";

/**
 * Set by the proxy on every request it lets through, so a layout can learn the URL. Never trusted
 * for anything but a `returnTo` hint, which is sanitized like any other.
 */
export const CURRENT_PATH_HEADER = "x-fixflow-path";

export const LOGIN_PATH = "/login";
export const REGISTER_PATH = "/register";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";

/**
 * The session cookie's name outside production and in production (the `__Host-` prefix). The web
 * app only checks that one of them is present, to decide whether to bounce a visitor to sign-in
 * early; the API validates the session itself (CLAUDE.md §7).
 */
export const SESSION_COOKIE_NAMES = ["fixflow_session", "__Host-fixflow_session"] as const;

export type AppArea = "admin" | "portal";

const AREA_PREFIX: Record<AppArea, string> = { admin: "/app", portal: "/portal" };

/** Which signed-in area a path belongs to, or `undefined` for public pages. */
export function areaOf(pathname: string): AppArea | undefined {
  for (const area of ["admin", "portal"] as const) {
    const prefix = AREA_PREFIX[area];
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return area;
    }
  }
  return undefined;
}

/** The page a signed-in person lands on by default. */
export function roleHomePath(role: Role): string {
  return ROLE_HOME_PATH[role];
}

/** The area a role may use. */
export function areaForRole(role: Role): AppArea {
  return role === Role.BUSINESS_ADMIN ? "admin" : "portal";
}

/** `/login?returnTo=%2Fapp%2Fdashboard`, with the destination made safe first. */
export function loginUrl(returnTo?: string): string {
  const safe = returnTo === undefined ? undefined : sanitizeReturnTo(returnTo, "");
  return safe === undefined || safe === ""
    ? LOGIN_PATH
    : `${LOGIN_PATH}?returnTo=${encodeURIComponent(safe)}`;
}

/**
 * Where to go after signing in: the requested page when it is safe and belongs to this person's
 * area, otherwise their home. A customer who followed an `/app/...` link gets their portal rather
 * than a "no access" page, and an open-redirect attempt (`https://evil.test`, `//evil.test`,
 * `/\evil`) falls back to the home page too.
 */
export function destinationAfterSignIn(returnTo: unknown, role: Role): string {
  const home = roleHomePath(role);
  const safe = sanitizeReturnTo(returnTo, home);
  const area = areaOf(new URL(safe, "http://fixflow.invalid").pathname);
  return area === undefined || area === areaForRole(role) ? safe : home;
}

export interface ProtectionInput {
  pathname: string;
  /** The query string including the leading `?`, or an empty string. */
  search: string;
  /** True when the request carries a session cookie (of any environment's name). */
  hasSessionCookie: boolean;
}

/**
 * The first line of route protection (the Next.js proxy): a request for `/app/*` or `/portal/*`
 * without a session cookie is sent to sign-in, remembering where it was headed. `/app` itself has
 * no page, so it goes to the dashboard. Returns the URL to redirect to, or `undefined` to let the
 * request through. The layouts then check the session with the API; this only saves a render for
 * the obvious case.
 */
export function protectionRedirect(input: ProtectionInput): string | undefined {
  if (input.pathname === "/app" || input.pathname === "/app/") {
    return `${ROLE_HOME_PATH.BUSINESS_ADMIN}${input.search}`;
  }
  if (areaOf(input.pathname) === undefined || input.hasSessionCookie) {
    return undefined;
  }
  return loginUrl(`${input.pathname}${input.search}`);
}
