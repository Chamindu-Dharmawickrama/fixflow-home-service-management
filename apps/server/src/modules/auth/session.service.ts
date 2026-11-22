import type { Role } from "@fixflow/shared";

import type { Config } from "../../config/env.js";
import type { Clock } from "../../lib/clock.js";
import type { DbClient, PrismaClient } from "../../lib/db.js";
import { generateToken, hashToken } from "../../lib/tokens.js";
import { isExpired, sessionExpiry, shouldRenewSession } from "./auth.domain.js";
import type { AuthContext } from "./auth.types.js";

export interface SessionDeps {
  prisma: PrismaClient;
  clock: Clock;
  config: Pick<Config, "auth">;
}

export interface CreatedSession {
  /** The cookie value. Shown to the browser once; only its hash is stored (D-10). */
  token: string;
  expiresAt: Date;
}

/** Starts a session for a user and returns the cookie token. Expired sessions of the user are dropped. */
export async function createSession(
  deps: SessionDeps,
  userId: string,
  db: DbClient = deps.prisma,
): Promise<CreatedSession> {
  const now = deps.clock.now();
  const token = generateToken();
  const expiresAt = sessionExpiry(now);

  await db.session.create({
    data: {
      tokenHash: hashToken(token, deps.config.auth.sessionSecret),
      userId,
      expiresAt,
      lastUsedAt: now,
    },
  });
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: now } } });
  return { token, expiresAt };
}

export interface ResolvedSession {
  auth: AuthContext;
  /** Set when the session was renewed by this request: the new expiry, for re-issuing the cookie. */
  renewedUntil?: Date;
  /** The session's expiry as stored now (after a renewal, the new one). */
  expiresAt: Date;
}

/** A session with what authorization needs from its user and customer record. */
interface SessionLookupRow {
  id: string;
  expiresAt: Date;
  lastUsedAt: Date;
  userId: string;
  email: string;
  role: Role;
  isActive: boolean;
  customerId: string | null;
}

/**
 * Reads the session, its user and the user's customer record in ONE query (D-118). This runs before
 * every protected request. Prisma would load the nested relations with one query per level, three
 * round trips in a row, and each round trip costs the full distance to the database in production.
 * The integration tests of `requireAuth` (auth.session.int.test.ts) cover every column read here.
 */
async function findSession(
  prisma: PrismaClient,
  tokenHash: string,
): Promise<SessionLookupRow | undefined> {
  const rows = await prisma.$queryRaw<SessionLookupRow[]>`
    SELECT s.id,
           s.expires_at   AS "expiresAt",
           s.last_used_at AS "lastUsedAt",
           u.id           AS "userId",
           u.email,
           u.role::text   AS role,
           u.is_active    AS "isActive",
           c.id           AS "customerId"
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN customer_profiles c ON c.user_id = u.id
     WHERE s.token_hash = ${tokenHash}`;
  return rows[0];
}

/**
 * Finds the session and its user in one query and applies the rules of D-10: unknown, expired
 * (deleted on the way) and inactive-user sessions are all `undefined`; a session not used for over
 * an hour is renewed to a fresh 7 days.
 */
export async function resolveSession(
  deps: SessionDeps,
  token: string,
): Promise<ResolvedSession | undefined> {
  const { prisma, clock, config } = deps;
  const session = await findSession(prisma, hashToken(token, config.auth.sessionSecret));
  if (session === undefined) {
    return undefined;
  }

  const now = clock.now();
  if (isExpired(session.expiresAt, now)) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return undefined;
  }
  if (!session.isActive) {
    return undefined;
  }

  const auth: AuthContext = {
    userId: session.userId,
    role: session.role,
    email: session.email,
    sessionId: session.id,
    ...(session.customerId !== null && { customerId: session.customerId }),
  };

  if (shouldRenewSession(session.lastUsedAt, now)) {
    const renewedUntil = sessionExpiry(now);
    await prisma.session.updateMany({
      where: { id: session.id },
      data: { lastUsedAt: now, expiresAt: renewedUntil },
    });
    return { auth, renewedUntil, expiresAt: renewedUntil };
  }
  return { auth, expiresAt: session.expiresAt };
}

/** Deletes the session a cookie token belongs to. Idempotent: an unknown token is not an error. */
export async function revokeSessionByToken(deps: SessionDeps, token: string): Promise<void> {
  await deps.prisma.session.deleteMany({
    where: { tokenHash: hashToken(token, deps.config.auth.sessionSecret) },
  });
}

/** Deletes every session of a user, or every one except `exceptSessionId` (password change). */
export async function revokeUserSessions(
  db: DbClient,
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const { count } = await db.session.deleteMany({
    where: { userId, ...(exceptSessionId !== undefined && { id: { not: exceptSessionId } }) },
  });
  return count;
}
