import type { Role } from "@fixflow/shared";

/**
 * Who is making the request, taken from the session and nothing else. Handlers must never read a
 * user, role or customer id from the request body, query or path to decide what the caller may do
 * (FR-014): customer scoping always starts here.
 */
export interface AuthContext {
  userId: string;
  role: Role;
  /** The normalized email address; the admin allowlist is checked against it (D-08). */
  email: string;
  /** The `CustomerProfile` id of a `CUSTOMER`. Absent for admins. */
  customerId?: string;
  sessionId: string;
}

declare module "express-serve-static-core" {
  interface Request {
    /** Set by `requireAuth` (and the guards built on it) when the session is valid. */
    auth?: AuthContext;
    /** The session's stored expiry, set with `auth`; `GET /auth/me?refresh=1` re-issues the cookie with it. */
    sessionExpiresAt?: Date;
  }
}
