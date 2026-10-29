import { CalendarCheck, ClipboardList, FileText, Receipt } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatusBadge, type StatusBadgeProps } from "@/components/ui/status-badge";

import { HERO, HERO_EXAMPLE_STAGES } from "../content/site-content";

const STAGE_ICONS = {
  request: ClipboardList,
  quotation: FileText,
  workOrder: CalendarCheck,
  invoice: Receipt,
} as const;

/**
 * The hero's picture: not a photograph but the product itself, the four stages a request passes
 * through, each with the status badge the real screens show. It is labelled as an example so it
 * can never be taken for a customer's record, and it uses no names or amounts.
 */
export function HeroExample() {
  return (
    <div className="rounded-2xl bg-brand-soft p-4 sm:p-8">
      <Card className="mx-auto max-w-md p-5 shadow-md sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink">{HERO.exampleLabel}</p>
          <Badge tone="neutral">Example</Badge>
        </div>
        <ol className="flex flex-col">
          {HERO_EXAMPLE_STAGES.map((stage, index) => {
            const Icon = STAGE_ICONS[stage.kind];
            const last = index === HERO_EXAMPLE_STAGES.length - 1;
            return (
              <li key={stage.kind} className="relative flex items-center gap-4 pb-5 last:pb-0">
                {last ? null : (
                  <span
                    aria-hidden="true"
                    className="absolute left-5 top-10 -ml-px h-[calc(100%-2.5rem)] w-0.5 bg-border"
                  />
                )}
                <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0 flex-1 text-base font-medium text-ink">{stage.label}</span>
                <StatusBadge
                  {...({ kind: stage.kind, status: stage.status } as StatusBadgeProps)}
                />
              </li>
            );
          })}
        </ol>
        <p className="mt-5 border-t border-border pt-4 text-sm text-ink-secondary">
          Sample data. Your own requests appear here once you sign in.
        </p>
      </Card>
    </div>
  );
}
