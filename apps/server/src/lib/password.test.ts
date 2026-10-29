import { describe, expect, it } from "vitest";

import {
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_POLICY_MESSAGES,
  passwordPolicyMessage,
  verifyAgainstDummyHash,
  verifyPassword,
} from "./password.js";

describe("hashPassword", () => {
  it("produces an Argon2id PHC string with the configured cost", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("never contains the password", async () => {
    const hash = await hashPassword("a-very-recognisable-password");

    expect(hash).not.toContain("recognisable");
  });

  it("salts every hash, so equal passwords give different hashes", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password"),
    ]);

    expect(first).not.toBe(second);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("right-password-1");

    await expect(verifyPassword("right-password-1", hash)).resolves.toBe(true);
    await expect(verifyPassword("right-password-2", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("is case sensitive and handles non-ASCII passwords", async () => {
    const hash = await hashPassword("Pässwörd-日本語-🔑");

    await expect(verifyPassword("Pässwörd-日本語-🔑", hash)).resolves.toBe(true);
    await expect(verifyPassword("pässwörd-日本語-🔑", hash)).resolves.toBe(false);
  });

  it.each([
    "",
    "not-a-hash",
    "$argon2id$garbage",
    "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012",
  ])("treats the malformed or foreign hash %j as no match instead of throwing", async (badHash) => {
    await expect(verifyPassword("anything-at-all", badHash)).resolves.toBe(false);
  });
});

describe("verifyAgainstDummyHash", () => {
  it("never matches, whatever the password, and does not throw", async () => {
    await expect(verifyAgainstDummyHash("anything-at-all")).resolves.toBe(false);
    await expect(verifyAgainstDummyHash("")).resolves.toBe(false);
  });

  it("costs about as much as verifying a real hash", async () => {
    const real = await hashPassword("a-real-password-1");
    await verifyAgainstDummyHash("warm-up");

    const time = async (run: () => Promise<unknown>): Promise<number> => {
      const start = performance.now();
      await run();
      return performance.now() - start;
    };
    const realMs = await time(() => verifyPassword("a-wrong-password-1", real));
    const dummyMs = await time(() => verifyAgainstDummyHash("a-wrong-password-1"));

    // Same algorithm and parameters: well within a factor of 4 either way (not a timing benchmark).
    expect(dummyMs).toBeGreaterThan(realMs / 4);
    expect(dummyMs).toBeLessThan(realMs * 4);
  });
});

describe("checkPasswordPolicy", () => {
  it("accepts 10 to 128 characters with no composition rules", () => {
    expect(checkPasswordPolicy("x".repeat(10))).toBeUndefined();
    expect(checkPasswordPolicy("long enough pass phrase here")).toBeUndefined();
    expect(checkPasswordPolicy("q".repeat(128))).toBeUndefined();
  });

  it("rejects fewer than 10 characters", () => {
    expect(checkPasswordPolicy("abc123XYZ")).toBe("TOO_SHORT");
    expect(checkPasswordPolicy("")).toBe("TOO_SHORT");
  });

  it("rejects more than 128 characters", () => {
    expect(checkPasswordPolicy("q".repeat(129))).toBe("TOO_LONG");
  });

  it("rejects the account's own email address, in any case", () => {
    expect(
      checkPasswordPolicy("Alex.Morgan@Example.Test", { email: "alex.morgan@example.test" }),
    ).toBe("SAME_AS_EMAIL");
    expect(checkPasswordPolicy("alex.morgan@example.test")).toBeUndefined();
  });

  it.each([
    "password123",
    "Password123!",
    "QWERTYUIOP",
    "1234567890",
    "let-me-in 123",
    "I Love You 123",
  ])("rejects the common password %j and trivial variations of it", (password) => {
    expect(checkPasswordPolicy(password)).toBe("TOO_COMMON");
  });

  it("reports the first violation in a fixed order", () => {
    expect(checkPasswordPolicy("pass", { email: "pass" })).toBe("TOO_SHORT");
  });
});

describe("passwordPolicyMessage", () => {
  it("returns a plain-language message, or nothing for an acceptable password", () => {
    expect(passwordPolicyMessage("short")).toBe(PASSWORD_POLICY_MESSAGES.TOO_SHORT);
    expect(passwordPolicyMessage("a calm, unusual passphrase")).toBeUndefined();
  });

  it("explains each violation without echoing the password", () => {
    for (const message of Object.values(PASSWORD_POLICY_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
    }
  });
});
