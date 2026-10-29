import { OAuth2Client } from "google-auth-library";

/** What the API needs to know about a verified Google sign-in. */
export interface GoogleIdentity {
  /** Google's stable account id (`sub`); unlike the email, it never changes. */
  subject: string;
  /** As Google reports it; the caller normalizes it. */
  email: string;
  emailVerified: boolean;
  name: string;
  pictureUrl: string | null;
}

/**
 * Turns the ID token (the "credential") that Google Identity Services gives the browser into a
 * verified identity. Injectable, so tests use a fake and never call Google.
 */
export interface GoogleIdTokenVerifier {
  /** Throws {@link InvalidGoogleCredentialError} for a token that is not valid for this app. */
  verify(credential: string): Promise<GoogleIdentity>;
}

export class InvalidGoogleCredentialError extends Error {
  constructor(message = "The Google credential could not be verified.", options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidGoogleCredentialError";
  }
}

/** Google sign-in is not set up on this server (`GOOGLE_CLIENT_ID` is missing). */
export class GoogleSignInNotConfiguredError extends Error {
  constructor() {
    super("Google sign-in is not configured.");
    this.name = "GoogleSignInNotConfiguredError";
  }
}

/** The two spellings of Google's issuer that appear in ID tokens. */
const GOOGLE_ISSUERS: readonly string[] = ["accounts.google.com", "https://accounts.google.com"];

/** The claims of a Google ID token that the verifier reads. All are optional: it checks each one. */
export interface GoogleTokenPayload {
  sub?: string | undefined;
  iss?: string | undefined;
  exp?: number | undefined;
  email?: string | undefined;
  email_verified?: boolean | undefined;
  name?: string | undefined;
  given_name?: string | undefined;
  picture?: string | undefined;
}

/** The part of `OAuth2Client` the verifier uses; tests pass a fake. */
export interface IdTokenClient {
  verifyIdToken(options: {
    idToken: string;
    audience: string;
  }): Promise<{ getPayload(): GoogleTokenPayload | undefined }>;
}

/**
 * The real verifier, built on `google-auth-library`. It checks the signature against Google's
 * published keys, the audience (our OAuth client ID), the issuer and the expiry; the caller checks
 * `emailVerified`. Anything that goes wrong is reported as one generic invalid-credential error:
 * the reason is useful in logs, not to whoever sent the token.
 */
export function createGoogleIdTokenVerifier(
  clientId: string | undefined,
  options: { client?: IdTokenClient; now?: () => Date } = {},
): GoogleIdTokenVerifier {
  if (clientId === undefined) {
    return {
      verify: () => Promise.reject(new GoogleSignInNotConfiguredError()),
    };
  }
  const client: IdTokenClient = options.client ?? new OAuth2Client(clientId);
  const now = options.now ?? (() => new Date());

  return {
    async verify(credential) {
      let payload;
      try {
        const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
        payload = ticket.getPayload();
      } catch (error) {
        throw new InvalidGoogleCredentialError(undefined, { cause: error });
      }

      if (
        payload === undefined ||
        typeof payload.sub !== "string" ||
        payload.sub === "" ||
        typeof payload.email !== "string" ||
        payload.email === "" ||
        payload.iss === undefined ||
        !GOOGLE_ISSUERS.includes(payload.iss) ||
        typeof payload.exp !== "number" ||
        payload.exp * 1000 <= now().getTime()
      ) {
        throw new InvalidGoogleCredentialError();
      }

      return {
        subject: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        name: payload.name ?? payload.given_name ?? payload.email.split("@")[0] ?? payload.email,
        pictureUrl: payload.picture ?? null,
      };
    },
  };
}
