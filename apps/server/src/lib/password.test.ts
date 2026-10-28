import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.js";

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
