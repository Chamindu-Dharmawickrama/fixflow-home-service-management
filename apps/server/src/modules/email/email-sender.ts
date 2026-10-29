import { fileURLToPath } from "node:url";

import type { Config } from "../../config/env.js";
import type { Clock } from "../../lib/clock.js";
import type { Logger } from "../../lib/logger.js";
import { isReservedEmailDomain } from "./email.domain.js";
import type { EmailMessage, EmailSender, EmailSendResult } from "./email.types.js";
import { LogEmailSender } from "./log-email-sender.js";
import { createSmtpTransport, SmtpEmailSender } from "./smtp-email-sender.js";

/** `<repository>/.data/outbox`, resolved from this file (src/modules/email or dist/modules/email). */
const DEFAULT_OUTBOX_DIR = fileURLToPath(new URL("../../../../../.data/outbox", import.meta.url));

/**
 * Chooses the transport per message (D-52): reserved, undeliverable domains always go to the log
 * transport; everything else goes to SMTP when it is configured, and to the log otherwise.
 */
export class RoutingEmailSender implements EmailSender {
  constructor(
    private readonly log: EmailSender,
    private readonly smtp: EmailSender | undefined,
  ) {}

  send(message: EmailMessage): Promise<EmailSendResult> {
    const sender =
      this.smtp === undefined || isReservedEmailDomain(message.to) ? this.log : this.smtp;
    return sender.send(message);
  }

  close(): void {
    this.smtp?.close?.();
  }
}

/** Builds the production email sender from configuration. */
export function createEmailSender(
  config: Config,
  logger: Logger,
  clock: Clock,
): RoutingEmailSender {
  const { email, isProduction } = config;
  const log = new LogEmailSender({
    logger,
    clock,
    outboxDir: isProduction ? undefined : (email.outboxDir ?? DEFAULT_OUTBOX_DIR),
  });
  const smtp =
    email.transport === "smtp" && email.smtp !== undefined
      ? new SmtpEmailSender(createSmtpTransport(email.smtp, isProduction), email.from)
      : undefined;
  return new RoutingEmailSender(log, smtp);
}

/** True when this server can really deliver email (SMTP is configured). */
export function canDeliverEmail(config: Pick<Config, "email">): boolean {
  return config.email.transport === "smtp" && config.email.smtp !== undefined;
}

/**
 * Things worth saying once at startup about the email setup. In production the `log` transport is
 * allowed (a portfolio demo may have no mail server) but nothing is ever delivered, so it is warned
 * about: customers would be told "we'll email you" and nothing would arrive.
 */
export function emailStartupWarnings(config: Pick<Config, "email" | "isProduction">): string[] {
  if (config.isProduction && config.email.transport === "log") {
    return [
      "EMAIL_TRANSPORT is log in production: no email is delivered (password reset is unavailable, and notification emails are only written to the log). Set EMAIL_TRANSPORT=smtp and the SMTP_* variables to deliver email.",
    ];
  }
  return [];
}
