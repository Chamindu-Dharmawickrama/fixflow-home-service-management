import { describe, expect, it } from "vitest";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import {
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  googleBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
} from "./auth.schemas.js";

const GOOD_PASSWORD = "violet teapot sails home";

const validRegistration = {
  name: "  Alex Morgan ",
  email: "  Alex.Morgan@Example.Test ",
  password: GOOD_PASSWORD,
  passwordConfirmation: GOOD_PASSWORD,
  acceptTerms: true,
};

function errorsOf(result: ReturnType<typeof registerBodySchema.safeParse>): Record<string, string> {
  return result.success ? {} : fieldErrorsFromZod(result.error);
}

describe("registerBodySchema", () => {
  it("normalizes the name and email and keeps the password exactly as typed", () => {
    const result = registerBodySchema.safeParse({
      ...validRegistration,
      password: ` ${GOOD_PASSWORD} `,
      passwordConfirmation: ` ${GOOD_PASSWORD} `,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: "Alex Morgan",
      email: "alex.morgan@example.test",
      password: ` ${GOOD_PASSWORD} `,
      acceptTerms: true,
    });
  });

  it("rejects unknown keys, including role and ids (FR-014)", () => {
    for (const extra of [{ role: "BUSINESS_ADMIN" }, { userId: "u1" }, { customerId: "c1" }]) {
      const errors = errorsOf(registerBodySchema.safeParse({ ...validRegistration, ...extra }));
      expect(Object.values(errors)).toContain("Unknown field.");
    }
  });

  it("rejects passwords that do not match, on the confirmation field", () => {
    const errors = errorsOf(
      registerBodySchema.safeParse({
        ...validRegistration,
        passwordConfirmation: "something else entirely",
      }),
    );

    expect(errors).toEqual({ passwordConfirmation: "The two passwords don't match." });
  });

  it.each([
    ["too short", "short1", "Use at least 10 characters."],
    [
      "too common",
      "Password123!",
      "That password is too common. Choose something harder to guess.",
    ],
    [
      "the email address",
      "alex.morgan@example.test",
      "Your password can't be the same as your email address.",
    ],
  ])("rejects a password that is %s, on the password field", (_label, password, message) => {
    const errors = errorsOf(
      registerBodySchema.safeParse({
        ...validRegistration,
        password,
        passwordConfirmation: password,
      }),
    );

    expect(errors.password).toBe(message);
  });

  it("requires the terms to be accepted", () => {
    for (const acceptTerms of [false, undefined, "true", 1]) {
      const errors = errorsOf(registerBodySchema.safeParse({ ...validRegistration, acceptTerms }));
      expect(errors.acceptTerms).toBe("You need to accept the terms and privacy notice.");
    }
  });

  it("rejects a missing or malformed name and email with a message for each", () => {
    const errors = errorsOf(
      registerBodySchema.safeParse({ ...validRegistration, name: "A", email: "not-an-email" }),
    );

    expect(errors.name).toBe("Enter your full name.");
    expect(errors.email).toBe("Enter a valid email address, like name@example.com.");
  });

  it("limits the lengths so a huge body cannot reach the hasher", () => {
    const huge = "x".repeat(2000);

    expect(
      errorsOf(registerBodySchema.safeParse({ ...validRegistration, name: huge })).name,
    ).toBeDefined();
    expect(
      errorsOf(
        registerBodySchema.safeParse({
          ...validRegistration,
          password: huge,
          passwordConfirmation: huge,
        }),
      ).password,
    ).toBe("That password is too long.");
  });
});

describe("loginBodySchema", () => {
  it("normalizes the email and accepts any password text", () => {
    expect(loginBodySchema.parse({ email: " Alex@Example.Test ", password: "x" })).toEqual({
      email: "alex@example.test",
      password: "x",
    });
  });

  it("does not check the email's format, so a malformed address fails like an unknown one", () => {
    expect(loginBodySchema.safeParse({ email: "nobody", password: "x" }).success).toBe(true);
  });

  it("requires both fields and rejects unknown keys", () => {
    expect(loginBodySchema.safeParse({ email: "", password: "x" }).success).toBe(false);
    expect(loginBodySchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginBodySchema.safeParse({ email: "a@b.co", password: "x", role: "x" }).success).toBe(
      false,
    );
  });
});

describe("googleBodySchema", () => {
  it("takes one credential string and nothing else", () => {
    expect(googleBodySchema.safeParse({ credential: "eyJhbGciOi.payload.signature" }).success).toBe(
      true,
    );
    expect(googleBodySchema.safeParse({ credential: "" }).success).toBe(false);
    expect(googleBodySchema.safeParse({ credential: "x", role: "BUSINESS_ADMIN" }).success).toBe(
      false,
    );
  });
});

describe("forgotPasswordBodySchema", () => {
  it("requires a valid email, normalized", () => {
    expect(forgotPasswordBodySchema.parse({ email: " A@B.co " })).toEqual({ email: "a@b.co" });
    expect(forgotPasswordBodySchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(forgotPasswordBodySchema.safeParse({ email: "a@b.co", extra: 1 }).success).toBe(false);
  });
});

describe("resetPasswordBodySchema", () => {
  const valid = { token: "abc", password: GOOD_PASSWORD, passwordConfirmation: GOOD_PASSWORD };

  it("accepts a token with a matching, acceptable password", () => {
    expect(resetPasswordBodySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a mismatch, a weak password and an unknown key", () => {
    const mismatch = resetPasswordBodySchema.safeParse({ ...valid, passwordConfirmation: "other" });
    const weak = resetPasswordBodySchema.safeParse({
      ...valid,
      password: "short",
      passwordConfirmation: "short",
    });

    expect(mismatch.success ? {} : fieldErrorsFromZod(mismatch.error)).toEqual({
      passwordConfirmation: "The two passwords don't match.",
    });
    expect(weak.success ? {} : fieldErrorsFromZod(weak.error).password).toBe(
      "Use at least 10 characters.",
    );
    expect(resetPasswordBodySchema.safeParse({ ...valid, userId: "u1" }).success).toBe(false);
  });
});

describe("changePasswordBodySchema", () => {
  const valid = {
    currentPassword: "the old one",
    newPassword: GOOD_PASSWORD,
    newPasswordConfirmation: GOOD_PASSWORD,
  };

  it("accepts a current password and a matching, acceptable new one", () => {
    expect(changePasswordBodySchema.safeParse(valid).success).toBe(true);
  });

  it("reports problems on the new password fields", () => {
    const result = changePasswordBodySchema.safeParse({
      ...valid,
      newPassword: "short",
      newPasswordConfirmation: "different",
    });

    expect(result.success ? {} : fieldErrorsFromZod(result.error)).toEqual({
      newPassword: "Use at least 10 characters.",
      newPasswordConfirmation: "The two passwords don't match.",
    });
  });
});
