import type { PublicSettingsDto } from "@fixflow/shared";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serverApiGetPublic = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/server", () => ({ serverApiGetPublic }));
// React's request-scoped `cache` only memoizes inside a server render; here a plain Map stands in,
// keyed by arguments, which is the behaviour the helper relies on.
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof ReactModule>();
  return {
    ...original,
    cache: <T extends (...args: never[]) => unknown>(fn: T): T => {
      let result: unknown;
      let called = false;
      return ((...args: never[]) => {
        if (!called) {
          result = fn(...args);
          called = true;
        }
        return result;
      }) as T;
    },
  };
});

const SETTINGS: PublicSettingsDto = {
  businessName: "CoolBreeze Home Services",
  tagline: null,
  logoKey: null,
  logoUrl: null,
  contactEmail: "hello@coolbreeze.test",
  phone: "(212) 555-0142",
  address: {
    line1: "48 Harbor Point Road",
    line2: null,
    city: "Harbor City",
    region: "NY",
    postalCode: "10999",
  },
  serviceAreaDescription: null,
  currencyCode: "USD",
  timeZone: "America/New_York",
};

beforeEach(() => {
  serverApiGetPublic.mockReset();
  serverApiGetPublic.mockResolvedValue(SETTINGS);
  vi.resetModules();
});

describe("getPublicSettings", () => {
  it("reads the public endpoint, which needs no sign-in and sends no cookies", async () => {
    const { getPublicSettings } = await import("./index");

    await expect(getPublicSettings()).resolves.toEqual(SETTINGS);
    expect(serverApiGetPublic).toHaveBeenCalledWith("/settings/public");
  });

  it("asks the API once per request, however many components need it", async () => {
    const { getBusinessFormatting, getPublicSettings } = await import("./index");

    await getPublicSettings();
    await getPublicSettings();
    await getBusinessFormatting();

    expect(serverApiGetPublic).toHaveBeenCalledTimes(1);
  });

  it("lets an API failure through, for the error boundary to show", async () => {
    serverApiGetPublic.mockRejectedValue(new Error("down"));
    const { getPublicSettings } = await import("./index");

    await expect(getPublicSettings()).rejects.toThrow("down");
  });
});

describe("getBusinessFormatting", () => {
  it("gives the time zone and currency that dates and money are shown in", async () => {
    const { getBusinessFormatting } = await import("./index");

    await expect(getBusinessFormatting()).resolves.toEqual({
      timeZone: "America/New_York",
      currencyCode: "USD",
    });
  });
});
