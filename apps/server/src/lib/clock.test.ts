import { describe, expect, it } from "vitest";

import { FakeClock, systemClock } from "./clock.js";

describe("systemClock", () => {
  it("returns the current time", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("FakeClock", () => {
  it("stays where it is put", () => {
    const clock = new FakeClock("2026-03-02T09:00:00.000Z");

    expect(clock.now().toISOString()).toBe("2026-03-02T09:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-03-02T09:00:00.000Z");
  });

  it("advances by milliseconds and seconds", () => {
    const clock = new FakeClock("2026-03-02T09:00:00.000Z");

    clock.advance(1500);
    expect(clock.now().toISOString()).toBe("2026-03-02T09:00:01.500Z");
    clock.advanceSeconds(60);
    expect(clock.now().toISOString()).toBe("2026-03-02T09:01:01.500Z");
  });

  it("can be set to any time", () => {
    const clock = new FakeClock();

    clock.set("2030-12-31T23:59:59.000Z");

    expect(clock.now().toISOString()).toBe("2030-12-31T23:59:59.000Z");
  });

  it("returns copies, so callers cannot move it by mutating a result", () => {
    const clock = new FakeClock("2026-03-02T09:00:00.000Z");

    clock.now().setFullYear(1999);

    expect(clock.now().toISOString()).toBe("2026-03-02T09:00:00.000Z");
  });
});
