export interface EmailMessage {
  /** A single recipient address. */
  to: string;
  subject: string;
  /** Plain, accessible HTML. Every dynamic value in it must already be escaped. */
  html: string;
  /** The same content as plain text. */
  text: string;
  /**
   * The kind of email, such as `quotation-sent`. Only the log transport reads it (to name the files
   * it writes); it is never sent.
   */
  template?: string | undefined;
}

export type EmailTransportName = "smtp" | "log";

export interface EmailSendResult {
  /** `SENT` = handed to an SMTP server. `LOGGED` = written to the log/outbox only; nobody was emailed. */
  status: "SENT" | "LOGGED";
  transport: EmailTransportName;
}

/**
 * Delivers one email. Implementations throw when delivery fails; callers go through `sendAndLog`
 * (or the dispatcher), which records the outcome and never lets a failure reach the business action
 * (BR-22).
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
  /** Releases pooled connections. Called once at shutdown; senders without any leave it out. */
  close?(): void;
}
