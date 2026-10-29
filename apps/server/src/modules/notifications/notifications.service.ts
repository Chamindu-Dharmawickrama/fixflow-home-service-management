import {
  type NotificationDto,
  type NotificationListResponse,
  type NotificationsReadAllDto,
  Role,
} from "@fixflow/shared";

import type { Notification } from "../../generated/prisma/client.js";
import type { Clock } from "../../lib/clock.js";
import { BUSINESS_SETTINGS_ID, type DbClient, type PrismaClient } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import { paginated, type PaginationParams, toPrismaPage } from "../../lib/pagination.js";
import {
  type NotifyInput,
  validateNotificationContent,
  validateRecipient,
} from "./notifications.domain.js";
import { toNotificationDto } from "./notifications.dto.js";

export type { NotifyInput } from "./notifications.domain.js";

function toCreateData(input: NotifyInput) {
  return {
    recipientUserId: input.recipientUserId,
    type: input.type,
    title: input.title,
    message: input.message,
    linkPath: input.linkPath,
    entityType: input.entity?.type ?? null,
    entityId: input.entity?.id ?? null,
  };
}

/**
 * Creates one in-app notification for one user (D-38). Call it with the `tx` of the business change
 * it announces, so the notification exists exactly when the change does. An invalid notification (a
 * link that is not a `/app/...` or `/portal/...` path, an empty title) throws
 * {@link NotificationValidationError} and writes nothing: it is a programming error.
 */
export async function notify(tx: DbClient, input: NotifyInput): Promise<Notification> {
  validateRecipient(input.recipientUserId);
  validateNotificationContent(input);
  return tx.notification.create({ data: toCreateData(input) });
}

/**
 * Creates the same notification for every active business admin (request received, quotation
 * decided). Returns what was created: empty when there is no active admin. Whether an admin may
 * still *read* them is decided when they ask: the admin allowlist is checked by the notification
 * endpoints, not here.
 */
export async function notifyAdmins(
  tx: DbClient,
  input: Omit<NotifyInput, "recipientUserId">,
): Promise<Notification[]> {
  validateNotificationContent(input);
  const admins = await tx.user.findMany({
    where: { role: Role.BUSINESS_ADMIN, isActive: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (admins.length === 0) {
    return [];
  }
  return tx.notification.createManyAndReturn({
    data: admins.map((admin) => toCreateData({ ...input, recipientUserId: admin.id })),
  });
}

interface NotificationReadDeps {
  prisma: PrismaClient;
  clock: Clock;
}

export interface ListNotificationsQuery extends Pick<
  PaginationParams<"createdAt">,
  "page" | "pageSize" | "sort" | "order"
> {
  unreadOnly: boolean;
}

/** The caller's own notifications, newest first, with their total unread count (D-40). */
export async function listNotifications(
  deps: Pick<NotificationReadDeps, "prisma">,
  userId: string,
  query: ListNotificationsQuery,
): Promise<NotificationListResponse> {
  const { prisma } = deps;
  const where = { recipientUserId: userId, ...(query.unreadOnly && { readAt: null }) };

  const [rows, totalItems, unreadCount, settings] = await Promise.all([
    prisma.notification.findMany({ where, ...toPrismaPage(query) }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { recipientUserId: userId, readAt: null } }),
    prisma.businessSettings.findUnique({
      where: { id: BUSINESS_SETTINGS_ID },
      select: { timeZone: true },
    }),
  ]);

  return {
    ...paginated(rows.map(toNotificationDto), query, totalItems),
    // Missing settings should not happen (the seed creates them); UTC is a safe, honest fallback.
    meta: { unreadCount, timeZone: settings?.timeZone ?? "UTC" },
  };
}

/**
 * Marks one of the caller's notifications as read. Someone else's notification is `404`, exactly
 * like one that does not exist, and is left untouched. Repeating the call is harmless: the first
 * read time is kept.
 */
export async function markNotificationRead(
  deps: NotificationReadDeps,
  userId: string,
  notificationId: string,
): Promise<NotificationDto> {
  const { prisma, clock } = deps;

  await prisma.notification.updateMany({
    where: { id: notificationId, recipientUserId: userId, readAt: null },
    data: { readAt: clock.now() },
  });
  const row = await prisma.notification.findFirst({
    where: { id: notificationId, recipientUserId: userId },
  });
  if (row === null) {
    throw notFound();
  }
  return toNotificationDto(row);
}

/** Marks all of the caller's unread notifications as read. Nobody else's are touched. */
export async function markAllNotificationsRead(
  deps: NotificationReadDeps,
  userId: string,
): Promise<NotificationsReadAllDto> {
  const { prisma, clock } = deps;
  const result = await prisma.notification.updateMany({
    where: { recipientUserId: userId, readAt: null },
    data: { readAt: clock.now() },
  });
  return { updated: result.count };
}
