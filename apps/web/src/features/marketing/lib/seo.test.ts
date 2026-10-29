import { describe, expect, it } from "vitest";

import { buildPageMetadata, FALLBACK_BUSINESS_NAME, pageTitle, truncateDescription } from "./seo";

describe("pageTitle", () => {
  it("writes the page first and the business second (D-31)", () => {
    expect(pageTitle("AC Routine Maintenance", "CoolBreeze Home Services")).toBe(
      "AC Routine Maintenance · CoolBreeze Home Services",
    );
  });

  it("names the product when the business is unknown", () => {
    expect(pageTitle("Our services", FALLBACK_BUSINESS_NAME)).toBe("Our services · FixFlow");
  });
});

describe("truncateDescription", () => {
  it("leaves a short description alone and collapses stray whitespace", () => {
    expect(truncateDescription("  A yearly   service.\n It keeps units efficient. ")).toBe(
      "A yearly service. It keeps units efficient.",
    );
  });

  it("cuts a long one at a word, within the limit, and marks the cut", () => {
    const long = "word ".repeat(80).trim();
    const result = truncateDescription(long);
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toMatch(/wor…$/);
  });

  it("does not leave punctuation hanging before the ellipsis", () => {
    const text = `${"a".repeat(150)} ,, and more words after it`;
    expect(truncateDescription(text)).not.toMatch(/[,;:.\-–—]…$/);
  });

  it("honours another limit", () => {
    expect(truncateDescription("one two three four five", 12).length).toBeLessThanOrEqual(12);
  });
});

describe("buildPageMetadata", () => {
  const base = {
    pageName: "AC Routine Maintenance",
    businessName: "CoolBreeze Home Services",
    description: "A yearly service that keeps your air conditioner efficient.",
    path: "/services/ac-routine-maintenance",
  } as const;

  it("sets an absolute title so the root layout's FixFlow template is not appended", () => {
    expect(buildPageMetadata(base).title).toEqual({
      absolute: "AC Routine Maintenance · CoolBreeze Home Services",
    });
  });

  it("sets the description, a relative canonical URL and the Open Graph and Twitter tags", () => {
    const metadata = buildPageMetadata(base);
    expect(metadata.description).toBe(base.description);
    expect(metadata.alternates).toEqual({ canonical: base.path });
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: "CoolBreeze Home Services",
      title: "AC Routine Maintenance · CoolBreeze Home Services",
      description: base.description,
      url: base.path,
    });
    expect(metadata.twitter).toMatchObject({ card: "summary" });
  });

  it("asks search engines to stay away only when told to", () => {
    expect(buildPageMetadata(base).robots).toBeUndefined();
    expect(buildPageMetadata({ ...base, noIndex: false }).robots).toBeUndefined();
    expect(buildPageMetadata({ ...base, noIndex: true }).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("shortens a description that is too long for a search result", () => {
    const metadata = buildPageMetadata({ ...base, description: "x ".repeat(200) });
    expect((metadata.description ?? "").length).toBeLessThanOrEqual(160);
  });
});
