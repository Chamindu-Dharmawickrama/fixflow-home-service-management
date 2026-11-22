import { type AuthMeDto, type AuthUserDto, ErrorCode, Role } from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import { isUniqueViolation } from "../../lib/db.js";
import { AppError, conflict, forbidden, rateLimited, validation } from "../../lib/errors.js";
import {
  hashPassword,
  passwordPolicyMessage,
  verifyAgainstDummyHash,
  verifyPassword,
} from "../../lib/password.js";
import { generateToken, hashToken } from "../../lib/tokens.js";
import { emailJob } from "../email/email.jobs.js";
import { PASSWORD_RESET_TEMPLATE } from "../email/email.templates.js";
import { canDeliverEmail } from "../email/email-sender.js";
import {
  ADMIN_REGISTRATION_MESSAGE,
  decideGoogleLink,
  emailKeyPart,
  GENERIC_CREDENTIALS_MESSAGE,
  isAdminEmail,
  isDemoAccountEmail,
  PASSWORD_RESET_REQUESTED_MESSAGE,
  RESET_TOKEN_LIFETIME_MINUTES,
  RESET_TOKEN_LIFETIME_MS,
  roleForNewAccount,
} from "./auth.domain.js";
import { AUTH_USER_SELECT, type AuthUserRecord, toAuthMeDto, toAuthUserDto } from "./auth.dto.js";
import type { LoginBody, RegisterBody } from "./auth.schemas.js";
import type { AuthContext } from "./auth.types.js";
import { type GoogleIdentity, GoogleSignInNotConfiguredError } from "./google-verifier.js";
import {
  type CreatedSession,
  createSession,
  revokeSessionByToken,
  revokeUserSessions,
} from "./session.service.js";

export type AuthServiceDeps = Pick<
  AppDeps,
  | "prisma"
  | "clock"
  | "config"
  | "logger"
  | "emailDispatcher"
  | "googleVerifier"
  | "rateLimiter"
  | "rateLimits"
>;

/** A signed-in user and the new session to put in the cookie. */
export interface SignedIn {
  user: AuthUserDto;
  session: CreatedSession;
}

const SIGNUP_DISABLED_MESSAGE =
  "New accounts can't be created right now. Please contact the business.";
const ACCOUNT_DISABLED_MESSAGE = "This account has been deactivated. Please contact the business.";
const INVALID_RESET_TOKEN_MESSAGE =
  "This reset link is invalid or has expired. Request a new one to continue.";
const DEMO_LOCKED_MESSAGE =
  "This is a shared demo account, so its password can't be changed. Create your own account to try that.";

const MAX_AVATAR_URL_LENGTH = 2048;

function genericCredentialsError(): AppError {
  return new AppError(401, ErrorCode.INVALID_CREDENTIALS, GENERIC_CREDENTIALS_MESSAGE);
}

function accountDisabledError(): AppError {
  return new AppError(403, ErrorCode.ACCOUNT_DISABLED, ACCOUNT_DISABLED_MESSAGE);
}

function signupDisabledError(): AppError {
  return new AppError(403, ErrorCode.SIGNUP_DISABLED, SIGNUP_DISABLED_MESSAGE);
}

function invalidResetTokenError(): AppError {
  return new AppError(400, ErrorCode.INVALID_RESET_TOKEN, INVALID_RESET_TOKEN_MESSAGE);
}

function demoAccountLockedError(): AppError {
  return new AppError(403, ErrorCode.DEMO_ACCOUNT_LOCKED, DEMO_LOCKED_MESSAGE);
}

function isDemoLocked(deps: Pick<AuthServiceDeps, "config">, email: string): boolean {
  return deps.config.auth.demoMode && isDemoAccountEmail(email);
}

// --- Sign-in failure throttling --------------------------------------------------------------

/** The counter key for failed sign-ins: the caller's IP plus a hash of the email (no address in Redis). */
function failureKey(ip: string, email: string): string {
  return `loginFailures:${ip}:${emailKeyPart(email)}`;
}

/**
 * Rejects with 429 while this IP + email has used up its allowance of failed sign-ins (D-51). It
 * only looks (`peek`): successful sign-ins do not count. If the limiter store is down the check is
 * skipped, like every other rate limit (the API fails open, D-57).
 */
