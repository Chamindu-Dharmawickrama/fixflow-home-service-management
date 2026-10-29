import type { PublicServiceDto, PublicSettingsDto } from "@fixflow/shared";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { ApiError } from "@/lib/api";

import { getActiveServices, getSiteSettings } from "./public-data";

const { cacheLife, serverApiGetPublic } = vi.hoisted(() => ({
  cacheLife: vi.fn<(profile: unknown) => void>(),
  serverApiGetPublic:
    vi.fn<(route: string, options?: { timeoutMs?: number }) => Promise<unknown>>(),
}));

vi.mock("next/cache", () => ({ cacheLife }));
vi.mock("@/lib/api/server", () => ({ serverApiGetPublic }));

const SETTINGS = { businessName: "CoolBreeze Home Services" } as PublicSettingsDto;
const SERVICES = [{ slug: "ac-routine-maintenance" }] as PublicServiceDto[];

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  cacheLife.mockReset();
  serverApiGetPublic.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllEnvs();
});

describe("the public website's reads of the API (D-87)", () => {
  it("returns the business settings and remembers them for the revalidation time", async () => {
    serverApiGetPublic.mockResolvedValue(SETTINGS);

    await expect(getSiteSettings()).resolves.toEqual({ status: "ok", data: SETTINGS });

    expect(serverApiGetPublic.mock.calls[0]?.[0]).toBe("/settings/public");
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith({ stale: 60, revalidate: 60, expire: 600 });
  });

  it("returns the active services from the public list endpoint", async () => {
    serverApiGetPublic.mockResolvedValue(SERVICES);

    await expect(getActiveServices()).resolves.toEqual({ status: "ok", data: SERVICES });
    expect(serverApiGetPublic.mock.calls[0]?.[0]).toBe("/services");
  });

  it("takes the revalidation time from PUBLIC_REVALIDATE_SECONDS", async () => {
    vi.stubEnv("PUBLIC_REVALIDATE_SECONDS", "2");
    serverApiGetPublic.mockResolvedValue(SETTINGS);

    await getSiteSettings();

    expect(cacheLife).toHaveBeenCalledExactlyOnceWith({ stale: 30, revalidate: 2, expire: 300 });
  });

  it("limits how long a request to the API may take", async () => {
    serverApiGetPublic.mockResolvedValue(SETTINGS);

    await getSiteSettings();

    const options = serverApiGetPublic.mock.calls[0]?.[1];
    expect(options?.timeoutMs).toBeGreaterThan(0);
    expect(options?.timeoutMs).toBeLessThanOrEqual(10_000);
  });

  it("reports an unreachable API as unavailable instead of throwing, and remembers that only briefly", async () => {
    serverApiGetPublic.mockRejectedValue(
      new ApiError({ status: 0, code: "NETWORK_ERROR", message: "We couldn't reach the server." }),
    );

    await expect(getSiteSettings()).resolves.toEqual({ status: "unavailable" });
    await expect(getActiveServices()).resolves.toEqual({ status: "unavailable" });

    expect(cacheLife).toHaveBeenCalledTimes(2);
    expect(cacheLife).toHaveBeenNthCalledWith(1, { stale: 30, revalidate: 10, expire: 300 });
  });

  it("treats an error response and a surprise the same way", async () => {
    serverApiGetPublic.mockRejectedValueOnce(
      new ApiError({ status: 503, code: "SERVICE_UNAVAILABLE", message: "Database is down." }),
    );
    serverApiGetPublic.mockRejectedValueOnce(new TypeError("boom"));

    await expect(getSiteSettings()).resolves.toEqual({ status: "unavailable" });
    await expect(getActiveServices()).resolves.toEqual({ status: "unavailable" });
  });

  it("logs which route was unavailable and why, without the error's own message", async () => {
    serverApiGetPublic.mockRejectedValue(
      new ApiError({
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "connect ECONNREFUSED 10.0.0.5:5432 password=hunter2",
      }),
    );

    await getSiteSettings();

    expect(warn).toHaveBeenCalledOnce();
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("/settings/public");
    expect(line).toContain("SERVICE_UNAVAILABLE");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("10.0.0.5");
  });
});
