import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../config/env.js";
import type { EmailSender, EmailSendResult } from "./email.types.js";
import { parseEmailTestArgs, runEmailTest } from "./email-test.js";

const NOW = new Date("2026-10-29T15:30:00.000Z");

const SMTP_ENV = {
  EMAIL_TRANSPORT: "smtp",
  EMAIL_FROM: "FixFlow <hello@coolbreeze.example>",
  SMTP_HOST: "smtp.mail.example.net",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "mailer",
  SMTP_PASSWORD: "super-secret-smtp-password",
};

function senderReturning(result: EmailSendResult | Error) {
  const send = vi.fn((): Promise<EmailSendResult> =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  const close = vi.fn();
  const sender: EmailSender = { send, close };
  return { sender, send, close };
}

describe("parseEmailTestArgs", () => {
  it("reads --to with a separate value or an equals sign", () => {
    expect(parseEmailTestArgs(["--to", "me@gmail.com"])).toEqual({ to: "me@gmail.com" });
    expect(parseEmailTestArgs(["--to=me@gmail.com"])).toEqual({ to: "me@gmail.com" });
    expect(parseEmailTestArgs(["--to", "  me@gmail.com "])).toEqual({ to: "me@gmail.com" });
  });

  it("asks for the recipient and rejects anything else", () => {
    /** The error message for these arguments, or `undefined` if they were accepted. */
    const errorFor = (argv: string[]): string | undefined => {
      const parsed = parseEmailTestArgs(argv);
      return "error" in parsed ? parsed.error : undefined;
    };

    expect(errorFor([])).toContain("Missing the recipient");
    expect(errorFor(["--to"])).toContain("Missing the recipient");
    expect(errorFor(["--to", ""])).toContain("Missing the recipient");
    expect(errorFor(["--cc", "x@y.co"])).toContain('Unknown argument "--cc"');
  });
});

describe("runEmailTest", () => {
  const config = loadConfig(SMTP_ENV);

  it("sends one message and reports that the server accepted it, not that it arrived", async () => {
    const { sender, send, close } = senderReturning({ status: "SENT", transport: "smtp" });

    const result = await runEmailTest({ config, to: "owner@coolbreeze.co.uk", now: NOW, sender });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("accepted the message for o***@coolbreeze.co.uk");
    expect(result.message).toContain("to confirm it arrived");
    expect(result.message).not.toContain("owner@");
    expect(send).toHaveBeenCalledOnce();
    const message = send.mock.calls[0] as unknown as [
      { to: string; subject: string; text: string },
    ];
    expect(message[0].to).toBe("owner@coolbreeze.co.uk");
    expect(message[0].subject).toBe("FixFlow email test");
    expect(message[0].text).toContain("Thu, Oct 29, 2026, 3:30 PM UTC");
    expect(close).toHaveBeenCalledOnce();
  });

  it("says plainly when the server refuses, and never prints the SMTP password", async () => {
    const { sender, close } = senderReturning(
      Object.assign(new Error("Invalid login: 535 5.7.8 Authentication failed"), { code: "EAUTH" }),
    );

    const result = await runEmailTest({ config, to: "owner@coolbreeze.co.uk", now: NOW, sender });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("EAUTH");
    expect(result.message).toContain("did not accept");
    expect(result.message).not.toContain("super-secret-smtp-password");
    expect(close).toHaveBeenCalledOnce();
  });

  it("refuses to run in production", async () => {
    const production = loadConfig({
      NODE_ENV: "production",
      WEB_ORIGIN: "https://fixflow.example.com",
      DATABASE_URL: "postgresql://app:pw@db.example.com:5432/fixflow",
      SESSION_SECRET: "session-secret-for-tests-0123456789abcdef",
      UPSTASH_REDIS_REST_URL: "https://eu1-example-12345.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok-example-not-a-real-token",
      ...SMTP_ENV,
    });
    const { sender, send } = senderReturning({ status: "SENT", transport: "smtp" });

    const result = await runEmailTest({
      config: production,
      to: "owner@coolbreeze.co.uk",
      now: NOW,
      sender,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("development tool");
    expect(send).not.toHaveBeenCalled();
  });

  it("explains what to set when only the log transport is configured, and sends nothing", async () => {
    const { sender, send } = senderReturning({ status: "SENT", transport: "smtp" });

    const result = await runEmailTest({
      config: loadConfig({}),
      to: "owner@coolbreeze.co.uk",
      now: NOW,
      sender,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("No SMTP server is configured");
    expect(result.message).toContain("SMTP_HOST");
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["alex@example.test", "someone@example.com", "x@host.invalid"])(
    "refuses the reserved address %s, because it could never receive mail",
    async (to) => {
      const { sender, send } = senderReturning({ status: "SENT", transport: "smtp" });

      const result = await runEmailTest({ config, to, now: NOW, sender });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("reserved domain");
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("refuses something that is not an address", async () => {
    const { sender, send } = senderReturning({ status: "SENT", transport: "smtp" });

    const result = await runEmailTest({ config, to: "not-an-address", now: NOW, sender });

    expect(result.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not report success when the message was only logged", async () => {
    const { sender } = senderReturning({ status: "LOGGED", transport: "log" });

    const result = await runEmailTest({ config, to: "owner@coolbreeze.co.uk", now: NOW, sender });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("nothing was delivered");
  });
});
