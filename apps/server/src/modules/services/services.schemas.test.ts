import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import {
  adminServicesQuerySchema,
  createServiceBodySchema,
  lifecycleBodySchema,
  publicServicesQuerySchema,
  serviceIdParamsSchema,
  serviceSlugParamsSchema,
  updateServiceBodySchema,
} from "./services.schemas.js";

function run<T extends z.ZodType>(schema: T, input: unknown) {
  const result = schema.safeParse(input);
  return result.success
    ? { data: result.data, errors: undefined }
    : { data: undefined, errors: fieldErrorsFromZod(result.error) };
}

const VALID_FIXED = {
  name: "AC Routine Maintenance",
  category: "Air conditioning",
  shortDescription: "A yearly service that keeps your air conditioner efficient.",
  fullDescription: "A thorough service for split and ducted air conditioners.",
  pricingMode: "FIXED",
  startingPrice: "129",
};

describe("createServiceBodySchema", () => {
  it("accepts the minimum, filling defaults: unpublished, no picture, no inclusions", () => {
    expect(run(createServiceBodySchema, VALID_FIXED).data).toEqual({
      ...VALID_FIXED,
      startingPrice: "129.00",
      inclusions: [],
      estimatedDurationMinutes: null,
      imageKey: null,
      imageUrl: null,
      sortOrder: 0,
      isPublished: false,
    });
  });

  it("leaves a missing slug out, for the server to generate", () => {
    expect(run(createServiceBodySchema, VALID_FIXED).data).not.toHaveProperty("slug");
    expect(run(createServiceBodySchema, { ...VALID_FIXED, slug: "ac-yearly" }).data).toHaveProperty(
      "slug",
      "ac-yearly",
    );
  });

  it("accepts a quote-only service without a price", () => {
    const { startingPrice: _price, ...rest } = VALID_FIXED;
    expect(
      run(createServiceBodySchema, { ...rest, pricingMode: "QUOTE_REQUIRED" }).data,
    ).toMatchObject({ pricingMode: "QUOTE_REQUIRED", startingPrice: null });
  });

  it("requires a starting price for a fixed-price service", () => {
    const { startingPrice: _price, ...rest } = VALID_FIXED;
    const expected = { startingPrice: "Enter a starting price for a fixed-price service." };
    expect(run(createServiceBodySchema, rest).errors).toEqual(expected);
    expect(run(createServiceBodySchema, { ...rest, startingPrice: null }).errors).toEqual(expected);
  });

  it("refuses a starting price on a quote-only service", () => {
    expect(
      run(createServiceBodySchema, { ...VALID_FIXED, pricingMode: "QUOTE_REQUIRED" }).errors
        ?.startingPrice,
    ).toMatch(/only used with fixed pricing/);
  });

  describe("startingPrice", () => {
    it.each([
      ["129", "129.00"],
      ["129.5", "129.50"],
      ["0.01", "0.01"],
      ["999999.99", "999999.99"],
    ])("accepts %s as %s", (input, stored) => {
      expect(
        run(createServiceBodySchema, { ...VALID_FIXED, startingPrice: input }).data,
      ).toMatchObject({ startingPrice: stored });
    });

    it.each(["0", "0.00", "-5", "1000000", "12.345", "abc", "", "1e3", "$129"])(
      "rejects %j",
      (value) => {
        expect(
          run(createServiceBodySchema, { ...VALID_FIXED, startingPrice: value }).errors
            ?.startingPrice,
        ).toBeDefined();
      },
    );

    it("is text: a JSON number is refused, so money is never a float", () => {
      expect(
        run(createServiceBodySchema, { ...VALID_FIXED, startingPrice: 129 }).errors?.startingPrice,
      ).toBe("Enter the starting price as an amount, like 129.00.");
    });
  });

  describe("inclusions", () => {
    it("accepts up to 12 items of up to 120 characters, trimmed", () => {
      const items = Array.from({ length: 12 }, (_, index) => ` Item ${index + 1} `);
      const data = run(createServiceBodySchema, { ...VALID_FIXED, inclusions: items }).data;
      expect(data?.inclusions).toHaveLength(12);
      expect(data?.inclusions[0]).toBe("Item 1");
      expect(
        run(createServiceBodySchema, { ...VALID_FIXED, inclusions: ["x".repeat(120)] }).errors,
      ).toBeUndefined();
    });

    it("refuses a thirteenth item", () => {
      const items = Array.from({ length: 13 }, (_, index) => `Item ${index + 1}`);
      expect(run(createServiceBodySchema, { ...VALID_FIXED, inclusions: items }).errors).toEqual({
        inclusions: "Add no more than 12 inclusions.",
      });
    });

    it("names the offending item, by position", () => {
      expect(
        run(createServiceBodySchema, {
          ...VALID_FIXED,
          inclusions: ["Fine", "x".repeat(121), "  ", "Also fine"],
        }).errors,
      ).toEqual({
        "inclusions.1": "The inclusion must be 120 characters or fewer.",
        "inclusions.2": "Enter the inclusion.",
      });
    });

    it("must be a list", () => {
      expect(
        run(createServiceBodySchema, { ...VALID_FIXED, inclusions: "Filter cleaning" }).errors
          ?.inclusions,
      ).toBe("Enter the inclusions as a list.");
    });
  });

  describe("slug", () => {
    it.each(["ac-repair", "a", "heat-pump-2"])("accepts %s", (slug) => {
      expect(run(createServiceBodySchema, { ...VALID_FIXED, slug }).errors).toBeUndefined();
    });

    it.each(["AC-Repair", "ac repair", "-ac", "ac-", "ac--repair", "../etc", "ac_repair", ""])(
      "rejects %j",
      (slug) => {
        expect(run(createServiceBodySchema, { ...VALID_FIXED, slug }).errors?.slug).toBeDefined();
      },
    );
  });

  it("refuses a bundled picture together with a web address", () => {
    expect(
      run(createServiceBodySchema, {
        ...VALID_FIXED,
        imageKey: "cleaning",
        imageUrl: "https://example.test/a.jpg",
      }).errors,
    ).toEqual({ imageUrl: "Choose either a bundled picture or a web address, not both." });
  });

  it("accepts a bundled key or an https address and refuses paths and plain http", () => {
    expect(
      run(createServiceBodySchema, { ...VALID_FIXED, imageKey: "cleaning" }).errors,
    ).toBeUndefined();
    expect(
      run(createServiceBodySchema, { ...VALID_FIXED, imageUrl: "https://example.test/a.jpg" })
        .errors,
    ).toBeUndefined();
    expect(
      run(createServiceBodySchema, { ...VALID_FIXED, imageKey: "../a" }).errors?.imageKey,
    ).toBe("Choose one of the available pictures.");
    expect(
      run(createServiceBodySchema, { ...VALID_FIXED, imageUrl: "http://example.test/a.jpg" }).errors
        ?.imageUrl,
    ).toBe("The picture address must be a web address starting with https://");
  });

  describe("limits", () => {
    it.each([
      ["name", "xx", "The service name must be at least 3 characters."],
      ["name", "x".repeat(81), "The service name must be 80 characters or fewer."],
      ["category", "x", "The category must be at least 2 characters."],
      ["category", "x".repeat(51), "The category must be 50 characters or fewer."],
      ["shortDescription", "too short", "The short description must be at least 10 characters."],
      [
        "shortDescription",
        "x".repeat(201),
        "The short description must be 200 characters or fewer.",
      ],
      [
        "fullDescription",
        "x".repeat(2001),
        "The full description must be 2000 characters or fewer.",
      ],
    ])("refuses %s %j", (field, value, message) => {
      expect(run(createServiceBodySchema, { ...VALID_FIXED, [field]: value }).errors?.[field]).toBe(
        message,
      );
    });

    it.each([
      ["estimatedDurationMinutes", 4],
      ["estimatedDurationMinutes", 721],
      ["estimatedDurationMinutes", 60.5],
      ["estimatedDurationMinutes", "60"],
      ["sortOrder", -1],
      ["sortOrder", 10_000],
      ["sortOrder", 1.5],
    ])("refuses %s %j", (field, value) => {
      expect(
        run(createServiceBodySchema, { ...VALID_FIXED, [field]: value }).errors?.[field],
      ).toBeDefined();
    });

    it("accepts the boundary values", () => {
      expect(
        run(createServiceBodySchema, {
          ...VALID_FIXED,
          name: "xxx",
          estimatedDurationMinutes: 5,
          sortOrder: 9999,
        }).errors,
      ).toBeUndefined();
      expect(
        run(createServiceBodySchema, { ...VALID_FIXED, estimatedDurationMinutes: 720 }).errors,
      ).toBeUndefined();
    });
  });

  it("rejects unknown keys, including the lifecycle columns a client must never set", () => {
    expect(
      run(createServiceBodySchema, { ...VALID_FIXED, archivedAt: "2026-01-01", id: "x" }).errors,
    ).toEqual({ archivedAt: "Unknown field.", id: "Unknown field." });
  });

  it("explains a missing pricing mode", () => {
    const { pricingMode: _mode, ...rest } = VALID_FIXED;
    expect(run(createServiceBodySchema, rest).errors?.pricingMode).toBe(
      "Choose how the service is priced.",
    );
  });
});