async function assertLoginNotThrottled(deps: AuthServiceDeps, key: string): Promise<void> {
  try {
    const status = await deps.rateLimiter.peek(key, deps.rateLimits.loginFailures);
    if (!status.success) {
      const seconds = Math.ceil((status.resetAt.getTime() - deps.clock.now().getTime()) / 1000);
      throw rateLimited(Math.max(1, seconds), "Too many failed sign-in attempts. Try again later.");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    deps.logger.error(
      { err: error },
      "Rate limiter unavailable; skipping the sign-in failure check",
    );
  }
}

async function recordLoginFailure(deps: AuthServiceDeps, key: string): Promise<void> {
  try {
    await deps.rateLimiter.consume(key, deps.rateLimits.loginFailures);
  } catch (error) {
    deps.logger.error({ err: error }, "Rate limiter unavailable; sign-in failure not counted");
  }
}

// --- Local accounts ---------------------------------------------------------------------------

/**
 * Creates a customer account with a local password and signs them in (FR-010). Registering with an
 * allowlisted admin email is refused with a deliberately vague message and never creates an admin
 * (D-08). An existing email is a 409: telling the visitor is an accepted trade-off for a usable
 * form, and the endpoint is rate-limited.
 */
export async function registerCustomer(
  deps: AuthServiceDeps,
  body: RegisterBody,
): Promise<SignedIn> {
  const { prisma, clock, config } = deps;

  if (isAdminEmail(body.email, config.auth.adminEmails)) {
    throw validation({ email: ADMIN_REGISTRATION_MESSAGE });
  }
  const emailTaken = new AppError(
    409,
    ErrorCode.EMAIL_TAKEN,
    "An account already exists for this email — sign in or reset your password.",
  );
  if (
    (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) !== null
  ) {
    throw emailTaken;
  }

  const passwordHash = await hashPassword(body.password);
  let user;
  try {
    user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        role: Role.CUSTOMER,
        passwordHash,
        termsAcceptedAt: clock.now(),
        lastSignInAt: clock.now(),
        customerProfile: { create: {} },
      },
      select: AUTH_USER_SELECT,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw emailTaken;
    throw error;
  }

  return { user: toAuthUserDto(user), session: await createSession(deps, user.id) };
}

/**
 * Signs in with email and password. Every kind of failure (unknown email, wrong password, a Google-
 * only account) gives the same 401, and each of them spends the same time on a password check
 * (a dummy hash when there is nothing to check against), so neither the response nor its timing
 * reveals whether an address has an account.
 */
export async function loginWithPassword(
  deps: AuthServiceDeps,
  body: LoginBody,
  context: { ip: string },
): Promise<SignedIn> {
  const { prisma, clock } = deps;
  const key = failureKey(context.ip, body.email);
  await assertLoginNotThrottled(deps, key);

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: { ...AUTH_USER_SELECT, isActive: true },
  });
  const passwordMatches =
    user?.passwordHash != null
      ? await verifyPassword(body.password, user.passwordHash)
      : await verifyAgainstDummyHash(body.password);

  if (user === null || !passwordMatches) {
    await recordLoginFailure(deps, key);
    throw genericCredentialsError();
  }
  // Only someone who proved the password learns that the account is switched off.
  if (!user.isActive) {
    throw accountDisabledError();
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastSignInAt: clock.now() } });
  return { user: toAuthUserDto(user), session: await createSession(deps, user.id) };
}

// --- Google ----------------------------------------------------------------------------------

export interface GoogleSignedIn extends SignedIn {
  isNewUser: boolean;
}

type GoogleOutcome =
  | { kind: "ok"; user: AuthUserRecord; isNewUser: boolean }
  | { kind: "disabled" }
  | { kind: "conflict" }
  | { kind: "signup-disabled" };

function safeAvatarUrl(url: string | null): string | null {
  return url !== null && url.startsWith("https://") && url.length <= MAX_AVATAR_URL_LENGTH
    ? url
    : null;
}

function displayName(identity: GoogleIdentity, email: string): string {
  const name = identity.name.trim().slice(0, 100);
  return name !== "" ? name : (email.split("@")[0] ?? email);
}

/**
 * Signs in (or up) with a Google ID token (D-07, D-51). The token is verified by the injectable
 * verifier; then the account is found by Google subject, or linked to the account with the same
 * email, or created. Linking to a local account whose email was never verified clears that
 * account's password and revokes its sessions, because someone else may have set them
 * ("pre-hijacking"). An allowlisted email becomes an admin only here, for a new account (D-08).
 */
