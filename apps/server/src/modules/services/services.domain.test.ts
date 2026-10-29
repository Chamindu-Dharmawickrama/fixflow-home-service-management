import { ErrorCode, ServiceCatalogueState } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { AppError } from "../../lib/errors.js";
import {
  actionForPublishFlag,
  applyTransition,
  assertExpectedStatus,
  availableActions,
  changedServiceFields,
  isValidStartingPrice,
  LIFECYCLE_EVENTS,
  type LifecycleAction,
  mergeServiceValues,
  pickFreeSlug,
  SERVICE_FIELDS,
  type ServiceValues,
  stateAfter,
  validateServiceValues,
} from "./services.domain.js";

const NOW = new Date("2026-10-29T12:00:00.000Z");
const EARLIER = new Date("2026-10-01T09:00:00.000Z");

const PUBLISHED = { isPublished: true, archivedAt: null };
const UNPUBLISHED = { isPublished: false, archivedAt: null };
const ARCHIVED = { isPublished: false, archivedAt: EARLIER };

const FIXED: ServiceValues = {
  name: "AC Routine Maintenance",
  slug: "ac-routine-maintenance",
  category: "Air conditioning",
  shortDescription: "A yearly service that keeps your air conditioner efficient.",
  fullDescription: "A thorough service for split and ducted air conditioners.",
  inclusions: ["Filter cleaning", "Refrigerant check"],
  estimatedDurationMinutes: 90,
  pricingMode: "FIXED",
  startingPrice: "129.00",
  imageKey: "air-conditioning",
  imageUrl: null,
  sortOrder: 20,
};

function caught(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("Expected the call to throw an AppError.");
}

describe("availableActions (D-43)", () => {
  it("offers unpublish and archive on a published service", () => {
    expect(availableActions("PUBLISHED")).toEqual(["EDIT", "UNPUBLISH", "ARCHIVE"]);
  });

  it("offers publish and archive on an unpublished one", () => {
    expect(availableActions("UNPUBLISHED")).toEqual(["EDIT", "PUBLISH", "ARCHIVE"]);
  });

  it("offers only restore (and editing) on an archived one", () => {
    expect(availableActions("ARCHIVED")).toEqual(["EDIT", "RESTORE"]);
  });

  it("returns a copy, so a caller cannot change the rules", () => {
    availableActions("PUBLISHED").pop();
    expect(availableActions("PUBLISHED")).toHaveLength(3);
  });

  it("agrees with the transitions: every offered action is allowed and nothing else is", () => {
    const lifecycleActions: LifecycleAction[] = ["PUBLISH", "UNPUBLISH", "ARCHIVE", "RESTORE"];
    for (const state of Object.values(ServiceCatalogueState)) {
      const allowed = lifecycleActions.filter((action) => stateAfter(state, action) !== undefined);
      expect(
        availableActions(state)
          .filter((action) => action !== "EDIT")
          .sort(),
      ).toEqual(allowed.sort());
    }
  });
});