describe("updateServiceBodySchema", () => {
  it("accepts a single field, with no defaults filled in", () => {
    expect(run(updateServiceBodySchema, { name: "AC Yearly Service" }).data).toEqual({
      name: "AC Yearly Service",
    });
  });

  it("accepts the publish flag and the expected status", () => {
    expect(
      run(updateServiceBodySchema, { isPublished: true, expectedStatus: "UNPUBLISHED" }).data,
    ).toEqual({ isPublished: true, expectedStatus: "UNPUBLISHED" });
  });

  it("needs something to change: the expected status alone is not enough", () => {
    expect(run(updateServiceBodySchema, {}).errors).toEqual({
      _: "Send at least one field to change.",
    });
    expect(run(updateServiceBodySchema, { expectedStatus: "PUBLISHED" }).errors).toEqual({
      _: "Send at least one field to change.",
    });
  });

  it("rejects an expected status that is not a state", () => {
    expect(
      run(updateServiceBodySchema, { name: "AC Yearly", expectedStatus: "DELETED" }).errors
        ?.expectedStatus,
    ).toBe("expectedStatus must be PUBLISHED, UNPUBLISHED or ARCHIVED.");
  });

  it("rejects switching to fixed pricing with an explicit null price", () => {
    expect(
      run(updateServiceBodySchema, { pricingMode: "FIXED", startingPrice: null }).errors,
    ).toEqual({ startingPrice: "Enter a starting price for a fixed-price service." });
  });

  it("allows 'quote required' without mentioning the price (the server clears it)", () => {
    expect(run(updateServiceBodySchema, { pricingMode: "QUOTE_REQUIRED" }).errors).toBeUndefined();
  });

  it("can clear optional fields", () => {
    expect(
      run(updateServiceBodySchema, {
        estimatedDurationMinutes: null,
        imageKey: null,
        imageUrl: "",
      }).data,
    ).toEqual({ estimatedDurationMinutes: null, imageKey: null, imageUrl: null });
  });

  it("rejects unknown keys", () => {
    expect(run(updateServiceBodySchema, { name: "Valid name", archivedAt: null }).errors).toEqual({
      archivedAt: "Unknown field.",
    });
  });
});

