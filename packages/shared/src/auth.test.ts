import { describe, expect, it } from "vitest";

import { ROLE_HOME_PATH } from "./auth.js";
import { Role } from "./enums.js";
import * as shared from "./index.js";
import { LIMITS } from "./limits.js";

describe("ROLE_HOME_PATH", () => {
  it("has a home page for every role and nothing else", () => {
    expect(Object.keys(ROLE_HOME_PATH).sort()).toEqual(Object.values(Role).sort());
  });

  it("sends an admin to the dashboard and a customer to the portal", () => {
    expect(ROLE_HOME_PATH.BUSINESS_ADMIN).toBe("/app/dashboard");
    expect(ROLE_HOME_PATH.CUSTOMER).toBe("/portal");
  });

  it("keeps each role inside its own area, so a home page is never a no-access page", () => {
    expect(ROLE_HOME_PATH.BUSINESS_ADMIN.startsWith("/app/")).toBe(true);
    expect(ROLE_HOME_PATH.CUSTOMER.startsWith("/portal")).toBe(true);
  });

  it("is re-exported from the package entry point", () => {
    expect(shared.ROLE_HOME_PATH).toBe(ROLE_HOME_PATH);
  });
});

describe("authentication limits", () => {
  it("fixes the password policy of D-51: 10 to 128 characters", () => {
    expect(LIMITS.password).toEqual({ minLength: 10, maxLength: 128 });
  });

  it("keeps every min below its max", () => {
    expect(LIMITS.password.minLength).toBeLessThan(LIMITS.password.maxLength);
    expect(LIMITS.personName.minLength).toBeLessThan(LIMITS.personName.maxLength);
  });

  it("uses the longest valid email address (RFC 5321)", () => {
    expect(LIMITS.email.maxLength).toBe(254);
  });
});