export async function signInWithGoogle(
  deps: AuthServiceDeps,
  credential: string,
): Promise<GoogleSignedIn> {
  const { prisma, clock, config, logger } = deps;

  let identity: GoogleIdentity;
  try {
    identity = await deps.googleVerifier.verify(credential);
  } catch (error) {
    if (error instanceof GoogleSignInNotConfiguredError) {
      throw new AppError(
        503,
        ErrorCode.GOOGLE_SIGN_IN_UNAVAILABLE,
        "Google sign-in isn't available right now. Use your email and password instead.",
      );
    }
    // The credential itself is never logged.
    logger.warn({ err: error }, "Google credential rejected");
    throw new AppError(
      401,
      ErrorCode.INVALID_GOOGLE_CREDENTIAL,
      "We couldn't verify your Google sign-in. Please try again.",
    );
  }
  if (!identity.emailVerified) {
    throw new AppError(
      403,
      ErrorCode.GOOGLE_EMAIL_NOT_VERIFIED,
      "Google says this email address isn't verified, so it can't be used to sign in.",
    );
  }

  const email = identity.email.trim().toLowerCase();
  const avatarUrl = safeAvatarUrl(identity.pictureUrl);

  const attempt = async (): Promise<GoogleOutcome> =>
    prisma.$transaction(async (tx): Promise<GoogleOutcome> => {
      const now = clock.now();
      const bySubject = await tx.user.findUnique({ where: { googleSubject: identity.subject } });
      if (bySubject !== null) {
        if (!bySubject.isActive) return { kind: "disabled" };
        await tx.user.update({ where: { id: bySubject.id }, data: { lastSignInAt: now } });
        return {
          kind: "ok",
          user: await tx.user.findUniqueOrThrow({
            where: { id: bySubject.id },
            select: AUTH_USER_SELECT,
          }),
          isNewUser: false,
        };
      }

      const byEmail = await tx.user.findUnique({ where: { email } });
      if (byEmail !== null) {
        if (!byEmail.isActive) return { kind: "disabled" };
        const decision = decideGoogleLink(byEmail, identity.subject);
        if (decision.kind !== "link") return { kind: "conflict" };

        await tx.user.update({
          where: { id: byEmail.id },
          data: {
            googleSubject: identity.subject,
            // Google has just proven the address, whether or not it was verified before.
            emailVerifiedAt: byEmail.emailVerifiedAt ?? now,
            avatarUrl: byEmail.avatarUrl ?? avatarUrl,
            lastSignInAt: now,
            ...(decision.clearPasswordAndSessions && { passwordHash: null }),
          },
        });
        if (decision.clearPasswordAndSessions) {
          await revokeUserSessions(tx, byEmail.id);
        }
        return {
          kind: "ok",
          user: await tx.user.findUniqueOrThrow({
            where: { id: byEmail.id },
            select: AUTH_USER_SELECT,
          }),
          isNewUser: false,
        };
      }

      const role = roleForNewAccount(email, config.auth.adminEmails);
      if (role === Role.CUSTOMER && !config.auth.publicSignupEnabled) {
        return { kind: "signup-disabled" };
      }
      const created = await tx.user.create({
        data: {
          email,
          name: displayName(identity, email),
          avatarUrl,
          role,
          googleSubject: identity.subject,
          emailVerifiedAt: now,
          termsAcceptedAt: now,
          lastSignInAt: now,
          ...(role === Role.CUSTOMER && { customerProfile: { create: {} } }),
        },
        select: AUTH_USER_SELECT,
      });
      return { kind: "ok", user: created, isNewUser: true };
    });

  let outcome: GoogleOutcome;
  try {
    outcome = await attempt();
  } catch (error) {
    // Two first sign-ins at once: the loser finds the winner's account on the second try.
    if (!isUniqueViolation(error)) throw error;
    outcome = await attempt();
  }

  switch (outcome.kind) {
    case "disabled":
      throw accountDisabledError();
    case "signup-disabled":
      throw signupDisabledError();
    case "conflict":
      throw conflict("This email is already linked to a different Google account.");
    case "ok":
      return {
        user: toAuthUserDto(outcome.user),
        session: await createSession(deps, outcome.user.id),
        isNewUser: outcome.isNewUser,
      };
  }
}

// --- Password reset and change ---------------------------------------------------------------

/**
 * Starts a password reset (FR-010, D-51). The caller always gets the same answer, whether or not
 * the address has an account, and the email is sent in the background so the response time does
 * not depend on it either. A reset needs a mail server in production; without one the honest
 * answer is "unavailable" and no token is created.
 */
export async function requestPasswordReset(
  deps: AuthServiceDeps,
  email: string,
): Promise<{ message: string }> {
  const { prisma, clock, config } = deps;

  if (config.isProduction && !canDeliverEmail(config)) {
    throw new AppError(
      503,
      ErrorCode.PASSWORD_RESET_UNAVAILABLE,
      "Password reset by email isn't available right now. Please contact the business.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isActive: true },
  });
  if (user !== null && user.isActive) {
    // The demo accounts' addresses are published, so naming them here reveals nothing (D-09).
    if (isDemoLocked(deps, user.email)) {
      throw demoAccountLockedError();
    }

    const token = generateToken();
    const now = clock.now();
    await prisma.$transaction(async (tx) => {
      // Only the newest link works.
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token, config.auth.sessionSecret),
          expiresAt: new Date(now.getTime() + RESET_TOKEN_LIFETIME_MS),
        },
      });
    });

    // After the commit, off the request path (so the response time does not reveal whether the
    // account exists). The dispatcher records the outcome and never throws.
    const resetUrl = `${config.email.publicWebUrl}/reset-password?token=${encodeURIComponent(token)}`;
    deps.emailDispatcher.dispatchAfterCommit([
      emailJob(PASSWORD_RESET_TEMPLATE, user.email, {
        resetUrl,
        expiresInMinutes: RESET_TOKEN_LIFETIME_MINUTES,
      }),
    ]);
  }

  return { message: PASSWORD_RESET_REQUESTED_MESSAGE };
}

