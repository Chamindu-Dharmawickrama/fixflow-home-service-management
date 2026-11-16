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
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token, config.auth.sessionSecret) },
    select: {
      id: true,
      expiresAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          customerProfile: { select: { id: true } },
        },
      },
    },
  });
  if (session === null) {
    return undefined;
  }

  const now = clock.now();
  if (isExpired(session.expiresAt, now)) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return undefined;
  }
  if (!session.user.isActive) {
    return undefined;
  }

  const auth: AuthContext = {
    userId: session.user.id,
    role: session.user.role,
    email: session.user.email,
    sessionId: session.id,
    ...(session.user.customerProfile !== null && { customerId: session.user.customerProfile.id }),
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
