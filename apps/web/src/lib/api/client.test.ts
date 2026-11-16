import { afterEach, describe, expect, it, vi } from "vitest";

import { navigateWithFullReload } from "@/lib/auth/navigate";

import { apiFetch, apiFetchEnvelope } from "./client";
import { ApiError, describeWait, errorFromResponse, isApiError } from "./errors";

// jsdom cannot navigate; the test only needs to know where the page would have gone.
vi.mock("@/lib/auth/navigate", () => ({ navigateWithFullReload: vi.fn() }));

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** Stubs `fetch`. A function gives each call a fresh response (a body can only be read once); an error rejects. */
function stubFetch(outcome: Response | (() => Response) | { reject: Error }) {
  const fetchMock = vi.fn().mockImplementation(() => {
    if (typeof outcome === "function") return Promise.resolve(outcome());
    if (outcome instanceof Response) return Promise.resolve(outcome);
    return Promise.reject(outcome.reject);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("apiFetch", () => {
  it("calls the same-origin proxy with the session cookie and returns the data", async () => {
    const fetchMock = stubFetch(jsonResponse({ data: { user: { name: "Alex" } } }));

    const data = await apiFetch<{ user: { name: string } }>("/auth/me");

    expect(data).toEqual({ user: { name: "Alex" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/me",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("sends a JSON body with its content type, and none for a body-less request", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ data: {} }));

    await apiFetch("/auth/login", { method: "POST", body: { email: "a@b.co", password: "x" } });
    await apiFetch("/auth/logout", { method: "POST" });

    const [, withBody] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, withoutBody] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(withBody.body).toBe(JSON.stringify({ email: "a@b.co", password: "x" }));
    expect(withBody.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(withoutBody.body).toBeUndefined();
    expect(withoutBody.headers).not.toHaveProperty("Content-Type");
  });

  it("throws an ApiError carrying the code, field errors and request id from the error body", async () => {
    stubFetch(
      jsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "The request contains invalid values.",
            fieldErrors: { email: "Enter a valid email address." },
            requestId: "req-12345678",
          },
        },
        { status: 422 },
      ),
    );

    const error = await apiFetch("/auth/register", { method: "POST", body: {} }).catch(
      (caught: unknown) => caught,
    );

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      fieldErrors: { email: "Enter a valid email address." },
      requestId: "req-12345678",
    });
  });

  it("reads Retry-After from a 429", async () => {
    stubFetch(
      jsonResponse(
        { error: { code: "RATE_LIMITED", message: "Too many requests.", requestId: "r" } },
        { status: 429, headers: { "retry-after": "120", "content-type": "application/json" } },
      ),
    );

    const error = (await apiFetch("/auth/login", { method: "POST", body: {} }).catch(
      (caught: unknown) => caught,
    )) as ApiError;

    expect(error.retryAfterSeconds).toBe(120);
  });

  it("reports a failed fetch as NETWORK_ERROR, not as a crash", async () => {
    stubFetch({ reject: new TypeError("Failed to fetch") });

    const error = (await apiFetch("/auth/me").catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
    expect(error.message).toMatch(/couldn't reach the server/);
  });

  it("lets an abort through unchanged, so callers can ignore it", async () => {
    stubFetch({ reject: new DOMException("aborted", "AbortError") });

    await expect(apiFetch("/auth/me")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("turns a non-JSON error page into UNKNOWN_ERROR with a generic message", async () => {
    stubFetch(new Response("<html>Bad gateway</html>", { status: 502 }));

    const error = (await apiFetch("/auth/me").catch((caught: unknown) => caught)) as ApiError;

    expect(error).toMatchObject({ status: 502, code: "UNKNOWN_ERROR" });
    expect(error.message).not.toContain("Bad gateway");
  });

  it("turns a success response that is not the envelope into an error", async () => {
    stubFetch(new Response("not json", { status: 200 }));

    await expect(apiFetch("/auth/me")).rejects.toMatchObject({ code: "UNKNOWN_ERROR" });
  });

  it("turns a JSON body that is not an object into an error too", async () => {
    stubFetch(() => jsonResponse(null));
    await expect(apiFetch("/auth/me")).rejects.toMatchObject({ code: "UNKNOWN_ERROR" });

    stubFetch(() => jsonResponse("ok"));
    await expect(apiFetchEnvelope("/notifications/me")).rejects.toMatchObject({
      code: "UNKNOWN_ERROR",
    });
  });
});

describe("apiFetchEnvelope", () => {
  it("returns the whole body, so a list keeps its pagination and meta", async () => {
    const body = {
      data: [{ id: "n1" }],
      pagination: { page: 1, pageSize: 1, totalItems: 5, totalPages: 5 },
      meta: { unreadCount: 3 },
    };
    const fetchMock = stubFetch(jsonResponse(body));

    const result = await apiFetchEnvelope<typeof body>("/notifications/me?pageSize=1");

    expect(result).toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/notifications/me?pageSize=1",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("throws the same ApiError as apiFetch for an error response", async () => {
    stubFetch(
      jsonResponse(
        { error: { code: "UNAUTHENTICATED", message: "Sign in to continue.", requestId: "r-1" } },
        { status: 401 },
      ),
    );

    await expect(apiFetchEnvelope("/notifications/me")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
  });
});

describe("a session that ends in the middle of a signed-in page", () => {
  const unauthenticated = () =>
    jsonResponse(
      {
        error: { code: "UNAUTHENTICATED", message: "Authentication is required.", requestId: "r" },
      },
      { status: 401 },
    );

  afterEach(() => {
    vi.mocked(navigateWithFullReload).mockClear();
  });

  it("goes to sign-in, coming back to the same page and query afterwards, and still throws", async () => {
    window.history.replaceState(null, "", "/app/requests?status=SUBMITTED&page=2");
    stubFetch(unauthenticated);

    await expect(
      apiFetch("/admin/requests/abc/status", { method: "PATCH", body: {} }),
    ).rejects.toMatchObject({ status: 401 });

    expect(navigateWithFullReload).toHaveBeenCalledTimes(1);
    expect(navigateWithFullReload).toHaveBeenCalledWith(
      `/login?returnTo=${encodeURIComponent("/app/requests?status=SUBMITTED&page=2")}`,
    );
  });

  it("does the same in the portal and on the customers' request form", async () => {
    stubFetch(unauthenticated);
    for (const path of ["/portal/invoices/1", "/request-service"]) {
      window.history.replaceState(null, "", path);
      await expect(apiFetch("/requests", { method: "POST", body: {} })).rejects.toBeInstanceOf(
        ApiError,
      );
    }
    expect(vi.mocked(navigateWithFullReload).mock.calls).toEqual([
      [`/login?returnTo=${encodeURIComponent("/portal/invoices/1")}`],
      [`/login?returnTo=${encodeURIComponent("/request-service")}`],
    ]);
  });

  it("stays put for the auth routes (a wrong password is a 401), on public pages, and for other errors", async () => {
    window.history.replaceState(null, "", "/app/account");
    stubFetch(unauthenticated);
    await expect(apiFetch("/auth/password/change", { method: "POST" })).rejects.toBeDefined();
    window.history.replaceState(null, "", "/login");
    await expect(apiFetch("/auth/login", { method: "POST" })).rejects.toBeDefined();
    window.history.replaceState(null, "", "/services");
    await expect(apiFetch("/notifications/me")).rejects.toBeDefined();

    window.history.replaceState(null, "", "/app/requests");
    stubFetch(() =>
      jsonResponse(
        { error: { code: "FORBIDDEN", message: "No.", requestId: "r" } },
        { status: 403 },
      ),
    );
    await expect(apiFetch("/admin/requests")).rejects.toMatchObject({ status: 403 });

    expect(navigateWithFullReload).not.toHaveBeenCalled();
  });
});

describe("errorFromResponse", () => {
  it("falls back to the x-request-id header when the body has none", async () => {
    const error = await errorFromResponse(
      new Response("oops", { status: 500, headers: { "x-request-id": "abc-123-def" } }),
    );

    expect(error.requestId).toBe("abc-123-def");
  });
});

describe("describeWait", () => {
  it.each([
    [1, "a minute"],
    [60, "a minute"],
    [61, "2 minutes"],
    [900, "15 minutes"],
    [3600, "an hour"],
    [3601, "2 hours"],
  ])("describes %i seconds as %s", (seconds, text) => {
    expect(describeWait(seconds)).toBe(text);
  });
});
