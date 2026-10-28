import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  Bell,
  CalendarDays,
  FileText,
  Inbox,
  Receipt,
  Search,
  Settings,
  Users,
  Wrench,
} from "lucide-react";

import { Logo } from "@/components/ui/logo";
import { ScrollRegion } from "@/components/ui/scroll-region";
import {
  AA_NON_TEXT,
  CONTRAST_PAIRS,
  contrastRatio,
  parseThemeColors,
} from "@/lib/design/contrast";
import { cn } from "@/lib/utils";

import { Section, Specimen } from "../_lib/section";

interface Swatch {
  token: string;
  /** The utility class that paints it; written out in full so Tailwind can see it. */
  className: string;
  use: string;
}

const SWATCH_GROUPS: { title: string; swatches: Swatch[] }[] = [
  {
    title: "Surfaces, borders and text",
    swatches: [
      { token: "page", className: "bg-page", use: "Page background" },
      { token: "surface", className: "bg-surface", use: "Cards, tables, dialogs" },
      { token: "surface-muted", className: "bg-surface-muted", use: "Table headers, skeletons" },
      { token: "border", className: "bg-border", use: "Subtle edges, dividers" },
      { token: "border-strong", className: "bg-border-strong", use: "Form control boundaries" },
      { token: "ink", className: "bg-ink", use: "Body text" },
      { token: "ink-secondary", className: "bg-ink-secondary", use: "Supporting text" },
      { token: "ink-muted", className: "bg-ink-muted", use: "Metadata, placeholders" },
    ],
  },
  {
    title: "Brand and accent",
    swatches: [
      { token: "brand", className: "bg-brand", use: "Primary actions, links" },
      { token: "brand-hover", className: "bg-brand-hover", use: "Primary hover" },
      { token: "brand-deep", className: "bg-brand-deep", use: "Sidebar, footer" },
      { token: "brand-soft", className: "bg-brand-soft", use: "Selected, secondary buttons" },
      { token: "accent", className: "bg-accent", use: "Teal text and icons" },
      { token: "accent-fill", className: "bg-accent-fill", use: "Teal fills with dark text" },
      { token: "accent-soft", className: "bg-accent-soft", use: "Teal tint" },
      { token: "focus", className: "bg-focus", use: "Focus ring on light" },
    ],
  },
  {
    title: "Navigation (on brand-deep)",
    swatches: [
      { token: "nav-text", className: "bg-nav-text", use: "Link label" },
      { token: "nav-muted", className: "bg-nav-muted", use: "Group heading" },
      { token: "nav-hover", className: "bg-nav-hover", use: "Hovered item" },
      { token: "nav-active", className: "bg-nav-active", use: "Current page" },
      { token: "nav-border", className: "bg-nav-border", use: "Dividers" },
      { token: "focus-on-dark", className: "bg-focus-on-dark", use: "Focus ring on dark" },
    ],
  },
  {
    title: "Status tones (text, soft background, edge)",
    swatches: [
      { token: "info", className: "bg-info", use: "New, queued, waiting" },
      { token: "info-soft", className: "bg-info-soft", use: "Info background" },
      { token: "attention", className: "bg-attention", use: "Needs action" },
      { token: "attention-soft", className: "bg-attention-soft", use: "Attention background" },
      { token: "success", className: "bg-success", use: "Positive outcome" },
      { token: "success-soft", className: "bg-success-soft", use: "Success background" },
      { token: "danger", className: "bg-danger", use: "Problem, overdue" },
      { token: "danger-soft", className: "bg-danger-soft", use: "Danger background" },
      { token: "neutral", className: "bg-neutral", use: "Closed, draft, void" },
      { token: "neutral-soft", className: "bg-neutral-soft", use: "Neutral background" },
    ],
  },
];

const TYPE_SCALE = [
  {
    name: "5xl",
    spec: "52 / 60",
    className: "font-display text-5xl font-semibold",
    use: "Marketing hero",
    sample: "AC fixed, properly.",
  },
  {
    name: "4xl",
    spec: "40 / 48",
    className: "font-display text-4xl font-semibold",
    use: "Section headline",
    sample: "Booked in minutes",
  },
  {
    name: "3xl",
    spec: "30 / 38",
    className: "font-display text-3xl font-semibold",
    use: "Page title (sm and up)",
    sample: "Service requests",
  },
  {
    name: "2xl",
    spec: "24 / 32",
    className: "font-display text-2xl font-semibold",
    use: "Page title (phone), section heading",
    sample: "Quotation QT-2026-00042",
  },
  {
    name: "xl",
    spec: "20 / 28",
    className: "text-xl font-semibold",
    use: "Dialog title",
    sample: "Void this invoice?",
  },
  {
    name: "lg",
    spec: "18 / 28",
    className: "text-lg font-semibold",
    use: "Card title, lead text",
    sample: "Upcoming jobs",
  },
  {
    name: "base",
    spec: "16 / 24",
    className: "text-base",
    use: "Body text",
    sample: "A technician will confirm the appointment window by email.",
  },
  {
    name: "sm",
    spec: "14 / 20",
    className: "text-sm",
    use: "Tables, form text, helper text",
    sample: "Preferred window: Tuesday morning",
  },
  {
    name: "xs",
    spec: "12 / 16",
    className: "text-xs",
    use: "Badges, metadata",
    sample: "Submitted Oct 28, 2026",
  },
] as const;

