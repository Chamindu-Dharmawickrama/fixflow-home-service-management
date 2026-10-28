import {
  Briefcase,
  Calendar,
  ClipboardList,
  FileText,
  House,
  Inbox,
  Layers,
  LayoutDashboard,
  type LucideIcon,
  Palette,
  Receipt,
  Settings,
  User,
  Users,
  Wrench,
} from "lucide-react";

import type { NavIconName } from "@/lib/navigation";

/** One Lucide icon for each key in `NAV_ICON_NAMES`. The type makes a missing entry a compile error. */
export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  inbox: Inbox,
  "file-text": FileText,
  briefcase: Briefcase,
  calendar: Calendar,
  users: Users,
  wrench: Wrench,
  receipt: Receipt,
  settings: Settings,
  house: House,
  user: User,
  palette: Palette,
  layers: Layers,
  "clipboard-list": ClipboardList,
};
