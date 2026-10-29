import type { NotificationDto } from "@fixflow/shared";

import type { Notification } from "../../generated/prisma/client.js";

/**
 * A notification as its recipient sees it. Built field by field, so the entity reference and any
 * column added later stay server-side.
 */
export function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    linkPath: row.linkPath,
    readAt: row.readAt === null ? null : row.readAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
