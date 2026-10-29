import { describe, expect, it } from "vitest";

import { toAuthMeDto, toAuthUserDto } from "./auth.dto.js";

const USER = {
  id: "5b2c8f06-8a4e-4c52-9d51-6a1b7c2e0f11",
  name: "Alex Morgan",
  email: "alex.morgan@example.test",
  avatarUrl: null,
  role: "CUSTOMER",
  passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
  googleSubject: "108273645501",
} as const;

describe("toAuthUserDto", () => {
  it("exposes the person and two booleans, and no credential", () => {
    const dto = toAuthUserDto(USER);

    expect(dto).toEqual({
      id: USER.id,
      name: "Alex Morgan",
      email: "alex.morgan@example.test",
      avatarUrl: null,
      role: "CUSTOMER",
      hasPassword: true,
      hasGoogle: true,
    });
    const json = JSON.stringify(dto);
    expect(json).not.toContain("argon2");
    expect(json).not.toContain("108273645501");
    expect(json).not.toMatch(/passwordHash|googleSubject/);
  });

  it("reports a Google-only account as having no password, and a local one as having no Google", () => {
    expect(toAuthUserDto({ ...USER, passwordHash: null })).toMatchObject({
      hasPassword: false,
      hasGoogle: true,
    });
    expect(toAuthUserDto({ ...USER, googleSubject: null })).toMatchObject({
      hasPassword: true,
      hasGoogle: false,
    });
  });
});

describe("toAuthMeDto", () => {
  it("adds the customer record for a customer", () => {
    expect(toAuthMeDto(USER, { id: "c-1", phone: "(212) 555-0171" })).toMatchObject({
      customer: { id: "c-1", phone: "(212) 555-0171" },
    });
  });

  it("omits the customer key for an admin", () => {
    const dto = toAuthMeDto({ ...USER, role: "BUSINESS_ADMIN" }, null);

    expect(dto).not.toHaveProperty("customer");
    expect(dto.user.role).toBe("BUSINESS_ADMIN");
  });
});
