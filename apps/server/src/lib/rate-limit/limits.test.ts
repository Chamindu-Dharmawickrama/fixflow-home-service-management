import { describe, expect, it } from "vitest";

import { RATE_LIMITS, resolveRateLimits } from "./limits.js";

describe("RATE_LIMITS", () => {
  it("defines a generous global per-IP limit", () => {
    expect(RATE_LIMITS.global).toEqual({ limit: 300, windowSeconds: 60 });
  });

  it("defines the authentication limits of T05", () => {
    expect(RATE_LIMITS.login).toEqual({ limit: 20, windowSeconds: 60 });
    expect(RATE_LIMITS.loginFailures).toEqual({ limit: 5, windowSeconds: 900 });
    expect(RATE_LIMITS.register).toEqual({ limit: 5, windowSeconds: 3600 });
    expect(RATE_LIMITS.google).toEqual({ limit: 10, windowSeconds: 60 });
    expect(RATE_LIMITS.forgotEmail).toEqual({ limit: 3, windowSeconds: 3600 });
    expect(RATE_LIMITS.forgotIp).toEqual({ limit: 10, windowSeconds: 3600 });
    expect(RATE_LIMITS.reset).toEqual({ limit: 10, windowSeconds: 3600 });
    expect(RATE_LIMITS.logout).toEqual({ limit: 30, windowSeconds: 60 });
  });

  it("limits an invoice PDF to thirty an hour per user (T22)", () => {
    expect(RATE_LIMITS.invoicePdf).toEqual({ limit: 30, windowSeconds: 3600 });
  });

  it("limits CSV exports to ten a minute per admin (T23)", () => {
    expect(RATE_LIMITS.adminExport).toEqual({ limit: 10, windowSeconds: 60 });
  });

  it("limits the shared demo accounts to 60 writes in 10 minutes and new sign-ups to 3 an hour per IP (T24)", () => {
    expect(RATE_LIMITS.demoWrite).toEqual({ limit: 60, windowSeconds: 600 });
    expect(RATE_LIMITS.demoRegister).toEqual({ limit: 3, windowSeconds: 3600 });
  });

  it("uses positive integers for every limit", () => {
    for (const rule of Object.values(RATE_LIMITS)) {
      expect(Number.isInteger(rule.limit) && rule.limit > 0).toBe(true);
      expect(Number.isInteger(rule.windowSeconds) && rule.windowSeconds > 0).toBe(true);
    }
  });
});

describe("resolveRateLimits", () => {
  it("returns the configured limits unchanged by default", () => {
    expect(resolveRateLimits().global).toEqual(RATE_LIMITS.global);
  });

  it("scales the limit by the multiplier and keeps the window", () => {
    expect(resolveRateLimits({ multiplier: 100 }).global).toEqual({
      limit: 30_000,
      windowSeconds: 60,
    });
  });

  it("rounds a fractional result up and never goes below one request", () => {
    expect(resolveRateLimits({ multiplier: 0.0001 }).global.limit).toBe(1);
    expect(resolveRateLimits({ multiplier: 1.001 }).global.limit).toBe(301);
  });

  it("lets explicit overrides replace a limit outright", () => {
    const table = resolveRateLimits({
      multiplier: 100,
      overrides: { global: { limit: 2, windowSeconds: 10 } },
    });

    expect(table.global).toEqual({ limit: 2, windowSeconds: 10 });
  });

  it("returns a frozen table", () => {
    expect(Object.isFrozen(resolveRateLimits())).toBe(true);
  });
});
