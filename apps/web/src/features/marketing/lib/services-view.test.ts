import { PricingMode, type PublicServiceDto } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  categoriesOf,
  filterByCategory,
  parseCategoryParam,
  pricingNote,
  relatedServices,
  servicesPath,
  splitParagraphs,
} from "./services-view";

function service(slug: string, category: string): Pick<PublicServiceDto, "slug" | "category"> {
  return { slug, category };
}

const LIST = [
  service("ac-diagnostic-visit", "Air conditioning"),
  service("ac-routine-maintenance", "Air conditioning"),
  service("washing-machine-repair", "Appliance repair"),
  service("electrical-safety-inspection", "Electrical"),
  service("home-deep-cleaning", "Cleaning"),
];

describe("categoriesOf", () => {
  it("lists each category once, in the order it first appears", () => {
    expect(categoriesOf(LIST)).toEqual([
      "Air conditioning",
      "Appliance repair",
      "Electrical",
      "Cleaning",
    ]);
  });

  it("treats differences of case and surrounding space as the same category", () => {
    expect(
      categoriesOf([
        service("a", "Cleaning"),
        service("b", " cleaning "),
        service("c", "CLEANING"),
      ]),
    ).toEqual(["Cleaning"]);
  });

  it("is empty for an empty list", () => {
    expect(categoriesOf([])).toEqual([]);
  });
});

describe("parseCategoryParam", () => {
  it("returns the category as one trimmed string", () => {
    expect(parseCategoryParam("Air conditioning")).toBe("Air conditioning");
    expect(parseCategoryParam("  Cleaning ")).toBe("Cleaning");
  });

  it("takes the first when the parameter is repeated", () => {
    expect(parseCategoryParam(["Electrical", "Cleaning"])).toBe("Electrical");
  });

  it("treats a missing or blank parameter as no filter", () => {
    expect(parseCategoryParam(undefined)).toBeUndefined();
    expect(parseCategoryParam("")).toBeUndefined();
    expect(parseCategoryParam("   ")).toBeUndefined();
    expect(parseCategoryParam([])).toBeUndefined();
  });
});

describe("filterByCategory", () => {
  it("returns every service without a category", () => {
    expect(filterByCategory(LIST, undefined)).toHaveLength(5);
  });

  it("returns only the services in the category, ignoring case", () => {
    expect(filterByCategory(LIST, "air CONDITIONING").map((s) => s.slug)).toEqual([
      "ac-diagnostic-visit",
      "ac-routine-maintenance",
    ]);
  });

  it("returns nothing for a category no service has", () => {
    expect(filterByCategory(LIST, "Roof repair")).toEqual([]);
  });

  it("does not change the list it is given", () => {
    const copy = [...LIST];
    filterByCategory(LIST, "Cleaning");
    expect(LIST).toEqual(copy);
  });
});

describe("relatedServices", () => {
  it("never includes the service itself", () => {
    const current = LIST[1] as (typeof LIST)[number];
    expect(relatedServices(LIST, current).map((s) => s.slug)).not.toContain(current.slug);
  });

  it("puts services of the same category first, then the rest in display order", () => {
    const current = LIST[1] as (typeof LIST)[number];
    expect(relatedServices(LIST, current).map((s) => s.slug)).toEqual([
      "ac-diagnostic-visit",
      "washing-machine-repair",
      "electrical-safety-inspection",
    ]);
  });

  it("stops at the limit", () => {
    const current = LIST[0] as (typeof LIST)[number];
    expect(relatedServices(LIST, current, 2)).toHaveLength(2);
  });

  it("is empty when there is no other service", () => {
    const only = service("only", "Cleaning");
    expect(relatedServices([only], only)).toEqual([]);
  });
});

describe("splitParagraphs", () => {
  it("splits at blank lines and keeps a single line break inside a paragraph", () => {
    expect(splitParagraphs("First line\ncontinues here.\n\nSecond paragraph.")).toEqual([
      "First line continues here.",
      "Second paragraph.",
    ]);
  });

  it("ignores empty paragraphs and surrounding space", () => {
    expect(splitParagraphs("\n\n  One.  \n \n\n\nTwo.\n\n")).toEqual(["One.", "Two."]);
    expect(splitParagraphs("")).toEqual([]);
  });
});

describe("servicesPath", () => {
  it("is the plain list without a category", () => {
    expect(servicesPath()).toBe("/services");
  });

  it("encodes the category so it survives in a URL", () => {
    expect(servicesPath("Air conditioning")).toBe("/services?category=Air%20conditioning");
    expect(servicesPath("Heating & cooling")).toBe("/services?category=Heating%20%26%20cooling");
  });
});

describe("pricingNote (FR-003)", () => {
  it("says what a fixed-price service starts from and that the quotation confirms the price", () => {
    expect(
      pricingNote({
        pricingMode: PricingMode.FIXED,
        startingPrice: "129.00",
        currencyCode: "USD",
      }),
    ).toBe("Starting from $129.00 — final price confirmed in your written quotation");
  });

  it("uses the business currency", () => {
    expect(
      pricingNote({ pricingMode: PricingMode.FIXED, startingPrice: "89.50", currencyCode: "EUR" }),
    ).toContain("€89.50");
  });

  it("says a quoted service is priced after review", () => {
    expect(
      pricingNote({
        pricingMode: PricingMode.QUOTE_REQUIRED,
        startingPrice: null,
        currencyCode: "USD",
      }),
    ).toBe("Priced after we review your request");
  });

  it("does not invent a price for a fixed service that has none", () => {
    expect(
      pricingNote({ pricingMode: PricingMode.FIXED, startingPrice: null, currencyCode: "USD" }),
    ).toBe("Priced after we review your request");
  });
});
