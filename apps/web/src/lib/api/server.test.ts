import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieString = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ toString: cookieString }),
}));

import { ApiError } from "./errors";
import { serverApiGet, serverApiGetEnvelope, serverApiGetPublic } from "./server";

const fetchMock = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  cookieString.mockReset().mockReturnValue("fixflow_session=abc");
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_INTERNAL_URL", "http://api.internal:4000/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function lastRequest(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init };
}

describe("serverApiGet", () => {
  it("calls the API directly, forwards the visitor's cookie, and returns the envelope's data", async () => {
    fetchMock.mockResolvedValue(json({ data: { name: "AC" } }));

    await expect(serverApiGet("/admin/services/1")).resolves.toEqual({ name: "AC" });

    const { url, init } = lastRequest();
    expect(url).toBe("http://api.internal:4000/api/v1/admin/services/1");
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toMatchObject({
      Cookie: "fixflow_session=abc",
      Accept: "application/json",
    });
  });

  it("sends no Cookie header when the visitor has none", async () => {
    cookieString.mockReturnValue("");
    fetchMock.mockResolvedValue(json({ data: 1 }));

    await serverApiGet("/auth/me");

    expect(lastRequest().init.headers).not.toHaveProperty("Cookie");
  });

  it("throws the API's error with its code, status and request id", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: "NOT_FOUND", message: "Gone.", requestId: "req-1" } }, 404),
    );

    await expect(serverApiGet("/admin/services/1")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      requestId: "req-1",
    });
  });

  it("turns an unreachable API into a NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const error = await serverApiGet("/auth/me").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});

describe("serverApiGetEnvelope", () => {
  it("returns the whole body, so a list keeps its pagination and meta", async () => {
    const body = {
      data: [{ id: "1" }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      meta: { counts: { all: 1 } },
    };
    fetchMock.mockResolvedValue(json(body));

    await expect(serverApiGetEnvelope("/admin/services?page=1")).resolves.toEqual(body);

    expect(lastRequest().url).toBe("http://api.internal:4000/api/v1/admin/services?page=1");
    expect(lastRequest().init.headers).toMatchObject({ Cookie: "fixflow_session=abc" });
  });
});

describe("serverApiGetPublic", () => {
  it("never sends the visitor's cookies to a public endpoint", async () => {
    fetchMock.mockResolvedValue(json({ data: { businessName: "CoolBreeze" } }));

    await expect(serverApiGetPublic("/settings/public")).resolves.toEqual({
      businessName: "CoolBreeze",
    });

    expect(lastRequest().url).toBe("http://api.internal:4000/api/v1/settings/public");
    expect(lastRequest().init.headers).not.toHaveProperty("Cookie");
    expect(cookieString).not.toHaveBeenCalled();
  });

  it("throws the API's error", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: "SERVICE_UNAVAILABLE", message: "Not set up.", requestId: "r" } }, 503),
    );

    await expect(serverApiGetPublic("/settings/public")).rejects.toMatchObject({ status: 503 });
  });
});
