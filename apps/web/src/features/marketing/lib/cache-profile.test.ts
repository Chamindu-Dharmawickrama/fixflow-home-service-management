import { describe, expect, it } from "vitest";

import {
  DEFAULT_REVALIDATE_SECONDS,
  OUTAGE_REVALIDATE_SECONDS,
  outageProfile,
  rememberProfile,
  resolveRevalidateSeconds,
} from "./cache-profile";

describe("resolveRevalidateSeconds", () => {
  it("is 60 seconds when nothing is configured", () => {
    expect(DEFAULT_REVALIDATE_SECONDS).toBe(60);
    expect(resolveRevalidateSeconds(undefined)).toBe(60);
    expect(resolveRevalidateSeconds("")).toBe(60);
  });

  it("reads a whole number of seconds", () => {
    expect(resolveRevalidateSeconds("2")).toBe(2);
    expect(resolveRevalidateSeconds(" 300 ")).toBe(300);
    expect(resolveRevalidateSeconds("3600")).toBe(3600);
  });

  it("falls back to the default for anything that is not a sensible number of seconds", () => {
    for (const bad of ["0", "-5", "1.5", "abc", "60s", "3601", "99999999", "1e3", "NaN"]) {
      expect(resolveRevalidateSeconds(bad), bad).toBe(60);
    }
  });
});

describe("rememberProfile", () => {
  it("keeps an answer for the revalidation time and lets an unvisited one live ten times as long", () => {
    expect(rememberProfile(60)).toEqual({ stale: 60, revalidate: 60, expire: 600 });
  });

  it("never lets an entry expire in under five minutes, so it can be part of a prerendered page", () => {
    expect(rememberProfile(2).expire).toBe(300);
    expect(rememberProfile(20).expire).toBe(300);
  });

  it("never lets a short revalidation time make `stale` shorter than 30 s, which would leave the entry out of prerenders", () => {
    expect(rememberProfile(2)).toEqual({ stale: 30, revalidate: 2, expire: 300 });
    expect(rememberProfile(29).stale).toBe(30);
    expect(rememberProfile(30).stale).toBe(30);
    for (const seconds of [1, 2, 10, 59, 60, 600]) {
      expect(rememberProfile(seconds).stale, String(seconds)).toBeGreaterThanOrEqual(30);
    }
  });

  it("always has expire at or above revalidate, as Next.js requires", () => {
    for (const seconds of [1, 2, 59, 60, 300, 3600]) {
      const profile = rememberProfile(seconds);
      expect(profile.expire).toBeGreaterThanOrEqual(profile.revalidate);
    }
  });
});

describe("outageProfile", () => {
  it("remembers an outage for ten seconds only", () => {
    expect(OUTAGE_REVALIDATE_SECONDS).toBe(10);
    expect(outageProfile()).toEqual({ stale: 30, revalidate: 10, expire: 300 });
  });

  it("is short enough to recover quickly but not so short that it makes the page request-time only", () => {
    const profile = outageProfile();
    // Thresholds in the Next.js docs: stale under 30 s, or expire under 5 minutes, leave a hole.
    expect(profile.stale).toBeGreaterThanOrEqual(30);
    expect(profile.expire).toBeGreaterThanOrEqual(300);
    expect(profile.revalidate).toBeLessThan(rememberProfile(DEFAULT_REVALIDATE_SECONDS).revalidate);
  });
});
