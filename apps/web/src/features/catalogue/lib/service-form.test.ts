import type { AdminServiceDto } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { changedBodyFields } from "./changed-fields";
import {
  EMPTY_SERVICE_VALUES,
  formFieldForApiError,
  serviceFormSchema,
  type ServiceFormValues,
  serviceToFormValues,
  toServiceBody,
} from "./service-form";

const VALID: ServiceFormValues = {
  name: "AC Routine Maintenance",
  slug: "ac-routine-maintenance",
  category: "Air conditioning",
  shortDescription: "A yearly service that keeps your air conditioner efficient.",
  fullDescription: "A thorough service for split and ducted air conditioners, best in spring.",
  inclusions: [{ text: "Filter cleaning" }, { text: "Refrigerant check" }],
  estimatedDurationMinutes: "90",
  pricingMode: "FIXED",
  startingPrice: "129.00",
  imageSource: "bundled",
  imageKey: "air-conditioning",
  imageUrl: "",
  sortOrder: "20",
};

const DTO: AdminServiceDto = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  name: "AC Routine Maintenance",
  slug: "ac-routine-maintenance",
  category: "Air conditioning",
  shortDescription: "A yearly service that keeps your air conditioner efficient.",
  fullDescription: "A thorough service for split and ducted air conditioners, best in spring.",
  inclusions: ["Filter cleaning", "Refrigerant check"],
  estimatedDurationMinutes: 90,
  pricingMode: "FIXED",
  startingPrice: "129.00",
  currencyCode: "USD",
  imageKey: "air-conditioning",
  imageUrl: null,
  sortOrder: 20,
  isPublished: true,
  archivedAt: null,
  status: "PUBLISHED",
  isActive: true,
  availableActions: ["EDIT", "UNPUBLISH", "ARCHIVE"],
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-28T10:30:00.000Z",
};

