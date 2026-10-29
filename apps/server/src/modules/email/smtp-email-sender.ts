import nodemailer from "nodemailer";

import type { SmtpSettings } from "../../config/env.js";
import { singleLine } from "./email.domain.js";
import type { EmailMessage, EmailSender, EmailSendResult } from "./email.types.js";

/** The part of a Nodemailer transport the sender uses; tests pass a fake. */
export interface MailTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
  /** Closes pooled connections. */
  close?(): void;
}

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;
/** A small pool is plenty for a small business; it also stays under typical provider limits. */
const POOL_MAX_CONNECTIONS = 3;
const POOL_MAX_MESSAGES_PER_CONNECTION = 100;

/**
 * Builds the pooled Nodemailer transport (connections are reused between emails) with timeouts, so
 * a dead SMTP server cannot hang the dispatcher.
 */
export function createSmtpTransport(settings: SmtpSettings, requireTls: boolean): MailTransport {
  return nodemailer.createTransport({
    pool: true,
    maxConnections: POOL_MAX_CONNECTIONS,
    maxMessages: POOL_MAX_MESSAGES_PER_CONNECTION,
    host: settings.host,
    port: settings.port,
    // true = TLS from the first byte (port 465). false = plain connect, then STARTTLS when offered.
    secure: settings.secure,
    // In production a server that cannot upgrade to TLS is refused rather than used in clear text.
    requireTLS: requireTls && !settings.secure,
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    ...(settings.user !== undefined &&
      settings.password !== undefined && {
        auth: { user: settings.user, pass: settings.password },
      }),
  });
}

/** Sends through an SMTP server (Nodemailer). Throws when the server refuses or is unreachable. */
export class SmtpEmailSender implements EmailSender {
  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    await this.transport.sendMail({
      from: this.from,
      to: singleLine(message.to),
      subject: singleLine(message.subject),
      text: message.text,
      html: message.html,
    });
    return { status: "SENT", transport: "smtp" };
  }

  close(): void {
    this.transport.close?.();
  }
}