/**
 * Completes a reset: the token must be unused and unexpired; the new password must meet the
 * policy; then, in one transaction, the token is spent, the password replaced, the address marked
 * as verified (the link proved ownership) and **every** session revoked. The person signs in again.
 */
export async function resetPassword(
  deps: AuthServiceDeps,
  input: { token: string; password: string },
): Promise<void> {
  const { prisma, clock, config } = deps;
  const now = clock.now();

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token, config.auth.sessionSecret) },
    select: {
      id: true,
      usedAt: true,
      expiresAt: true,
      user: { select: { id: true, email: true, isActive: true, emailVerifiedAt: true } },
    },
  });
  if (
    record === null ||
    record.usedAt !== null ||
    record.expiresAt.getTime() <= now.getTime() ||
    !record.user.isActive
  ) {
    throw invalidResetTokenError();
  }

  // Checked before the token is spent, so a too-weak password does not burn the link.
  const policyMessage = passwordPolicyMessage(input.password, { email: record.user.email });
  if (policyMessage !== undefined) {
    throw validation({ password: policyMessage });
  }
  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction(async (tx) => {
    // The conditional update is what makes the token single-use under concurrency.
    const spent = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (spent.count !== 1) {
      throw invalidResetTokenError();
    }
    await tx.passwordResetToken.updateMany({
      where: { userId: record.user.id, usedAt: null },
      data: { usedAt: now },
    });
    await tx.user.update({
      where: { id: record.user.id },
      data: { passwordHash, emailVerifiedAt: record.user.emailVerifiedAt ?? now },
    });
    await revokeUserSessions(tx, record.user.id);
  });
}

/**
 * Changes the signed-in user's password. The current password must be right, the new one must meet
 * the policy, and the user's **other** sessions are revoked (this one stays). The shared demo
 * accounts are locked in demo mode (D-09).
 */
export async function changePassword(
  deps: AuthServiceDeps,
  auth: AuthContext,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const { prisma } = deps;
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, email: true, passwordHash: true },
  });
  if (user === null) {
    throw forbidden();
  }
  if (isDemoLocked(deps, user.email)) {
    throw demoAccountLockedError();
  }
  if (user.passwordHash === null) {
    throw new AppError(
      409,
      ErrorCode.PASSWORD_NOT_SET,
      "Your account signs in with Google and has no password yet. Use “Set a password” to create one.",
    );
  }
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError(
      422,
      ErrorCode.INVALID_CURRENT_PASSWORD,
      "Your current password is incorrect.",
      {
        fieldErrors: { currentPassword: "Your current password is incorrect." },
      },
    );
  }
  const policyMessage = passwordPolicyMessage(input.newPassword, { email: user.email });
  if (policyMessage !== undefined) {
    throw validation({ newPassword: policyMessage });
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await revokeUserSessions(tx, user.id, auth.sessionId);
  });
}

// --- Session ---------------------------------------------------------------------------------

/** Deletes the session behind a cookie token. Safe to call with nothing, or with a token already gone. */
export async function signOut(deps: AuthServiceDeps, token: string | undefined): Promise<void> {
  if (token !== undefined && token !== "") {
    await revokeSessionByToken(deps, token);
  }
}

/**
 * The signed-in person (`GET /auth/me`). An admin whose email has left `ADMIN_EMAILS` still has a
 * valid session but no access: they get 403 here too, so the web app shows "no access" rather than
 * an admin area whose every call would fail (D-08).
 */
export async function getCurrentUser(deps: AuthServiceDeps, auth: AuthContext): Promise<AuthMeDto> {
  // Side by side, not as a nested select: Prisma would read the customer record only after the
  // user, one more round trip on every page a signed-in person opens (D-118).
  const [user, customerProfile] = await Promise.all([
    deps.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: AUTH_USER_SELECT }),
    deps.prisma.customerProfile.findUnique({
      where: { userId: auth.userId },
      select: { id: true, phone: true },
    }),
  ]);
  if (
    user.role === Role.BUSINESS_ADMIN &&
    !isAdminEmail(user.email, deps.config.auth.adminEmails)
  ) {
    throw new AppError(
      403,
      ErrorCode.FORBIDDEN,
      "This account no longer has administrator access.",
    );
  }
  return toAuthMeDto(user, customerProfile);
}
