import { describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({ notFound }));

import { isStyleguideEnabled, requireStyleguide } from "./guard";

describe("styleguide guard", () => {
  it("is enabled in development and test and disabled in production", () => {
    expect(isStyleguideEnabled("development")).toBe(true);
    expect(isStyleguideEnabled("test")).toBe(true);
    expect(isStyleguideEnabled(undefined)).toBe(true);
    expect(isStyleguideEnabled("production")).toBe(false);
  });

  it("answers 404 in a production build and lets the page render otherwise", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => requireStyleguide()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);

    notFound.mockClear();
    vi.stubEnv("NODE_ENV", "development");
    expect(() => requireStyleguide()).not.toThrow();
    expect(notFound).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });
});
