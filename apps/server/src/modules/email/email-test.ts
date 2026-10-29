import type { Config } from "../../config/env.js";
import { looksLikeEmail, maskEmail } from "../../lib/email-address.js";
import { isReservedEmailDomain } from "./email.domain.js";
import { renderSmtpTestEmail } from "./email.templates.js";
import type { EmailSender } from "./email.types.js";
import { canDeliverEmail } from "./email-sender.js";
import { createSmtpTransport, SmtpEmailSender } from "./smtp-email-sender.js";

/**
 * The logic behind `npm run email:test -w @fixflow/server -- --to <address>` (T06): send one real
 * message through the configured SMTP server, to prove the settings work. It is a development tool
 * and sends nothing from production. It is kept apart from the script entry point so it can be
 * tested with a fake sender.
 */

export type EmailTestArgs = { to: string } | { error: string };

export function parseEmailTestArgs(argv: readonly string[]): EmailTestArgs {
  let to: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--to") {
      to = argv[index + 1];
      index += 1;
    } else if (argument?.startsWith("--to=") === true) {
      to = argument.slice("--to=".length);
    } else {
      return { error: `Unknown argument "${argument ?? ""}". Usage: --to <address>` };
    }
  }
  if (to === undefined || to.trim() === "") {
    return {
      error:
        "Missing the recipient. Usage: npm run email:test -w @fixflow/server -- --to <address>",
    };
  }
  return { to: to.trim() };
}

export interface EmailTestResult {
  ok: boolean;
  /** What to tell the person running the script. Never contains a password. */
  message: string;
}

export interface RunEmailTestOptions {
  config: Pick<Config, "email" | "isProduction">;
  to: string;
  now: Date;
  /** Tests pass a fake. The real tool builds the SMTP sender from the configuration. */
  sender?: EmailSender;
}

function describeError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  const reason = error instanceof Error ? error.message : "unknown error";
  return code === undefined ? reason : `${code}: ${reason}`;
}

/** Sends the test message and says what happened, honestly: "accepted" is not "arrived". */
export async function runEmailTest(options: RunEmailTestOptions): Promise<EmailTestResult> {
  const { config, to, now } = options;
  const fail = (message: string): EmailTestResult => ({ ok: false, message });

  if (config.isProduction) {
    return fail("This is a development tool. It refuses to run with NODE_ENV=production.");
  }
  if (!canDeliverEmail(config)) {
    return fail(
      "No SMTP server is configured, so nothing could be delivered (the log transport only writes to .data/outbox). Set SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD and EMAIL_FROM in apps/server/.env (see .env.example), and EMAIL_TRANSPORT=smtp.",
    );
  }
  if (!looksLikeEmail(to)) {
    return fail("The recipient does not look like an email address.");
  }
  if (isReservedEmailDomain(to)) {
    return fail(
      "That address is on a reserved domain (.test, .example, example.com, …) that can never receive mail, and FixFlow always logs such mail instead of sending it (D-52). Use a real address that you can read.",
    );
  }

  const { smtp } = config.email;
  if (smtp === undefined) {
    return fail("The SMTP settings are incomplete.");
  }
  const sender =
    options.sender ??
    new SmtpEmailSender(createSmtpTransport(smtp, config.isProduction), config.email.from);

  const content = renderSmtpTestEmail({ businessName: "FixFlow", sentAt: now, timeZone: "UTC" });
  try {
    const result = await sender.send({ to, ...content, template: "smtp-test" });
    return result.status === "SENT"
      ? {
          ok: true,
          message: `The SMTP server accepted the message for ${maskEmail(to)} (${smtp.host}:${String(smtp.port)}). Check that inbox, and the spam folder, to confirm it arrived.`,
        }
      : fail(
          `The message was only written to the log (${result.transport}); nothing was delivered. Check EMAIL_TRANSPORT.`,
        );
  } catch (error) {
    return fail(`The SMTP server did not accept the message. ${describeError(error)}`);
  } finally {
    sender.close?.();
  }
}
