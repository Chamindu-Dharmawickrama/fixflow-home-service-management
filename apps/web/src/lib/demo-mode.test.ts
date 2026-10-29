import { afterEach, describe, expect, it, vi } from "vitest";

import { isDemoMode } from "./demo-mode";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isDemoMode", () => {
  it("is on only when NEXT_PUBLIC_DEMO_MODE is exactly true", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(isDemoMode()).toBe(true);
  });

  it.each(["false", "", "TRUE", "1", "yes"])("is off for %j", (value) => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", value);
    expect(isDemoMode()).toBe(false);
  });

  it("is off when the variable is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", undefined);
    expect(isDemoMode()).toBe(false);
  });
});