const SPACING = [
  { token: "1", px: 4, className: "w-1" },
  { token: "2", px: 8, className: "w-2" },
  { token: "3", px: 12, className: "w-3" },
  { token: "4", px: 16, className: "w-4" },
  { token: "6", px: 24, className: "w-6" },
  { token: "8", px: 32, className: "w-8" },
  { token: "12", px: 48, className: "w-12" },
  { token: "16", px: 64, className: "w-16" },
] as const;

const RADII = [
  { token: "sm", px: 4, className: "rounded-sm", use: "Inline links" },
  { token: "md", px: 6, className: "rounded-md", use: "Tooltips, skeletons" },
  { token: "lg", px: 8, className: "rounded-lg", use: "Buttons, inputs" },
  { token: "xl", px: 12, className: "rounded-xl", use: "Cards, menus" },
  { token: "2xl", px: 16, className: "rounded-2xl", use: "Dialogs" },
  { token: "full", px: 0, className: "rounded-full", use: "Badges, avatars" },
] as const;

const SHADOWS = [
  { token: "none", className: "", use: "Flat: borders only (tables, filter bars)" },
  { token: "sm", className: "shadow-sm", use: "Cards" },
  { token: "md", className: "shadow-md", use: "Menus, popovers, tooltips" },
  { token: "lg", className: "shadow-lg", use: "Dialogs, drawers, toasts" },
] as const;

const ICONS = [
  { icon: Inbox, name: "Inbox" },
  { icon: FileText, name: "FileText" },
  { icon: CalendarDays, name: "CalendarDays" },
  { icon: Wrench, name: "Wrench" },
  { icon: Receipt, name: "Receipt" },
  { icon: Users, name: "Users" },
  { icon: Bell, name: "Bell" },
  { icon: Search, name: "Search" },
  { icon: Settings, name: "Settings" },
];

