"use client";

import { isSafeAppPath, type NotificationDto } from "@fixflow/shared";
import Link from "next/link";

import { PopoverClose } from "@/components/ui/popover";
import { formatRelative } from "@/lib/formatting/datetime";
import { cn } from "@/lib/utils";

export interface NotificationRowProps {
  notification: NotificationDto;
  /** The business time zone, from the API. */
  timeZone: string;
  /** Called when the person chooses the notification, before they are taken to its page. */
  onOpen: (notification: NotificationDto) => void;
}

const ROW_CLASSES =
  "flex w-full gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus";

/**
 * One notification in the popover: title, message, how long ago, and a marker for the unread ones.
 * Unread is shown by a dot, a bolder title and a hidden "Unread" label for screen readers, never by
 * colour alone. Choosing it marks it read and goes to its page. The link is checked again here
 * (the API already refuses anything but `/app/...` and `/portal/...`): if it is not a safe path
 * inside the app, the row still marks the notification read but takes the person nowhere.
 */
export function NotificationRow({ notification, timeZone, onOpen }: NotificationRowProps) {
  const unread = notification.readAt === null;

  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "mt-1.5 size-2.5 shrink-0 rounded-full",
          unread ? "bg-brand" : "border border-border-strong",
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-sm text-ink", unread ? "font-semibold" : "font-medium")}>
          {unread ? <span className="sr-only">Unread: </span> : null}
          {notification.title}
        </span>
        <span className="line-clamp-2 text-sm text-ink-secondary">{notification.message}</span>
        <time dateTime={notification.createdAt} className="text-xs text-ink-muted">
          {formatRelative(notification.createdAt, new Date(), timeZone)}
        </time>
      </span>
    </>
  );

  return (
    <li className="border-b border-border last:border-b-0">
      {isSafeAppPath(notification.linkPath) ? (
        <PopoverClose asChild>
          <Link
            href={notification.linkPath}
            prefetch={false}
            className={ROW_CLASSES}
            onClick={() => {
              onOpen(notification);
            }}
          >
            {content}
          </Link>
        </PopoverClose>
      ) : (
        <button
          type="button"
          className={ROW_CLASSES}
          onClick={() => {
            onOpen(notification);
          }}
        >
          {content}
        </button>
      )}
    </li>
  );
}
