import type { RateLimitRule } from "./types.js";

/**
 * Every named rate limit, in one place. Later tasks add their limits here (login, register,
 * request submission, ...) and attach them with `rateLimitByName`.
 */
export const RATE_LIMITS = {
  /** Generous per-IP ceiling for the whole API, to blunt scripted abuse. */
  global: { limit: 300, windowSeconds: 60 },
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
