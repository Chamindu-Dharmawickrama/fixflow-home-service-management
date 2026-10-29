import type { LucideIcon } from "lucide-react";
import { Circle } from "lucide-react";

import { STATUS_ICONS } from "@/components/ui/status-badge";
import { STATUS_META, type StatusKind, type StatusTone } from "@/lib/formatting/status";

/**
 * Which record types to consult, in order, for a status word. The same word can exist on several
 * records (`ACCEPTED` on a request and on a quotation, `CANCELLED` on a request and a job), and where
 * it does, the status mapping gives it the same tone on each, so the first match is the right one.
 */
const KINDS_TO_SEARCH: readonly StatusKind[] = ["workOrder", "invoice", "quotation", "request"];

export interface EventAppearance {
  tone: StatusTone;
  icon: LucideIcon;
}

const NEUTRAL: EventAppearance = { tone: "neutral", icon: Circle };

/**
 * The colour and icon for the status an event led to, taken from the shared status mapping
 * (docs/DESIGN_SYSTEM.md §8) so the timeline matches the badges elsewhere. An event with no status,
 * or one this mapping does not know, gets a neutral dot.
 */
export function eventAppearance(toStatus: string | null): EventAppearance {
  if (toStatus === null) return NEUTRAL;
  for (const kind of KINDS_TO_SEARCH) {
    const table: Readonly<Record<string, { tone: StatusTone; icon: keyof typeof STATUS_ICONS }>> =
      STATUS_META[kind];
    const meta = Object.hasOwn(table, toStatus) ? table[toStatus] : undefined;
    if (meta !== undefined) {
      return { tone: meta.tone, icon: STATUS_ICONS[meta.icon] };
    }
  }
  return NEUTRAL;
}
