import type { NotificationType } from "@fixflow/shared";

import { withDatabase } from "./accounts.js";

/**
 * Notification scenarios for the E2E suite: rows inserted straight into the E2E database, as the
 * rest of the fixtures are (CLAUDE.md §11). There is no test-only endpoint in the product, and no
 * workflow exists yet that creates notifications, so these stand in for what T11 onwards will do.
 */

export interface FixtureNotification {
  title: string;
  message: string;
  /** A path inside the app. Use one that exists (`/portal`, `/app/account`) or a query on it. */
  linkPath: string;
  type?: NotificationType;
  /** Already read when set. */
  read?: boolean;
  /** How long ago it arrived; the first one given is the newest unless this says otherwise. */
  ageMinutes?: number;
}

export interface CreatedNotification {
  id: string;
  title: string;
}

/** Gives a user notifications, newest first in the order given. Returns their ids. */
export async function createNotificationsFor(
  userId: string,
  notifications: readonly FixtureNotification[],
): Promise<CreatedNotification[]> {
  return withDatabase(async (prisma) => {
    const created: CreatedNotification[] = [];
    for (const [index, item] of notifications.entries()) {
      const ageMinutes = item.ageMinutes ?? (index + 1) * 10;
      const createdAt = new Date(Date.now() - ageMinutes * 60_000);
      const row = await prisma.notification.create({
        data: {
          recipientUserId: userId,
          type: item.type ?? "QUOTATION_SENT",
          title: item.title,
          message: item.message,
          linkPath: item.linkPath,
          createdAt,
          readAt: item.read === true ? createdAt : null,
        },
        select: { id: true },
      });
      created.push({ id: row.id, title: item.title });
    }
    return created;
  });
}

/** The id of the seeded user with this email. */
export async function userIdFor(email: string): Promise<string> {
  return withDatabase(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    return user.id;
  });
}

/** When a notification was read, straight from the database, or `null` while unread. */
export async function readAtOf(notificationId: string): Promise<Date | null> {
  return withDatabase(async (prisma) => {
    const row = await prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
      select: { readAt: true },
    });
    return row.readAt;
  });
}

/** What most scenarios start from: two unread notifications, newest first, and one older read one. */
export const SAMPLE_NOTIFICATIONS: readonly FixtureNotification[] = [
  {
    title: "Quotation QT-2026-00004 is ready",
    message: "We sent you a quotation for AC Repair. Please review it.",
    linkPath: "/portal?from=quotation",
    ageMinutes: 5,
  },
  {
    title: "Request FF-2026-00012 received",
    message: "We have your request for AC Repair and will review it soon.",
    linkPath: "/portal?from=request",
    type: "REQUEST_RECEIVED",
    ageMinutes: 90,
  },
  {
    title: "Invoice INV-2026-00007 is ready",
    message: "You can view it and see how to pay.",
    linkPath: "/portal?from=invoice",
    type: "INVOICE_ISSUED",
    read: true,
    ageMinutes: 3000,
  },
];
