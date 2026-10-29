import {
  CalendarCheck,
  ClipboardList,
  FileCheck,
  FileText,
  ListChecks,
  type LucideIcon,
  Mail,
  MapPin,
  Phone,
  Receipt,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";

import type { ContentIcon } from "../content/site-content";

/** One Lucide icon for each name used in the content module. The type makes a missing entry a compile error. */
export const CONTENT_ICONS: Record<ContentIcon, LucideIcon> = {
  "clipboard-list": ClipboardList,
  "file-text": FileText,
  "calendar-check": CalendarCheck,
  receipt: Receipt,
  "file-check": FileCheck,
  "list-checks": ListChecks,
  "receipt-text": ReceiptText,
  "map-pin": MapPin,
  phone: Phone,
  mail: Mail,
  "shield-check": ShieldCheck,
};
