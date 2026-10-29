import {
  type GoogleIdentity,
  type GoogleIdTokenVerifier,
  InvalidGoogleCredentialError,
} from "../modules/auth/google-verifier.js";
import type { EmailMessage, EmailSender, EmailSendResult } from "../modules/email/email.types.js";

/** Remembers every email instead of delivering it, so tests can read the reset link. */
export class RecordingEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  /** Set to make the next sends fail, as an unreachable SMTP server would. */
  failWith: Error | undefined;

  send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.failWith !== undefined) {
      return Promise.reject(this.failWith);
    }
    this.sent.push(message);
    return Promise.resolve({ status: "LOGGED", transport: "log" });
  }

  get last(): EmailMessage | undefined {
    return this.sent[this.sent.length - 1];
  }

  /** The first URL in the most recent email's text body. */
  lastLink(): string | undefined {
    return this.last?.text.match(/https?:\/\/\S+/)?.[0];
  }

  /** The `token` query parameter of the most recent email's link. */
  lastResetToken(): string | undefined {
    const link = this.lastLink();
    return link === undefined ? undefined : (new URL(link).searchParams.get("token") ?? undefined);
  }
}

/** Accepts only the credentials a test registers, like Google would accept only genuine tokens. */
export class FakeGoogleVerifier implements GoogleIdTokenVerifier {
  private readonly identities = new Map<string, GoogleIdentity>();

  /** Makes `credential` verify as `identity`. */
  accept(credential: string, identity: Partial<GoogleIdentity> & { email: string }): string {
    this.identities.set(credential, {
      subject: `google-sub-${credential}`,
      emailVerified: true,
      name: "Google Person",
      pictureUrl: null,
      ...identity,
    });
    return credential;
  }

  verify(credential: string): Promise<GoogleIdentity> {
    const identity = this.identities.get(credential);
    return identity === undefined
      ? Promise.reject(new InvalidGoogleCredentialError())
      : Promise.resolve(identity);
  }
}
