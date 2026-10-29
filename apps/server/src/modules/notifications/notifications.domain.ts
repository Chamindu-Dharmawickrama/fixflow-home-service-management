import { type ActivityEntityType, isSafeAppPath, NotificationType } from "@fixflow/shared";

/**
 * Pure rules for in-app notifications (D-38, FR-091, BR-19). A notification has one recipient and a
 * short, customer-safe text; it links to a page inside the app and never to another site.
 */

export const NOTIFICATION_TITLE_MAX_LENGTH = 120;
export const NOTIFICATION_MESSAGE_MAX_LENGTH = 300;

/** What a workflow passes to `notify()`. */
export interface NotifyInput {
  recipientUserId: string;
  type: NotificationType;
  /** One line, for example "Quotation QT-2026-00004 is ready". */
  title: string;
  message: string;
  /** A relative path into the signed-in app: `/portal/quotations/<id>`. Validated. */
  linkPath: string;
  /** The record the notification is about (for staff tooling; not shown to the recipient). */
  entity?: { type: ActivityEntityType; id: string };
}

/** Thrown when a notification is built wrongly. A programming error, so it is never shown to a user. */
export class NotificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationValidationError";
  }
}

const NOTIFICATION_TYPES: ReadonlySet<string> = new Set(Object.values(NotificationType));
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireText(name: string, value: string, maxLength: number): void {
  if (value.trim() === "" || value.length > maxLength) {
    throw new NotificationValidationError(
      `Notification ${name} must be 1-${maxLength} characters.`,
    );
  }
}

/**
 * Checks everything about a notification except who receives it. The link is the important part:
 * an absolute URL, a protocol-relative URL or a script URL would turn a notification into a phishing
 * link, so only `/app/...` and `/portal/...` paths are accepted. The value itself is deliberately
 * left out of the message.
 */
export function validateNotificationContent(
  input: Pick<NotifyInput, "type" | "title" | "message" | "linkPath" | "entity">,
): void {
  if (!NOTIFICATION_TYPES.has(input.type)) {
    throw new NotificationValidationError("Notification type is not a known type.");
  }
  requireText("title", input.title, NOTIFICATION_TITLE_MAX_LENGTH);
  if (/[\r\n]/.test(input.title)) {
    throw new NotificationValidationError("Notification title must be a single line.");
  }
  requireText("message", input.message, NOTIFICATION_MESSAGE_MAX_LENGTH);
  if (!isSafeAppPath(input.linkPath)) {
    throw new NotificationValidationError(
      "Notification linkPath must be a relative path starting with /app/ or /portal/.",
    );
  }
  if (input.entity !== undefined && !UUID_FORMAT.test(input.entity.id)) {
    throw new NotificationValidationError("Notification entity id must be a UUID.");
  }
}

export function validateRecipient(recipientUserId: string): void {
  if (!UUID_FORMAT.test(recipientUserId)) {
    throw new NotificationValidationError("Notification recipientUserId must be a UUID.");
  }
}
