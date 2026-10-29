import { describe, expect, it } from "vitest";

import { requestServiceHref } from "./request-service";

describe("requestServiceHref (D-88)", () => {
  it("leads to sign-in and then the customer portal until the request form exists (T11)", () => {
    expect(requestServiceHref()).toBe("/login?returnTo=%2Fportal");
  });

  it("is the same for a particular service, because the form that would use it does not exist yet", () => {
    expect(requestServiceHref("ac-routine-maintenance")).toBe(requestServiceHref());
  });

  it("is never a link to a page that does not exist", () => {
    expect(requestServiceHref()).not.toContain("/request-service");
  });
});
