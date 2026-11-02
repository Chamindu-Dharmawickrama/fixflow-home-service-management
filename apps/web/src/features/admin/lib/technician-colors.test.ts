import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TECHNICIAN_COLORS } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { parseThemeColors } from "@/lib/design/contrast";

import { TECHNICIAN_COLOR_STYLES } from "./technician-colors";

const css = readFileSync(resolve(import.meta.dirname, "../../../app/globals.css"), "utf8");
const tokens = parseThemeColors(css);

describe("TECHNICIAN_COLOR_STYLES", () => {
  it("has an entry for every key of the shared palette, and nothing else", () => {
    expect(Object.keys(TECHNICIAN_COLOR_STYLES).sort()).toEqual([...TECHNICIAN_COLORS].sort());
  });

  it.each(TECHNICIAN_COLORS)(
    "%s: every class names a token that is declared in globals.css",
    (color) => {
      const style = TECHNICIAN_COLOR_STYLES[color];

      expect(style.dot).toBe(`bg-cal-${color}`);
      expect(style.edge).toBe(`border-cal-${color}`);
      expect(style.block).toBe(`bg-cal-${color}-soft text-cal-${color}`);
      // The tokens behind those classes exist (a class with no token would paint nothing).
      expect(tokens[`cal-${color}`], `--color-cal-${color}`).toBeDefined();
      expect(tokens[`cal-${color}-soft`], `--color-cal-${color}-soft`).toBeDefined();
    },
  );

  it("gives each colour a name a person can read, and no two the same", () => {
    const labels = TECHNICIAN_COLORS.map((color) => TECHNICIAN_COLOR_STYLES[color].label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("gives each colour its own swatch", () => {
    const hexes = TECHNICIAN_COLORS.map((color) => tokens[`cal-${color}`]);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});