describe("lifecycleBodySchema", () => {
  it("needs the state the caller saw", () => {
    expect(run(lifecycleBodySchema, { expectedStatus: "PUBLISHED" }).data).toEqual({
      expectedStatus: "PUBLISHED",
    });
    expect(run(lifecycleBodySchema, {}).errors).toBeDefined();
    expect(run(lifecycleBodySchema, { expectedStatus: "nope" }).errors).toBeDefined();
    expect(run(lifecycleBodySchema, { expectedStatus: "ARCHIVED", extra: 1 }).errors).toEqual({
      extra: "Unknown field.",
    });
  });
});

describe("params and queries", () => {
  it("accepts a UUID id and a kebab-case slug, and refuses the rest", () => {
    const id = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";
    expect(run(serviceIdParamsSchema, { id }).data).toEqual({ id });
    expect(run(serviceIdParamsSchema, { id: "slug" }).errors?.id).toBeDefined();
    expect(run(serviceSlugParamsSchema, { slug: "ac-repair" }).data).toEqual({ slug: "ac-repair" });
    expect(run(serviceSlugParamsSchema, { slug: "AC Repair" }).errors?.slug).toBeDefined();
    expect(run(serviceSlugParamsSchema, { slug: "a".repeat(81) }).errors?.slug).toBeDefined();
  });

  it("public list: the category is optional and blank means none", () => {
    expect(run(publicServicesQuerySchema, {}).data).toEqual({ category: undefined });
    expect(run(publicServicesQuerySchema, { category: " Cleaning " }).data).toEqual({
      category: "Cleaning",
    });
    expect(run(publicServicesQuerySchema, { category: "  " }).data).toEqual({
      category: undefined,
    });
    expect(
      run(publicServicesQuerySchema, { category: "x".repeat(51) }).errors?.category,
    ).toBeDefined();
  });

  it("admin list: defaults to the website's order, 20 per page", () => {
    expect(run(adminServicesQuerySchema, {}).data).toEqual({
      page: 1,
      pageSize: 20,
      sort: "sortOrder",
      order: "asc",
      status: undefined,
      search: undefined,
    });
  });

  it("admin list: filters by status and search, with an allowlist of sort fields", () => {
    expect(
      run(adminServicesQuerySchema, {
        status: "archived",
        search: " ac ",
        sort: "updatedAt",
        order: "desc",
        page: "2",
        pageSize: "50",
      }).data,
    ).toEqual({
      page: 2,
      pageSize: 50,
      sort: "updatedAt",
      order: "desc",
      status: "archived",
      search: "ac",
    });
    expect(run(adminServicesQuerySchema, { status: "deleted" }).errors?.status).toBe(
      "status must be one of: published, unpublished, archived.",
    );
    expect(run(adminServicesQuerySchema, { sort: "startingPrice" }).errors?.sort).toBeDefined();
    expect(run(adminServicesQuerySchema, { pageSize: "101" }).errors?.pageSize).toBeDefined();
    expect(run(adminServicesQuerySchema, { search: "x".repeat(101) }).errors?.search).toBeDefined();
    expect(run(adminServicesQuerySchema, { search: "   " }).data?.search).toBeUndefined();
  });
});
