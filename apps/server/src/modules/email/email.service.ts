import type { Clock } from "../../lib/clock.js";
import { BUSINESS_SETTINGS_ID, type DbClient, type PrismaClient } from "../../lib/db.js";
import { maskEmail } from "../../lib/email-address.js";
import type { Logger } from "../../lib/logger.js";
import type { EmailBranding } from "./email.layout.js";
import type { EmailMessage, EmailSender } from "./email.types.js";

export interface EmailDeps {
  prisma: PrismaClient;
  emailSender: EmailSender;
  clock: Clock;
  logger: Logger;
}

export interface SendAndLogInput {
  /** A stable name for the kind of email, such as `password-reset`. */
  template: string;
  message: EmailMessage;
  /** The in-app notification this email repeats, for tracing. */
  notificationId?: string | undefined;
}

/** What happened to one email. `SKIPPED` = there was nobody to send it to. */
export type SendOutcome = "SENT" | "LOGGED" | "FAILED" | "SKIPPED";

/** A short, safe code for a failure: Nodemailer's own (`ECONNECTION`, `EAUTH`, …) or a generic one. */
function failureCode(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "SEND_FAILED";
}

/**
 * Sends one email and records what happened in `EmailDeliveryLog`: `PENDING`, then `SENT` (an SMTP
 * server accepted it), `LOGGED` (written to the log transport only) or `FAILED`.
 *
 * It never throws. An email is a side effect of a business action that has already been committed,
 * so a delivery or bookkeeping failure is logged and returned as `FAILED`, and the caller carries
 * on (BR-22). The recipient is stored masked and the message body is never stored.
 */
export async function sendAndLog(deps: EmailDeps, input: SendAndLogInput): Promise<SendOutcome> {
  const { prisma, emailSender, clock, logger } = deps;
  const { template, message, notificationId } = input;
  const recipientMasked = maskEmail(message.to);

  let logId: string | undefined;
  try {
    const row = await prisma.emailDeliveryLog.create({
      data: {
        template,
        recipientMasked,
        transport: "pending",
        status: "PENDING",
        notificationId: notificationId ?? null,
      },
      select: { id: true },
    });
    logId = row.id;
  } catch (error) {
    logger.error({ err: error, template }, "Could not record the email delivery attempt");
  }

  const record = async (data: {
    status: "SENT" | "LOGGED" | "FAILED";
    transport?: string;
    errorCode?: string;
    sent: boolean;
  }): Promise<void> => {
    if (logId === undefined) return;
    const now = clock.now();
    try {
      await prisma.emailDeliveryLog.update({
        where: { id: logId },
        data: {
          status: data.status,
          ...(data.transport !== undefined && { transport: data.transport }),
          ...(data.errorCode !== undefined && { errorCode: data.errorCode }),
          attemptedAt: now,
          ...(data.sent && { sentAt: now }),
        },
      });
    } catch (error) {
      logger.error({ err: error, template }, "Could not update the email delivery record");
    }
  };

  try {
    const result = await emailSender.send({ ...message, template });
    await record({
      status: result.status,
      transport: result.transport,
      sent: result.status === "SENT",
    });
    return result.status;
  } catch (error) {
    // Only the short code is logged: an SMTP error message can echo the recipient's full address.
    const errorCode = failureCode(error);
    logger.error(
      { errorCode, template, to: recipientMasked },
      "Email delivery failed; the action it belongs to is unaffected",
    );
    await record({ status: "FAILED", errorCode, sent: false });
    return "FAILED";
  }
}

export interface RecordNotSentInput {
  template: string;
  /** The intended recipient, if there was one; stored masked. */
  to: string | null | undefined;
  status: "SKIPPED" | "FAILED";
  /** Why: `NO_RECIPIENT`, `INVALID_RECIPIENT`, `TEMPLATE_ERROR`. A fixed, safe code. */
  errorCode: string;
  notificationId?: string | undefined;
}

/**
 * Records an email that was never handed to a transport: there was no recipient (`SKIPPED`), or it
 * could not be built (`FAILED`). Like {@link sendAndLog} it never throws.
 */
export async function recordEmailNotSent(
  deps: EmailDeps,
  input: RecordNotSentInput,
): Promise<void> {
  const { prisma, clock, logger } = deps;
  const to = input.to?.trim() ?? "";
  try {
    await prisma.emailDeliveryLog.create({
      data: {
        template: input.template,
        recipientMasked: to === "" ? "(none)" : maskEmail(to),
        transport: "none",
        status: input.status,
        errorCode: input.errorCode,
        attemptedAt: clock.now(),
        notificationId: input.notificationId ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, template: input.template }, "Could not record the unsent email");
  }
}

const FALLBACK_BUSINESS_NAME = "FixFlow";

/**
 * The business details every email shows, read from the settings. If they cannot be read the email
 * still goes out under the product name rather than not at all.
 */
export async function loadEmailBranding(
  deps: Pick<EmailDeps, "prisma" | "logger">,
): Promise<EmailBranding> {
  try {
    const settings = await deps.prisma.businessSettings.findUnique({
      where: { id: BUSINESS_SETTINGS_ID },
      select: { businessName: true, contactEmail: true, phone: true },
    });
    if (settings !== null) {
      return {
        businessName: settings.businessName,
        contactEmail: settings.contactEmail,
        contactPhone: settings.phone,
      };
    }
  } catch (error) {
    deps.logger.error({ err: error }, "Could not read the business details for an email");
  }
  return { businessName: FALLBACK_BUSINESS_NAME };
}

/** Where emails for the business itself go (D-38): `BusinessSettings.contactEmail`. */
export async function getBusinessContactEmail(db: DbClient): Promise<string | null> {
  const settings = await db.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { contactEmail: true },
  });
  return settings?.contactEmail ?? null;
}
