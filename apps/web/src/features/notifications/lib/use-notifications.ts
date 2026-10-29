"use client";

import type {
  NotificationDto,
  NotificationListMeta,
  NotificationListResponse,
  NotificationsReadAllDto,
} from "@fixflow/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, apiFetchEnvelope, isApiError, NETWORK_ERROR_MESSAGE } from "@/lib/api";

/** How often the unread count is refreshed while the tab is visible (D-40). */
export const POLL_INTERVAL_MS = 60_000;
/** How many notifications the popover lists; older ones stay in the database, not on screen. */
export const LIST_SIZE = 10;

export type ListStatus = "idle" | "loading" | "ready" | "error";

export interface UseNotificationsOptions {
  pollIntervalMs?: number;
  pageSize?: number;
}

const MARK_READ_FAILED = "We couldn't mark that notification as read. Please try again.";
const MARK_ALL_FAILED = "We couldn't mark your notifications as read. Please try again.";

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** What to tell the person when a request failed: the API's own safe message, or a generic one. */
function messageFor(error: unknown): string {
  return isApiError(error) ? error.message : NETWORK_ERROR_MESSAGE;
}

/**
 * The bell's data (FR-091, D-40). It keeps the unread count fresh by asking the API once a minute
 * **only while the tab is visible** (and again the moment the tab becomes visible), loads the list
 * when the popover opens, and marks notifications read.
 *
 * Marking is optimistic so the badge responds at once, but never lies: if the API refuses, the
 * notification goes back to unread and an error is shown. Nothing here says an email was sent; a
 * notification in the app is all this knows about.
 */
export function useNotifications(options: UseNotificationsOptions = {}) {
  const { pollIntervalMs = POLL_INTERVAL_MS, pageSize = LIST_SIZE } = options;

  const [unreadCount, setUnreadCount] = useState<number | undefined>(undefined);
  const [timeZone, setTimeZone] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [listStatus, setListStatus] = useState<ListStatus>("idle");
  const [listError, setListError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [markingAll, setMarkingAll] = useState(false);

  // Only the newest list request may update the screen, so a slow older answer cannot overwrite it.
  const latestListRequest = useRef(0);

  const applyMeta = useCallback((meta: NotificationListMeta) => {
    setUnreadCount(meta.unreadCount);
    setTimeZone(meta.timeZone);
  }, []);

  // Poll the count: one page of one item is enough, the answer carries `meta.unreadCount`.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const refresh = async () => {
      try {
        const body = await apiFetchEnvelope<NotificationListResponse>(
          "/notifications/me?pageSize=1",
          { signal: controller.signal },
        );
        applyMeta(body.meta);
      } catch (error) {
        if (isAbort(error)) return;
        // A signed-out or de-listed person will be sent to sign in by the page itself; asking again
        // every minute would only add noise. Any other failure keeps the last count and retries.
        if (isApiError(error) && (error.status === 401 || error.status === 403)) {
          stop();
        }
      }
    };

    const start = () => {
      if (timer === undefined) {
        timer = setInterval(() => {
          void refresh();
        }, pollIntervalMs);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      void refresh();
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
      controller.abort();
    };
  }, [pollIntervalMs, applyMeta]);

  const loadList = useCallback(async () => {
    const request = latestListRequest.current + 1;
    latestListRequest.current = request;
    // Keep showing the previous list while it refreshes; show the skeleton only the first time.
    setListStatus((current) => (current === "ready" ? current : "loading"));
    setListError(undefined);
    // Opening the list starts afresh: an old "couldn't mark as read" is no longer news.
    setActionError(undefined);
    try {
      const body = await apiFetchEnvelope<NotificationListResponse>(
        `/notifications/me?pageSize=${String(pageSize)}`,
      );
      if (request !== latestListRequest.current) return;
      setItems(body.data);
      setTotalItems(body.pagination.totalItems);
      applyMeta(body.meta);
      setListStatus("ready");
    } catch (error) {
      if (request !== latestListRequest.current) return;
      setListError(messageFor(error));
      setListStatus("error");
    }
  }, [pageSize, applyMeta]);

  const markRead = useCallback(async (notification: NotificationDto) => {
    if (notification.readAt !== null) return;

    setActionError(undefined);
    // Optimistic: the placeholder time is replaced by the server's, or the change is undone below.
    const placeholder = { ...notification, readAt: new Date().toISOString() };
    setItems((current) =>
      current.map((item) => (item.id === notification.id ? placeholder : item)),
    );
    setUnreadCount((current) => (current === undefined ? current : Math.max(0, current - 1)));
    try {
      const saved = await apiFetch<NotificationDto>(`/notifications/${notification.id}/read`, {
        method: "PATCH",
      });
      setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch {
      setItems((current) =>
        current.map((item) => (item.id === notification.id ? notification : item)),
      );
      setUnreadCount((current) => (current === undefined ? current : current + 1));
      setActionError(MARK_READ_FAILED);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setMarkingAll(true);
    setActionError(undefined);
    try {
      await apiFetch<NotificationsReadAllDto>("/notifications/me/read-all", { method: "POST" });
      const readAt = new Date().toISOString();
      setItems((current) =>
        current.map((item) => (item.readAt === null ? { ...item, readAt } : item)),
      );
      setUnreadCount(0);
    } catch {
      setActionError(MARK_ALL_FAILED);
    } finally {
      setMarkingAll(false);
    }
  }, []);

  return {
    unreadCount,
    timeZone,
    items,
    totalItems,
    listStatus,
    listError,
    actionError,
    markingAll,
    loadList,
    markRead,
    markAllRead,
  };
}
