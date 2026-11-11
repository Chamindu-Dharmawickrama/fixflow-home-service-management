"use client";

import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface MetricInfoProps {
  /** The figure's name, for the control's accessible name. */
  label: string;
  /** What the figure counts, in plain words (FR-085). */
  definition: string;
  /** Says whether the figure follows the chosen period or is the state right now. */
  scopeText: string;
}

/**
 * The "about this figure" control on a dashboard card: a button that opens a small panel with the
 * definition, so what a number means is one tap away and never guessed (FR-085). The panel is
 * non-modal; Escape or a click outside closes it, and focus returns to the button.
 */
export function MetricInfo({ label, definition, scopeText }: MetricInfoProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          className="inline-flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 ease-standard hover:bg-surface-muted hover:text-ink"
        >
          <Info aria-hidden="true" className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex flex-col gap-2">
        <p className="font-semibold text-ink">{label}</p>
        <p className="text-ink-secondary">{definition}</p>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{scopeText}</p>
      </PopoverContent>
    </Popover>
  );
}
