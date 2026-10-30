import { describe, expect, it } from "vitest";

import { protectionRedirect } from "@/lib/auth/paths";

import { REQUEST_SERVICE_PATH, requestServiceHref, SERVICE_PARAM } from "./request-service";

describe("requestServiceHref (T11, D-88)", () => {
  it("leads straight to the request form", () => {
    expect(requestServiceHref()).toBe("/request-service");
    expect(requestServiceHref("")).toBe("/request-service");
    expect(REQUEST_SERVICE_PATH).toBe("/request-service");
  });

  it("opens the form with the service chosen", () => {
    expect(requestServiceHref("ac-routine-maintenance")).toBe(
      "/request-service?service=ac-routine-maintenance",
    );
    expect(SERVICE_PARAM).toBe("service");
  });

  it("encodes a slug, so it can never add a second parameter or leave the page", () => {
    expect(requestServiceHref("a&b=c")).toBe("/request-service?service=a%26b%3Dc");
    expect(requestServiceHref("../login")).toBe("/request-service?service=..%2Flogin");
  });

  it("is never the old detour through the portal", () => {
    expect(requestServiceHref()).not.toContain("login");
    expect(requestServiceHref("x")).not.toContain("portal");
  });

  it("sends a visitor without an account to sign-in and back, keeping the service (spec §7.1 step 3)", () => {
    const [path, search] = requestServiceHref("ac-routine-maintenance").split("?");

    const redirect = protectionRedirect({
      pathname: path ?? "",
      search: `?${search ?? ""}`,
      hasSessionCookie: false,
    });

    expect(redirect).toBe("/login?returnTo=%2Frequest-service%3Fservice%3Dac-routine-maintenance");
  });
});
