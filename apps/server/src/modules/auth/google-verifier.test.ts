import { describe, expect, it, vi } from "vitest";

import {
  createGoogleIdTokenVerifier,
  GoogleSignInNotConfiguredError,
  type GoogleTokenPayload,
  type IdTokenClient,
  InvalidGoogleCredentialError,
} from "./google-verifier.js";

const CLIENT_ID = "1234567890-abcdef.apps.googleusercontent.com";
const NOW = new Date("2026-10-28T12:00:00.000Z");
const FUTURE = Math.floor(NOW.getTime() / 1000) + 3600;
const PAST = Math.floor(NOW.getTime() / 1000) - 60;

type Payload = GoogleTokenPayload;

function clientReturning(payload: Payload | undefined): {
  client: IdTokenClient;
  verifyIdToken: ReturnType<typeof vi.fn>;
} {
  const verifyIdToken = vi.fn().mockResolvedValue({ getPayload: () => payload });
  return { client: { verifyIdToken }, verifyIdToken };
}

const GOOD_PAYLOAD: Payload = {
  sub: "108273645501",
  iss: "https://accounts.google.com",
  exp: FUTURE,
  email: "Alex.Morgan@Example.Test",
  email_verified: true,
  name: "Alex Morgan",
  picture: "https://lh3.googleusercontent.com/a/photo",
};

function verifierFor(payload: Payload | undefined) {
  const { client, verifyIdToken } = clientReturning(payload);
  const verifier = createGoogleIdTokenVerifier(CLIENT_ID, { client, now: () => NOW });
  return { verifier, verifyIdToken };
}

describe("createGoogleIdTokenVerifier", () => {
  it("returns the identity from a valid token, asking Google's library to check our audience", async () => {
    const { verifier, verifyIdToken } = verifierFor(GOOD_PAYLOAD);

    await expect(verifier.verify("the-credential")).resolves.toEqual({
      subject: "108273645501",
      email: "Alex.Morgan@Example.Test",
      emailVerified: true,
      name: "Alex Morgan",
      pictureUrl: "https://lh3.googleusercontent.com/a/photo",
    });
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: "the-credential", audience: CLIENT_ID });
  });

  it("accepts both spellings of Google's issuer", async () => {
    for (const iss of ["accounts.google.com", "https://accounts.google.com"]) {
      const { verifier } = verifierFor({ ...GOOD_PAYLOAD, iss });
      await expect(verifier.verify("c")).resolves.toMatchObject({ subject: "108273645501" });
    }
  });

  it("reports an unverified email as such, leaving the decision to the caller", async () => {
    const { verifier } = verifierFor({ ...GOOD_PAYLOAD, email_verified: false });
    await expect(verifier.verify("c")).resolves.toMatchObject({ emailVerified: false });

    const { verifier: missing } = verifierFor({ ...GOOD_PAYLOAD, email_verified: undefined });
    await expect(missing.verify("c")).resolves.toMatchObject({ emailVerified: false });
  });

  it.each([
    ["another issuer", { iss: "https://accounts.evil.example" }],
    ["no issuer", { iss: undefined }],
    ["an expired token", { exp: PAST }],
    ["no expiry", { exp: undefined }],
    ["no subject", { sub: undefined }],
    ["an empty subject", { sub: "" }],
    ["no email", { email: undefined }],
  ])("rejects %s", async (_label, change) => {
    const { verifier } = verifierFor({ ...GOOD_PAYLOAD, ...change });

    await expect(verifier.verify("c")).rejects.toBeInstanceOf(InvalidGoogleCredentialError);
  });

  it("rejects a token with no payload", async () => {
    const { verifier } = verifierFor(undefined);

    await expect(verifier.verify("c")).rejects.toBeInstanceOf(InvalidGoogleCredentialError);
  });

  it("turns any failure of the library (bad signature, wrong audience) into one generic error", async () => {
    const client: IdTokenClient = {
      verifyIdToken: vi
        .fn()
        .mockRejectedValue(new Error("Wrong recipient, payload audience != requiredAudience")),
    };
    const verifier = createGoogleIdTokenVerifier(CLIENT_ID, { client, now: () => NOW });

    const error = await verifier.verify("c").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidGoogleCredentialError);
    expect((error as Error).message).not.toMatch(/audience|recipient/i);
  });

  it("falls back to the given name or the email's local part when there is no display name", async () => {
    const { verifier: given } = verifierFor({
      ...GOOD_PAYLOAD,
      name: undefined,
      given_name: "Alex",
    });
    const { verifier: bare } = verifierFor({ ...GOOD_PAYLOAD, name: undefined });

    await expect(given.verify("c")).resolves.toMatchObject({ name: "Alex" });
    await expect(bare.verify("c")).resolves.toMatchObject({ name: "Alex.Morgan" });
  });

  it("reports that Google sign-in is not set up when there is no client ID", async () => {
    const verifier = createGoogleIdTokenVerifier(undefined);

    await expect(verifier.verify("c")).rejects.toBeInstanceOf(GoogleSignInNotConfiguredError);
  });
});
