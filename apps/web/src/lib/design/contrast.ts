/**
 * WCAG 2.x contrast helpers and the list of colour pairs the design system promises to keep
 * accessible. `tokens.test.ts` measures every pair against `src/app/globals.css`, so editing a
 * colour token that breaks a promise fails the build instead of shipping.
 */

export type Rgb = readonly [number, number, number];

export function parseHexColor(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) {
    throw new Error(`Expected a 6-digit hex colour, received "${hex}".`);
  }
  const value = match[1];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function channelLuminance(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Reads every `--color-name: #rrggbb;` declaration in a stylesheet, keyed by `name`. */
export function parseThemeColors(css: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    const [, name, value] = match;
    if (name && value) {
      colors[name] = value.toLowerCase();
    }
  }
  return colors;
}

export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;

export interface ContrastPair {
  /** Token name without the `--color-` prefix. */
  readonly foreground: string;
  readonly background: string;
  /** 4.5 for text, 3 for large text, icons, focus rings and control boundaries. */
  readonly minimum: typeof AA_TEXT | typeof AA_NON_TEXT;
  readonly use: string;
}

const text = (foreground: string, background: string, use: string): ContrastPair => ({
  foreground,
  background,
  minimum: AA_TEXT,
  use,
});
const nonText = (foreground: string, background: string, use: string): ContrastPair => ({
  foreground,
  background,
  minimum: AA_NON_TEXT,
  use,
});

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  text("ink", "page", "Body text on the page"),
  text("ink", "surface", "Body text on cards and tables"),
  text("ink", "surface-muted", "Body text on table headers and zebra rows"),
  text("ink-secondary", "page", "Secondary text on the page"),
  text("ink-secondary", "surface", "Secondary text on cards"),
  text("ink-secondary", "surface-muted", "Secondary text on muted surfaces"),
  text("ink-muted", "page", "Metadata and placeholders on the page"),
  text("ink-muted", "surface", "Metadata and placeholders on cards"),
  text("ink-muted", "surface-muted", "Metadata on muted surfaces"),

  text("surface", "brand", "Primary button label"),
  text("surface", "brand-hover", "Primary button label on hover"),
  text("brand", "surface", "Links and secondary-button labels on cards"),
  text("brand", "page", "Links on the page"),
  text("brand", "brand-soft", "Selected or secondary-button label"),
  text("brand", "surface-muted", "Secondary-button label on hover"),

  text("accent", "surface", "Teal text and icons on cards"),
  text("accent", "page", "Teal text and icons on the page"),
  text("accent", "accent-soft", "Teal emphasis on its soft tint"),
  text("ink", "accent-fill", "Label on a bright teal fill"),
  text("brand-deep", "accent-fill", "Deep navy label on a bright teal fill"),

  text("nav-text", "brand-deep", "Navigation label on the sidebar"),
  text("surface", "brand-deep", "Brand name and headings on the sidebar"),
  text("nav-muted", "brand-deep", "Navigation group heading"),
  text("nav-text", "nav-hover", "Navigation label while hovered"),
  text("surface", "nav-active", "Active navigation label"),

  text("success", "success-soft", "Success badge"),
  text("attention", "attention-soft", "Attention badge"),
  text("danger", "danger-soft", "Danger badge and error message tint"),
  text("info", "info-soft", "Info badge"),
  text("neutral", "neutral-soft", "Neutral badge"),
  text("success", "surface", "Success text and icons on cards"),
  text("attention", "surface", "Attention text and icons on cards"),
  text("danger", "surface", "Error text and icons on cards"),
  text("info", "surface", "Info text and icons on cards"),
  text("neutral", "surface", "Neutral text and icons on cards"),
  text("surface", "danger", "Destructive button label"),
  text("surface", "danger-hover", "Destructive button label on hover"),

  nonText("border-strong", "surface", "Form control boundary on cards"),
  nonText("border-strong", "page", "Form control boundary on the page"),
  nonText("focus", "surface", "Focus ring on cards"),
  nonText("focus", "page", "Focus ring on the page"),
  nonText("focus", "brand-soft", "Focus ring on selected rows"),
  nonText("focus-on-dark", "brand-deep", "Focus ring on the sidebar"),
  nonText("focus-on-dark", "nav-hover", "Focus ring on a hovered sidebar item"),
  nonText("accent-fill", "brand-deep", "Active-item marker on the sidebar"),
];
