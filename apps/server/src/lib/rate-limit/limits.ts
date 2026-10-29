import type { RateLimitRule } from "./types.js";

/**
 * Every named rate limit, in one place. Later tasks add their limits here (request submission,
 * quotation decisions, ...) and attach them with `rateLimitByName`.
 */
export const RATE_LIMITS = {
  /** Generous per-IP ceiling for the whole API, to blunt scripted abuse. */
  global: { limit: 300, windowSeconds: 60 },

  // Authentication (T05, D-12, D-51). Counted per IP unless the comment says otherwise.
  /** Every sign-in attempt from one IP. */
  login: { limit: 20, windowSeconds: 60 },
  /** FAILED sign-ins per IP + email address; checked with `peek` before the password is tried. */
  loginFailures: { limit: 5, windowSeconds: 15 * 60 },
  register: { limit: 5, windowSeconds: 60 * 60 },
  google: { limit: 10, windowSeconds: 60 },
  /** Reset requests per email address (counted whether or not the account exists). */
  forgotEmail: { limit: 3, windowSeconds: 60 * 60 },
  forgotIp: { limit: 10, windowSeconds: 60 * 60 },
  reset: { limit: 10, windowSeconds: 60 * 60 },
  /** Password changes per signed-in user. */
  passwordChange: { limit: 10, windowSeconds: 60 * 60 },
  logout: { limit: 30, windowSeconds: 60 },

  // Notifications (T06). Counted per signed-in user. The bell asks for the count once a minute per
  // open tab, so the read limit leaves room for several tabs and for opening the list.
  notificationsRead: { limit: 120, windowSeconds: 60 },
  notificationsWrite: { limit: 60, windowSeconds: 60 },

  // Business configuration (T07). Counted per signed-in admin: a person editing a form never gets
  // near it, a script or a stolen session does.
  adminWrite: { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** The limits actually in force: {@link RATE_LIMITS} after the multiplier and overrides. */
export type RateLimitTable = Readonly<Record<RateLimitName, RateLimitRule>>;

export interface ResolveRateLimitsOptions {
  /** Scales every limit (the window is unchanged). Test and E2E environments raise it. */
  multiplier?: number;
  /** Explicit rules that replace a named limit outright (the multiplier is not applied). */
  overrides?: Partial<Record<RateLimitName, RateLimitRule>>;
}

export function resolveRateLimits(options: ResolveRateLimitsOptions = {}): RateLimitTable {
  const { multiplier = 1, overrides = {} } = options;
  const names = Object.keys(RATE_LIMITS) as RateLimitName[];

  const table = {} as Record<RateLimitName, RateLimitRule>;
  for (const name of names) {
    const base = RATE_LIMITS[name];
    table[name] = overrides[name] ?? {
      limit: Math.max(1, Math.ceil(base.limit * multiplier)),
      windowSeconds: base.windowSeconds,
    };
  }
  return Object.freeze(table);
}
