import { describe, expect, it } from "vitest";

import { generateToken, hashToken } from "./tokens.js";

const SECRET = "test-secret-0123456789abcdef0123456789";

describe("generateToken", () => {
  it("returns 32 random bytes as 43 URL-safe characters", () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));

    expect(tokens.size).toBe(500);
  });
});

describe("hashToken", () => {
  it("is a stable 64-character hex digest that does not contain the token", () => {
    const token = generateToken();
    const hash = hashToken(token, SECRET);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token, SECRET)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it("depends on the token and on the secret", () => {
    const token = generateToken();

    expect(hashToken(token, SECRET)).not.toBe(hashToken(generateToken(), SECRET));
    expect(hashToken(token, SECRET)).not.toBe(hashToken(token, `${SECRET}-other`));
  });

  it("matches a known HMAC-SHA-256 value", () => {
    // HMAC_SHA256(key="key", message="The quick brown fox jumps over the lazy dog")
    expect(hashToken("The quick brown fox jumps over the lazy dog", "key")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });
});