function loadColors(): Record<string, string> {
  return parseThemeColors(readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8"));
}

export function FoundationsSection() {
  const colors = loadColors();

  return (
    <>
      <Section
        id="colour"
        title="Colour"
        description="Deep navy-teal carries navigation and primary actions; a restrained teal marks active and positive things. Status colours always travel with text. Every colour is a token in globals.css; the default Tailwind palette is switched off."
      >
        {SWATCH_GROUPS.map((group) => (
          <Specimen key={group.title} title={group.title}>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {group.swatches.map((swatch) => (
                <li key={swatch.token} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-11 shrink-0 rounded-lg border border-border",
                      swatch.className,
                    )}
                  />
                  <span className="min-w-0 text-xs">
                    <span className="block font-semibold text-ink">{swatch.token}</span>
                    <span className="block text-ink-secondary tabular-nums">
                      {colors[swatch.token]}
                    </span>
                    <span className="block text-ink-muted">{swatch.use}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Specimen>
        ))}

        <Specimen title="Measured contrast (WCAG 2.2 AA). Text needs 4.5:1; icons, focus rings and control boundaries need 3:1">
          <ScrollRegion label="Contrast ratios of every documented colour pair">
            <table className="w-full min-w-160 border-collapse text-left text-xs">
              <caption className="sr-only">Contrast ratio of each documented colour pair</caption>
              <thead className="text-ink-secondary">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Use
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Foreground
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Background
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Ratio
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Needs
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {CONTRAST_PAIRS.map((pair) => {
                  const ratio = contrastRatio(
                    colors[pair.foreground] ?? "#000000",
                    colors[pair.background] ?? "#ffffff",
                  );
                  return (
                    <tr key={`${pair.foreground}-${pair.background}`}>
                      <td className="py-2 pr-3 text-ink">{pair.use}</td>
                      <td className="py-2 pr-3 text-ink-secondary">{pair.foreground}</td>
                      <td className="py-2 pr-3 text-ink-secondary">{pair.background}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{ratio.toFixed(2)}:1</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {pair.minimum === AA_NON_TEXT ? "3:1" : "4.5:1"}
                      </td>
                      <td className="py-2 font-medium text-success">
                        {ratio >= pair.minimum ? "Pass" : "FAIL"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        </Specimen>
      </Section>

      <Section
        id="typography"
        title="Typography"
        description="Inter for the interface and every number (tabular figures in tables and money); Bricolage Grotesque for page titles, dialog titles, the wordmark and marketing headlines. Both are self-hosted variable fonts."
      >
        <Specimen title="Type scale (size / line height in px)">
          <ul className="flex flex-col divide-y divide-border">
            {TYPE_SCALE.map((row) => (
              <li
                key={row.name}
                className="grid gap-1 py-3 sm:grid-cols-4 sm:items-baseline sm:gap-4"
              >
                <p className="text-xs text-ink-secondary sm:col-span-1">
                  <span className="font-semibold text-ink">{row.name}</span> · {row.spec}
                  <span className="block text-ink-muted">{row.use}</span>
                </p>
                <p className={cn("min-w-0 break-words text-ink sm:col-span-3", row.className)}>
                  {row.sample}
                </p>
              </li>
            ))}
          </ul>
        </Specimen>
        <Specimen title="Weights and numerals">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 text-base">
              <p className="font-normal">Regular 400: body text</p>
              <p className="font-medium">Medium 500: labels, buttons</p>
              <p className="font-semibold">Semibold 600: headings, table headers</p>
              <p className="font-bold">Bold 700: the wordmark</p>
            </div>
            <div className="flex flex-col gap-1 text-base">
              <p className="tabular-nums">$1,284.50 · FF-2026-00125</p>
              <p className="tabular-nums">$ 111.11 · FF-2026-00111</p>
              <p className="tabular-nums">$ 888.88 · FF-2026-00888</p>
              <p className="text-sm text-ink-secondary">
                Tabular figures keep amounts aligned in columns.
              </p>
            </div>
          </div>
        </Specimen>
      </Section>

      <Section
        id="spacing"
        title="Spacing, radii and elevation"
        description="Spacing is a 4 px scale (Tailwind's default step). Cards and tables are flat with a 1 px border; only floating things (menus, dialogs, toasts) carry a shadow."
      >
        <Specimen title="Spacing scale">
          <ul className="flex flex-col gap-2">
            {SPACING.map((step) => (
              <li key={step.token} className="flex items-center gap-3 text-xs text-ink-secondary">
                <span className="w-24 tabular-nums">
                  <span className="font-semibold text-ink">{step.token}</span> · {step.px}px
                </span>
                <span
                  aria-hidden="true"
                  className={cn("h-3 rounded-sm bg-brand", step.className)}
                />
              </li>
            ))}
          </ul>
        </Specimen>
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen title="Radii">
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {RADII.map((radius) => (
                <li key={radius.token} className="flex flex-col gap-1.5 text-xs text-ink-secondary">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-14 border border-border-strong bg-brand-soft",
                      radius.className,
                    )}
                  />
                  <span>
                    <span className="font-semibold text-ink">{radius.token}</span>
                    {radius.px > 0 ? ` · ${radius.px}px` : ""}
                    <span className="block text-ink-muted">{radius.use}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Specimen>
          <Specimen title="Elevation" className="bg-page">
            <ul className="grid grid-cols-2 gap-4">
              {SHADOWS.map((shadow) => (
                <li key={shadow.token} className="flex flex-col gap-2 text-xs text-ink-secondary">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-14 rounded-xl border border-border bg-surface",
                      shadow.className,
                    )}
                  />
                  <span>
                    <span className="font-semibold text-ink">{shadow.token}</span>
                    <span className="block text-ink-muted">{shadow.use}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Specimen>
        </div>
      </Section>

      <Section
        id="brand"
        title="Logo and iconography"
        description="The FixFlow mark is a roof over a line of flowing water on a rounded tile: home plus flow. It is original artwork drawn from two strokes. Icons are Lucide at 16, 20 or 24 px with the default 2 px stroke, always paired with a text label or an accessible name."
      >
        <div className="grid gap-6 md:grid-cols-3">
          <Specimen title="On light backgrounds">
            <div className="flex flex-col items-start gap-4">
              <Logo />
              <Logo markOnly />
            </div>
          </Specimen>
          <Specimen title="On dark backgrounds" surface="dark">
            <div className="flex flex-col items-start gap-4">
              <Logo variant="dark" />
              <Logo variant="dark" markOnly />
            </div>
          </Specimen>
          <Specimen title="Lucide icons at 16, 20 and 24 px">
            <ul className="grid grid-cols-3 gap-4 text-ink-secondary">
              {ICONS.map(({ icon: Icon, name }) => (
                <li key={name} className="flex items-end gap-1.5" title={name}>
                  <Icon aria-hidden="true" className="size-4" />
                  <Icon aria-hidden="true" className="size-5" />
                  <Icon aria-hidden="true" className="size-6" />
                </li>
              ))}
            </ul>
          </Specimen>
        </div>
      </Section>
    </>
  );
}
