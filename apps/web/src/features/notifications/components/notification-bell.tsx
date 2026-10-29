"use client";

import { Bell, BellOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

import { LIST_SIZE, POLL_INTERVAL_MS, useNotifications } from "../lib/use-notifications";
import { NotificationRow } from "./notification-row";

export interface NotificationBellProps {
  /** How often to refresh the unread count while the tab is visible. Default: every 60 seconds. */
  pollIntervalMs?: number;
  /** How many notifications the popover lists. Default: 10. */
  pageSize?: number;
}

/** "3 unread notifications", or just "Notifications" when everything has been read. */
export function bellLabel(unreadCount: number): string {
  if (unreadCount === 0) return "Notifications";
  return `${String(unreadCount)} unread ${unreadCount === 1 ? "notification" : "notifications"}`;
}

/**
 * The notification bell in the top bar of the admin and customer shells (FR-091, UX-INT-06). It
 * shows how many notifications are unread, opens a list of the latest ones, marks a notification
 * read when it is chosen (and goes to its page), and can mark them all read.
 *
 * It says only that a notification exists. It never claims that an email was sent or arrived: email
 * delivery is tracked separately and is not shown here.
 */
export function NotificationBell({
  pollIntervalMs = POLL_INTERVAL_MS,
  pageSize = LIST_SIZE,
}: NotificationBellProps) {
  const notifications = useNotifications({ pollIntervalMs, pageSize });
  const [open, setOpen] = useState(false);

  const unreadCount = notifications.unreadCount ?? 0;
  const { listStatus, items, totalItems, timeZone = "UTC" } = notifications;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void notifications.loadList();
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex size-11 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink sm:size-10"
        >
          <Bell aria-hidden="true" className="size-5" />
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 min-w-5 rounded-full bg-danger px-1 text-center text-xs font-semibold leading-5 text-surface"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
          <span className="sr-only">{bellLabel(unreadCount)}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        aria-label="Notifications"
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-ink">Notifications</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            loading={notifications.markingAll}
            loadingText="Marking all notifications as read…"
            onClick={() => {
              void notifications.markAllRead();
            }}
          >
            Mark all as read
          </Button>
        </div>

        {listStatus === "loading" || listStatus === "idle" ? (
          <div role="status" aria-live="polite" className="divide-y divide-border">
            <span className="sr-only">Loading notifications</span>
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex gap-3 px-4 py-3">
                <Skeleton className="mt-1.5 size-2.5 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {listStatus === "error" ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-ink">
              We couldn&apos;t load your notifications
            </p>
            <p className="text-sm text-ink-secondary">{notifications.listError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void notifications.loadList();
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {listStatus === "ready" && items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
              <BellOff aria-hidden="true" className="size-5" />
            </span>
            <p className="text-sm font-semibold text-ink">You&apos;re all caught up</p>
            <p className="text-sm text-ink-secondary">New notifications will appear here.</p>
          </div>
        ) : null}

        {listStatus === "ready" && items.length > 0 ? (
          <ul aria-label="Latest notifications" className="max-h-[min(24rem,60vh)] overflow-y-auto">
            {items.map((item) => (
              <NotificationRow
                key={item.id}
                notification={item}
                timeZone={timeZone}
                onOpen={(notification) => {
                  void notifications.markRead(notification);
                }}
              />
            ))}
          </ul>
        ) : null}

        {notifications.actionError !== undefined ? (
          <p role="alert" className="border-t border-border px-4 py-3 text-sm text-danger">
            {notifications.actionError}
          </p>
        ) : null}

        {listStatus === "ready" && totalItems > items.length ? (
          <p className="border-t border-border px-4 py-2 text-xs text-ink-muted">
            Showing the latest {items.length} of {totalItems}.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
