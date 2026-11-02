import type { TechnicianColor } from "@fixflow/shared";

/**
 * What each technician colour looks like, from the `--color-cal-*` tokens in `globals.css`.
 * Tailwind finds a class only when it is written out whole, so every class is spelled here instead
 * of being built from the key (`bg-cal-${key}` would not exist). The `Record` type makes a palette
 * key without an entry a compile error, and `tokens.test.ts` keeps each pair readable (4.5:1).
 *
 * - `dot`: a solid swatch beside a name.
 * - `edge`: the left edge of a calendar block (T19).
 * - `block`: the fill and the text of a calendar block.
 */
export interface TechnicianColorStyle {
  /** The colour's name, for people who cannot tell the swatches apart. */
  label: string;
  dot: string;
  edge: string;
  block: string;
}

export const TECHNICIAN_COLOR_STYLES: Record<TechnicianColor, TechnicianColorStyle> = {
  blue: {
    label: "Blue",
    dot: "bg-cal-blue",
    edge: "border-cal-blue",
    block: "bg-cal-blue-soft text-cal-blue",
  },
  green: {
    label: "Green",
    dot: "bg-cal-green",
    edge: "border-cal-green",
    block: "bg-cal-green-soft text-cal-green",
  },
  amber: {
    label: "Amber",
    dot: "bg-cal-amber",
    edge: "border-cal-amber",
    block: "bg-cal-amber-soft text-cal-amber",
  },
  purple: {
    label: "Purple",
    dot: "bg-cal-purple",
    edge: "border-cal-purple",
    block: "bg-cal-purple-soft text-cal-purple",
  },
  rose: {
    label: "Rose",
    dot: "bg-cal-rose",
    edge: "border-cal-rose",
    block: "bg-cal-rose-soft text-cal-rose",
  },
  teal: {
    label: "Teal",
    dot: "bg-cal-teal",
    edge: "border-cal-teal",
    block: "bg-cal-teal-soft text-cal-teal",
  },
  orange: {
    label: "Orange",
    dot: "bg-cal-orange",
    edge: "border-cal-orange",
    block: "bg-cal-orange-soft text-cal-orange",
  },
  slate: {
    label: "Slate",
    dot: "bg-cal-slate",
    edge: "border-cal-slate",
    block: "bg-cal-slate-soft text-cal-slate",
  },
};
