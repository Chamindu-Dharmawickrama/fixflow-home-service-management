import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as password from "../../lib/password.js";
import { createLocalCustomer } from "../../test/auth-helpers.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createCustomer } from "../../test/fixtures.js";
import { api } from "../../test/http.js";

/**
 * F-23 (T25): a sign-in for an address with no password to check (no account, or a Google-only
 * account) must still spend the time of a password check, by verifying against a dummy hash, so the
 * response time does not reveal whether the address has an account (D-51). The statistical timing test
 * in `auth.local.int.test.ts` did not notice when the dummy check was removed; this one does, by
 * watching the call itself.
 */

vi.mock("../../lib/password.js", async (importOriginal) => {
  const original = await importOriginal<typeof password>();
  return { ...original, verifyAgainstDummyHash: vi.fn(original.verifyAgainstDummyHash) };
});

const prisma = getTestPrisma();
const KNOWN = "kim.known@example.test";
const GOOGLE_ONLY = "gale.google@example.test";

beforeAll(async () => {
  await resetDatabase(prisma);
  await createLocalCustomer(prisma, { email: KNOWN });
  await createCustomer(prisma, { email: GOOGLE_ONLY, passwordHash: null, googleSubject: "g-123" });
});

beforeEach(() => {
  vi.mocked(password.verifyAgainstDummyHash).mockClear();
});

afterAll(async () => {
  await disconnectTestPrisma();
});

function signIn(email: string, secret: string) {
  return api(buildTestApp({ prisma }).app)
    .post("/api/v1/auth/login")
    .send({ email, password: secret });
}

describe("signing in with a password", () => {
  it("checks the password against the dummy hash when the address has no account", async () => {
    const response = await signIn("nobody.here@example.test", "a guess at a password");

    expect(response.status).toBe(401);
    expect(password.verifyAgainstDummyHash).toHaveBeenCalledTimes(1);
    expect(password.verifyAgainstDummyHash).toHaveBeenCalledWith("a guess at a password");
  });

  it("does the same for an account that has no password (Google only)", async () => {
    const response = await signIn(GOOGLE_ONLY, "a guess at a password");

    expect(response.status).toBe(401);
    expect(password.verifyAgainstDummyHash).toHaveBeenCalledTimes(1);
  });

  it("checks the real hash, not the dummy one, when the account has a password", async () => {
    const wrong = await signIn(KNOWN, "not the right password at all");

    expect(wrong.status).toBe(401);
    expect(password.verifyAgainstDummyHash).not.toHaveBeenCalled();
  });
});