describe("applyTransition", () => {
  it("publishes an unpublished service", () => {
    expect(applyTransition(UNPUBLISHED, "PUBLISH", NOW)).toEqual({
      isPublished: true,
      archivedAt: null,
    });
  });

  it("unpublishes a published service", () => {
    expect(applyTransition(PUBLISHED, "UNPUBLISH", NOW)).toEqual({
      isPublished: false,
      archivedAt: null,
    });
  });

  it("archives from either live state: off the website, stamped with the time", () => {
    expect(applyTransition(PUBLISHED, "ARCHIVE", NOW)).toEqual({
      isPublished: false,
      archivedAt: NOW,
    });
    expect(applyTransition(UNPUBLISHED, "ARCHIVE", NOW)).toEqual({
      isPublished: false,
      archivedAt: NOW,
    });
  });

  it("restores an archived service as unpublished, never straight back on the website", () => {
    expect(applyTransition(ARCHIVED, "RESTORE", NOW)).toEqual({
      isPublished: false,
      archivedAt: null,
    });
  });

  it.each([
    ["publish", PUBLISHED, "PUBLISH", "published"],
    ["publish", ARCHIVED, "PUBLISH", "archived"],
    ["unpublish", UNPUBLISHED, "UNPUBLISH", "unpublished"],
    ["unpublish", ARCHIVED, "UNPUBLISH", "archived"],
    ["archive", ARCHIVED, "ARCHIVE", "archived"],
    ["restore", PUBLISHED, "RESTORE", "published"],
    ["restore", UNPUBLISHED, "RESTORE", "unpublished"],
  ] as const)(
    "refuses to %s a service that is already %s-state: 409 INVALID_STATE_TRANSITION",
    (_verb, from, action, words) => {
      const error = caught(() => applyTransition(from, action, NOW));
      expect(error.status).toBe(409);
      expect(error.code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
      expect(error.message).toContain(words);
      expect(error.details).toMatchObject({ action });
    },
  );

  it("treats an archived row that is somehow still published as archived", () => {
    expect(
      caught(() => applyTransition({ isPublished: true, archivedAt: EARLIER }, "PUBLISH", NOW))
        .code,
    ).toBe(ErrorCode.INVALID_STATE_TRANSITION);
  });
});

describe("actionForPublishFlag", () => {
  it("maps the flag to the action that makes it true", () => {
    expect(actionForPublishFlag("UNPUBLISHED", true)).toBe("PUBLISH");
    expect(actionForPublishFlag("PUBLISHED", false)).toBe("UNPUBLISH");
  });

  it("does nothing when the service already is what was asked", () => {
    expect(actionForPublishFlag("PUBLISHED", true)).toBeUndefined();
    expect(actionForPublishFlag("UNPUBLISHED", false)).toBeUndefined();
    expect(actionForPublishFlag("ARCHIVED", false)).toBeUndefined();
  });

  it("still asks to publish an archived service, so the transition can refuse it", () => {
    expect(actionForPublishFlag("ARCHIVED", true)).toBe("PUBLISH");
  });
});

describe("assertExpectedStatus (D-46)", () => {
  it("passes when nothing was expected or the state matches", () => {
    expect(() => {
      assertExpectedStatus("PUBLISHED", undefined);
    }).not.toThrow();
    expect(() => {
      assertExpectedStatus("PUBLISHED", "PUBLISHED");
    }).not.toThrow();
  });

  it("answers 409 STALE_STATE with the current status when the service moved on", () => {
    const error = caught(() => {
      assertExpectedStatus("ARCHIVED", "PUBLISHED");
    });
    expect(error.status).toBe(409);
    expect(error.code).toBe(ErrorCode.STALE_STATE);
    expect(error.details).toEqual({ currentStatus: "ARCHIVED" });
  });
});

describe("lifecycle events", () => {
  it("names one history event per action, in the dotted form activity requires", () => {
    for (const { action } of Object.values(LIFECYCLE_EVENTS)) {
      expect(action).toMatch(/^service\.[a-z]+$/);
    }
    expect(Object.values(LIFECYCLE_EVENTS).map(({ action }) => action)).toEqual([
      "service.published",
      "service.unpublished",
      "service.archived",
      "service.restored",
    ]);
  });
});

describe("pickFreeSlug", () => {
  it("uses the base when it is free", () => {
    expect(pickFreeSlug("ac-repair", new Set())).toBe("ac-repair");
    expect(pickFreeSlug("ac-repair", new Set(["ac-repair-2"]))).toBe("ac-repair");
  });

  it("adds the first number that is free", () => {
    expect(pickFreeSlug("ac-repair", new Set(["ac-repair"]))).toBe("ac-repair-2");
    expect(pickFreeSlug("ac-repair", new Set(["ac-repair", "ac-repair-2", "ac-repair-3"]))).toBe(
      "ac-repair-4",
    );
    expect(pickFreeSlug("ac-repair", new Set(["ac-repair", "ac-repair-3"]))).toBe("ac-repair-2");
  });

  it("shortens a base that is already at the limit, without a stray hyphen", () => {
    const base = `${"a".repeat(79)}`;
    const slug = pickFreeSlug(base, new Set([base]));
    expect(slug).toBe(`${"a".repeat(78)}-2`);
    expect(slug.length).toBeLessThanOrEqual(80);

    // 79 characters ending in "-b": cutting to make room for "-2" would leave "…a-", whose hyphen goes.
    const hyphenated = `${"a".repeat(77)}-b`;
    expect(pickFreeSlug(hyphenated, new Set([hyphenated]))).toBe(`${"a".repeat(77)}-2`);
  });
});

describe("isValidStartingPrice", () => {
  it.each(["0.01", "1.00", "129.00", "999999.99"])("accepts %s", (value) => {
    expect(isValidStartingPrice(value)).toBe(true);
  });

  it.each(["0.00", "1000000.00", "9999999.99"])("rejects %s", (value) => {
    expect(isValidStartingPrice(value)).toBe(false);
  });
});

describe("mergeServiceValues", () => {
  it("replaces the fields that were sent and keeps the rest", () => {
    const merged = mergeServiceValues(FIXED, { name: "AC Yearly Service", sortOrder: 5 });
    expect(merged).toEqual({ ...FIXED, name: "AC Yearly Service", sortOrder: 5 });
  });

  it("ignores fields that are undefined, but honours null", () => {
    expect(mergeServiceValues(FIXED, { imageKey: undefined })).toEqual(FIXED);
    expect(mergeServiceValues(FIXED, { imageKey: null }).imageKey).toBeNull();
    expect(
      mergeServiceValues(FIXED, { estimatedDurationMinutes: null }).estimatedDurationMinutes,
    ).toBeNull();
  });

  it("clears the price when the service becomes quote-only and nothing was said about it", () => {
    const merged = mergeServiceValues(FIXED, { pricingMode: "QUOTE_REQUIRED" });
    expect(merged.pricingMode).toBe("QUOTE_REQUIRED");
    expect(merged.startingPrice).toBeNull();
    expect(validateServiceValues(merged)).toEqual({});
  });

  it("does not clear a price that was sent with the change (so the contradiction is reported)", () => {
    const merged = mergeServiceValues(FIXED, {
      pricingMode: "QUOTE_REQUIRED",
      startingPrice: "99.00",
    });
    expect(merged.startingPrice).toBe("99.00");
    expect(validateServiceValues(merged)).toHaveProperty("startingPrice");
  });

  it("does not change the object it was given", () => {
    const before = structuredClone(FIXED);
    mergeServiceValues(FIXED, { name: "Other", inclusions: ["One"] });
    expect(FIXED).toEqual(before);
  });
});

describe("validateServiceValues", () => {
  it("accepts a fixed-price service with a price and a quote-only one without", () => {
    expect(validateServiceValues(FIXED)).toEqual({});
    expect(
      validateServiceValues({ ...FIXED, pricingMode: "QUOTE_REQUIRED", startingPrice: null }),
    ).toEqual({});
  });

  it("requires a price for fixed pricing", () => {
    expect(validateServiceValues({ ...FIXED, startingPrice: null })).toEqual({
      startingPrice: "Enter a starting price for a fixed-price service.",
    });
  });

  it("refuses a price on a quote-only service", () => {
    expect(
      validateServiceValues({ ...FIXED, pricingMode: "QUOTE_REQUIRED" }).startingPrice,
    ).toMatch(/only used with fixed pricing/);
  });

  it("refuses a bundled picture and a web address together", () => {
    expect(validateServiceValues({ ...FIXED, imageUrl: "https://example.test/a.jpg" })).toEqual({
      imageUrl: "Choose either a bundled picture or a web address, not both.",
    });
  });
});

describe("changedServiceFields", () => {
  it("is empty for identical values", () => {
    expect(changedServiceFields(FIXED, { ...FIXED, inclusions: [...FIXED.inclusions] })).toEqual(
      [],
    );
  });

  it("names the fields that differ, in form order", () => {
    expect(
      changedServiceFields(FIXED, { ...FIXED, sortOrder: 1, name: "New name", slug: "new-name" }),
    ).toEqual(["name", "slug", "sortOrder"]);
  });

  it("compares inclusions item by item and by order", () => {
    expect(changedServiceFields(FIXED, { ...FIXED, inclusions: ["Filter cleaning"] })).toEqual([
      "inclusions",
    ]);
    expect(
      changedServiceFields(FIXED, {
        ...FIXED,
        inclusions: ["Refrigerant check", "Filter cleaning"],
      }),
    ).toEqual(["inclusions"]);
    expect(changedServiceFields(FIXED, { ...FIXED, inclusions: [...FIXED.inclusions] })).toEqual(
      [],
    );
  });

  it("sees null and a value as different", () => {
    expect(changedServiceFields(FIXED, { ...FIXED, estimatedDurationMinutes: null })).toEqual([
      "estimatedDurationMinutes",
    ]);
  });

  it("covers every content field", () => {
    expect(SERVICE_FIELDS).toHaveLength(Object.keys(FIXED).length);
    expect([...SERVICE_FIELDS].sort()).toEqual(Object.keys(FIXED).sort());
  });
});
