import type { PaginatedResponse } from "./api.js";
import type { NotificationType } from "./enums.js";

/**
 * One in-app notification, as its recipient sees it (D-38). A notification belongs to exactly one
 * user, so there is no separate customer and admin shape: the API only ever returns the caller's own.
 */
export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** A relative path into the signed-in app (`/app/...` or `/portal/...`). */
  linkPath: string;
  /** ISO 8601 instant, or `null` while the notification is unread. */
  readAt: string | null;
  createdAt: string;
}

/** Extra facts that come with a page of notifications. */
export interface NotificationListMeta {
  /** All of the caller's unread notifications, not only those on this page. */
  unreadCount: number;
  /**
   * The business time zone (IANA) from the settings, for showing when each notification arrived.
   * Business dates are never shown in the browser's own zone (BR-17).
   */
  timeZone: string;
}

/** `GET /notifications/me`: the standard list envelope plus `meta.unreadCount`. */
export interface NotificationListResponse extends PaginatedResponse<NotificationDto> {
  meta: NotificationListMeta;
}

/** `POST /notifications/me/read-all`. */
export interface NotificationsReadAllDto {
  /** How many notifications this call changed (`0` when everything was already read). */
  updated: number;
}
