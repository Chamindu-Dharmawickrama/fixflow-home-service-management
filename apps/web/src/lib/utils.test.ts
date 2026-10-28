import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("joins class names and drops falsy values", () => {
    expect(cn("px-4", false, undefined, null, "py-2", { hidden: false, block: true })).toBe(
      "px-4 py-2 block",
    );
  });

  it("lets the last conflicting utility win", () => {
    expect(cn("px-4", "px-6")).toBe("px-6");
    expect(cn("bg-surface", "bg-brand")).toBe("bg-brand");
    expect(cn("rounded-lg", "rounded-xl")).toBe("rounded-xl");
  });

  it("treats FixFlow colour tokens as colours, separate from text sizes", () => {
    expect(cn("text-sm", "text-ink-muted")).toBe("text-sm text-ink-muted");
    expect(cn("text-ink", "text-brand")).toBe("text-brand");
    expect(cn("text-ink-secondary", "text-sm", "text-danger")).toBe("text-sm text-danger");
    expect(cn("border", "border-border-strong")).toBe("border border-border-strong");
    expect(cn("border-border", "border-border-strong")).toBe("border-border-strong");
  });

  it("keeps the display font next to a font weight", () => {
    expect(cn("font-display", "font-semibold")).toBe("font-display font-semibold");
    expect(cn("font-sans", "font-display")).toBe("font-display");
  });

  it("keeps ring offsets and shadows from clobbering colours", () => {
    expect(cn("shadow-sm", "shadow-md")).toBe("shadow-md");
    expect(cn("bg-brand", "text-surface")).toBe("bg-brand text-surface");
  });
});