function errorsFor(values: Partial<ServiceFormValues>): Record<string, string> {
  const result = serviceFormSchema.safeParse({ ...VALID, ...values });
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

describe("serviceFormSchema", () => {
  it("accepts a complete service", () => {
    expect(errorsFor({})).toEqual({});
  });

  it("accepts a quote-only service with no price, picture or inclusions", () => {
    expect(
      errorsFor({
        pricingMode: "QUOTE_REQUIRED",
        startingPrice: "",
        imageSource: "none",
        imageKey: "",
        inclusions: [],
        estimatedDurationMinutes: "",
      }),
    ).toEqual({});
  });

  it.each([
    ["name", "", "Enter the service name."],
    ["name", "AC", "The service name must be at least 3 characters."],
    ["name", "x".repeat(81), "The service name must be 80 characters or fewer."],
    ["category", "", "Enter the category."],
    ["category", "x".repeat(51), "The category must be 50 characters or fewer."],
    ["shortDescription", "Too short", "The short description must be at least 10 characters."],
    ["fullDescription", "x".repeat(2001), "The full description must be 2000 characters or fewer."],
    ["slug", "", "Enter the web address."],
    ["slug", "AC Repair", "Use lower-case letters, numbers and single hyphens, like ac-repair."],
    ["slug", "ac--repair", "Use lower-case letters, numbers and single hyphens, like ac-repair."],
    ["estimatedDurationMinutes", "4", "Enter whole minutes from 5 to 720, or leave it empty."],
    ["estimatedDurationMinutes", "721", "Enter whole minutes from 5 to 720, or leave it empty."],
    ["estimatedDurationMinutes", "1.5", "Enter whole minutes from 5 to 720, or leave it empty."],
    [
      "estimatedDurationMinutes",
      "an hour",
      "Enter whole minutes from 5 to 720, or leave it empty.",
    ],
    ["sortOrder", "-1", "Enter a whole number from 0 to 9999."],
    ["sortOrder", "10000", "Enter a whole number from 0 to 9999."],
    ["sortOrder", "", "Enter a whole number from 0 to 9999."],
  ] as const)("flags %s %j", (field, value, message) => {
    expect(errorsFor({ [field]: value })[field]).toBe(message);
  });

  it("asks for a starting price only with fixed pricing, and checks it", () => {
    expect(errorsFor({ startingPrice: "" }).startingPrice).toBe(
      "Enter a starting price for a fixed-price service.",
    );
    for (const price of ["0", "0.00", "-5", "12.345", "abc", "1e3", "1000000"]) {
      expect(errorsFor({ startingPrice: price }).startingPrice, price).toBe(
        "Enter the starting price as an amount above zero, like 129.00.",
      );
    }
    expect(errorsFor({ startingPrice: "129" })).toEqual({});
    expect(errorsFor({ startingPrice: "0.01" })).toEqual({});
    // A price left in the box does not matter once pricing is by quotation: it is not sent.
    expect(errorsFor({ pricingMode: "QUOTE_REQUIRED", startingPrice: "abc" })).toEqual({});
  });

  it("limits inclusions to 12 non-blank rows of 120 characters, ignoring blank rows", () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ text: `Item ${i}` }));
    expect(errorsFor({ inclusions: rows(12) })).toEqual({});
    expect(errorsFor({ inclusions: [...rows(12), { text: "   " }] })).toEqual({});
    expect(errorsFor({ inclusions: rows(13) }).inclusions).toBe("Add no more than 12 inclusions.");
    expect(errorsFor({ inclusions: [{ text: "x".repeat(121) }] })["inclusions.0.text"]).toBe(
      "An inclusion must be 120 characters or fewer.",
    );
    expect(errorsFor({ inclusions: [{ text: "x".repeat(120) }] })).toEqual({});
  });

  it("needs a picture when 'bundled' is chosen and an https address when 'url' is", () => {
    expect(errorsFor({ imageSource: "bundled", imageKey: "" }).imageKey).toBe("Choose a picture.");
    expect(errorsFor({ imageSource: "url", imageUrl: "http://example.test/a.jpg" }).imageUrl).toBe(
      "Enter a web address starting with https://",
    );
    expect(
      errorsFor({ imageSource: "url", imageUrl: "javascript:alert(1)" }).imageUrl,
    ).toBeDefined();
    expect(errorsFor({ imageSource: "url", imageUrl: "https://cdn.example.test/a.jpg" })).toEqual(
      {},
    );
    // A key or address left behind in a hidden box is not sent, so it is not checked.
    expect(errorsFor({ imageSource: "none", imageKey: "", imageUrl: "nonsense" })).toEqual({});
  });
});

describe("toServiceBody", () => {
  it("converts the form's text to the API's types", () => {
    expect(toServiceBody(VALID)).toEqual({
      name: "AC Routine Maintenance",
      slug: "ac-routine-maintenance",
      category: "Air conditioning",
      shortDescription: "A yearly service that keeps your air conditioner efficient.",
      fullDescription: "A thorough service for split and ducted air conditioners, best in spring.",
      inclusions: ["Filter cleaning", "Refrigerant check"],
      estimatedDurationMinutes: 90,
      pricingMode: "FIXED",
      startingPrice: "129.00",
      imageKey: "air-conditioning",
      imageUrl: null,
      sortOrder: 20,
    });
  });

  it("trims text, drops blank inclusions and turns an empty duration into null", () => {
    const body = toServiceBody({
      ...VALID,
      name: "  AC Routine Maintenance ",
      inclusions: [{ text: " Filter cleaning " }, { text: "   " }, { text: "" }, { text: "Check" }],
      estimatedDurationMinutes: "  ",
    });
    expect(body.name).toBe("AC Routine Maintenance");
    expect(body.inclusions).toEqual(["Filter cleaning", "Check"]);
    expect(body.estimatedDurationMinutes).toBeNull();
  });

  it("sends no price for a quote-only service, even if one is still typed in the hidden box", () => {
    expect(
      toServiceBody({ ...VALID, pricingMode: "QUOTE_REQUIRED", startingPrice: "99" }).startingPrice,
    ).toBeNull();
  });

  it("sends only the picture source that is chosen", () => {
    expect(toServiceBody({ ...VALID, imageSource: "none" })).toMatchObject({
      imageKey: null,
      imageUrl: null,
    });
    expect(
      toServiceBody({
        ...VALID,
        imageSource: "url",
        imageKey: "cleaning",
        imageUrl: " https://cdn.example.test/a.jpg ",
      }),
    ).toMatchObject({ imageKey: null, imageUrl: "https://cdn.example.test/a.jpg" });
    expect(
      toServiceBody({ ...VALID, imageSource: "bundled", imageUrl: "https://x.test/a" }),
    ).toMatchObject({
      imageKey: "air-conditioning",
      imageUrl: null,
    });
  });
});

