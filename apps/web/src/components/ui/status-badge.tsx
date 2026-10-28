import {
  Ban,
  Banknote,
  BellDot,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Check,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleMinus,
  CircleX,
  ClipboardList,
  Clock,
  FilePen,
  FileText,
  Inbox,
  type LucideIcon,
  MailCheck,
  MailX,
  Receipt,
  ScrollText,
  Send,
  TimerOff,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import {
  getStatusMeta,
  type StatusIconName,
  type StatusKind,
  type StatusValueByKind,
} from "@/lib/formatting/status";

/** One Lucide icon for each key in the status mapping. The type makes a missing entry a compile error. */
export const STATUS_ICONS: Record<StatusIconName, LucideIcon> = {
  inbox: Inbox,
  "clipboard-list": ClipboardList,
  "file-text": FileText,
  "circle-check": CircleCheck,
  "circle-x": CircleX,
  briefcase: Briefcase,
  ban: Ban,
  "file-pen": FilePen,
  send: Send,
  "timer-off": TimerOff,
  "calendar-clock": CalendarClock,
  "calendar-check": CalendarCheck,
  wrench: Wrench,
  "calendar-x": CalendarX,
  receipt: Receipt,
  "circle-dashed": CircleDashed,
  "triangle-alert": TriangleAlert,
  banknote: Banknote,
  "bell-dot": BellDot,
  check: Check,
  clock: Clock,
  "mail-check": MailCheck,
  "scroll-text": ScrollText,
  "mail-x": MailX,
  "circle-minus": CircleMinus,
  "circle-help": CircleHelp,
};

type StatusBadgeSubject = {
  [K in StatusKind]: {
    /** Which record type the status belongs to; the same word (for example `ACCEPTED`) means different things on different records. */
    kind: K;
    status: StatusValueByKind[K];
  };
}[StatusKind];

export type StatusBadgeProps = StatusBadgeSubject &
  Omit<ComponentProps<typeof Badge>, "tone" | "children"> & {
    /** Hide the icon in dense places. The text label is always shown. */
    showIcon?: boolean | undefined;
  };

/**
 * The state of a record as a coloured badge with an icon and a text label. Colour is never the
 * only signal: the label always reads in full. Label, tone and icon come from the status mapping
 * in `lib/formatting/status.ts`, so every screen shows the same status the same way.
 *
 * ```tsx
 * <StatusBadge kind="invoice" status="OVERDUE" />
 * ```
 */
export function StatusBadge({ kind, status, showIcon = true, ...props }: StatusBadgeProps) {
  const meta = getStatusMeta(kind, status as never);
  const Icon = STATUS_ICONS[meta.icon];

  return (
    <Badge tone={meta.tone} data-status={status} {...props}>
      {showIcon ? <Icon aria-hidden="true" /> : null}
      {meta.label}
    </Badge>
  );
}
