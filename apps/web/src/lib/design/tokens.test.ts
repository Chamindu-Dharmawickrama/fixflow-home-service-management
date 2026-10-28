import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AA_NON_TEXT,
  AA_TEXT,
  CONTRAST_PAIRS,
  contrastRatio,
  parseHexColor,
  parseThemeColors,
} from "./contrast";

const css = readFileSync(resolve(import.meta.dirname, "../../app/globals.css"), "utf8");
const colors = parseThemeColors(css);

describe("contrast helpers", () => {
  it("measures the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // The WCAG 2.x grey #767676 on white is the classic 4.54:1 example.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#14505e", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#14505e"),
      10,
    );
  });

  it("rejects malformed colours", () => {
    expect(() => parseHexColor("#fff")).toThrow();
    expect(() => parseHexColor("teal")).toThrow();
  });
});

describe("design tokens in globals.css", () => {
  it("declares every colour as a 6-digit hex value", () => {
    expect(Object.keys(colors).length).toBeGreaterThan(30);
  });

  it.each(
    CONTRAST_PAIRS.map((pair) => [`${pair.foreground} on ${pair.background}`, pair] as const),
  )("%s keeps its contrast promise", (_name, pair) => {
    const foreground = colors[pair.foreground];
    const background = colors[pair.background];
    expect(foreground, `--color-${pair.foreground} is not declared`).toBeDefined();
    expect(background, `--color-${pair.background} is not declared`).toBeDefined();

    const ratio = contrastRatio(foreground ?? "", background ?? "");
    expect(ratio, `${pair.use}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(pair.minimum);
  });

  it("only uses the two WCAG thresholds", () => {
    for (const pair of CONTRAST_PAIRS) {
      expect([AA_TEXT, AA_NON_TEXT]).toContain(pair.minimum);
    }
  });

  it("resets the default Tailwind palette, scale, radii and shadows", () => {
    for (const reset of ["--color-*", "--text-*", "--radius-*", "--shadow-*"]) {
      expect(css).toContain(`${reset}: initial;`);
    }
  });

  it("does not use ad-hoc colour values outside the token declarations", () => {
    const outsideTheme = css.slice(css.indexOf("@layer base"));
    expect(outsideTheme).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  // Run with PRINT_CONTRAST=1 to regenerate the table in docs/DESIGN_SYSTEM.md.
  it.runIf(process.env.PRINT_CONTRAST === "1")("prints the contrast table", () => {
    const rows = CONTRAST_PAIRS.map((pair) => {
      const fg = colors[pair.foreground] ?? "";
      const bg = colors[pair.background] ?? "";
      const ratio = contrastRatio(fg, bg);
      return `| ${pair.use} | \`${pair.foreground}\` ${fg} | \`${pair.background}\` ${bg} | ${ratio.toFixed(2)}:1 | ${pair.minimum}:1 | Pass |`;
    });
    console.info(rows.join("\n"));
  });
});