describe("serviceToFormValues", () => {
  it("round-trips: the form built from a service sends that same service back", () => {
    expect(serviceToFormValues(DTO)).toEqual(VALID);
    expect(toServiceBody(serviceToFormValues(DTO))).toEqual({
      name: DTO.name,
      slug: DTO.slug,
      category: DTO.category,
      shortDescription: DTO.shortDescription,
      fullDescription: DTO.fullDescription,
      inclusions: DTO.inclusions,
      estimatedDurationMinutes: DTO.estimatedDurationMinutes,
      pricingMode: DTO.pricingMode,
      startingPrice: DTO.startingPrice,
      imageKey: DTO.imageKey,
      imageUrl: DTO.imageUrl,
      sortOrder: DTO.sortOrder,
    });
  });

  it("maps a web-address picture and a quote-only service with no estimate", () => {
    const values = serviceToFormValues({
      ...DTO,
      pricingMode: "QUOTE_REQUIRED",
      startingPrice: null,
      imageKey: null,
      imageUrl: "https://cdn.example.test/a.jpg",
      estimatedDurationMinutes: null,
      inclusions: [],
    });
    expect(values).toMatchObject({
      pricingMode: "QUOTE_REQUIRED",
      startingPrice: "",
      imageSource: "url",
      imageKey: "",
      imageUrl: "https://cdn.example.test/a.jpg",
      estimatedDurationMinutes: "",
      inclusions: [],
    });
  });

  it("starts a new service blank and quote-only, in a form that does not validate yet", () => {
    expect(serviceFormSchema.safeParse(EMPTY_SERVICE_VALUES).success).toBe(false);
    expect(EMPTY_SERVICE_VALUES.imageSource).toBe("none");
  });
});

describe("changedBodyFields", () => {
  it("returns only the fields that differ, compared by value", () => {
    const before = toServiceBody(VALID);
    const after = toServiceBody({
      ...VALID,
      name: "AC Yearly Service",
      inclusions: [{ text: "Filter cleaning" }],
    });
    expect(changedBodyFields(before, after)).toEqual({
      name: "AC Yearly Service",
      inclusions: ["Filter cleaning"],
    });
  });

  it("is empty when nothing changed, even though arrays are new objects", () => {
    expect(changedBodyFields(toServiceBody(VALID), toServiceBody({ ...VALID }))).toEqual({});
  });

  it("reports a field that became null", () => {
    expect(
      changedBodyFields(toServiceBody(VALID), toServiceBody({ ...VALID, imageSource: "none" })),
    ).toEqual({ imageKey: null });
  });
});

describe("formFieldForApiError", () => {
  it("keeps most names, points an inclusion error at its row's box, and a list error at the form", () => {
    expect(formFieldForApiError("slug")).toBe("slug");
    expect(formFieldForApiError("startingPrice")).toBe("startingPrice");
    expect(formFieldForApiError("inclusions.3")).toBe("inclusions.3.text");
    expect(formFieldForApiError("inclusions")).toBe("_");
  });
});
