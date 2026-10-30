import type { PublicServiceDto, ServiceAddressDto } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  createRequestFormSchema,
  defaultAddressId,
  DESCRIPTION_TOO_SHORT,
  EMPTY_NEW_ADDRESS,
  initialRequestValues,
  REQUEST_FIELD_LABELS,
  type RequestFormValues,
  resolveServicePreselection,
  serviceSlugParam,
  toRequestBody,
} from "./request-form";

const LIMITS = { min: "2026-11-02", max: "2027-01-30" };
const KEY = "2d8e3a20-8b3c-4d20-9b3f-4f1f5c9e1c33";
const DESCRIPTION = "The AC unit stopped cooling overnight and rattles loudly when it starts up.";

function address(overrides: Partial<ServiceAddressDto> = {}): ServiceAddressDto {
  return {
    id: "a1",
    label: "Home",
    line1: "214 Larkspur Lane",
    line2: null,
    city: "Harbor City",
    region: "NY",
    postalCode: "10001",
    accessNotes: null,
    isDefault: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function values(overrides: Partial<RequestFormValues> = {}): RequestFormValues {
  return {
    serviceId: "s1",
    description: DESCRIPTION,
    addressMode: "saved",
    serviceAddressId: "a1",
    newAddress: { ...EMPTY_NEW_ADDRESS },
    saveAddressToProfile: false,
    preferredDate: "2026-11-10",
    preferredWindow: "MORNING",
    ...overrides,
  };
}

/** Field path -> message, for everything the form would show. */
function problems(input: RequestFormValues): Record<string, string> {
  const result = createRequestFormSchema(LIMITS).safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
}

describe("createRequestFormSchema", () => {
  it("accepts a complete request for a saved address", () => {
    expect(problems(values())).toEqual({});
  });

  it("accepts a complete request for a typed address that is not saved", () => {
    const typed = values({
      addressMode: "new",
      serviceAddressId: "",
      newAddress: {
        ...EMPTY_NEW_ADDRESS,
        line1: "73 Millrace Court",
        city: "Harbor City",
        postalCode: "10998",
      },
    });

    expect(problems(typed)).toEqual({});
  });

  it("asks for everything that is missing, each beside its own field", () => {
    const empty = values({
      serviceId: "",
      description: "",
      serviceAddressId: "",
      preferredDate: "",
      preferredWindow: "",
    });

    expect(problems(empty)).toEqual({
      serviceId: "Choose a service.",
      description: "Tell us what is wrong so we can prepare a quotation.",
      serviceAddressId: "Choose where the work is to be done.",
      preferredDate: "Choose a date.",
      preferredWindow: "Choose a time window.",
    });
  });

  describe("description", () => {
    it("needs at least 20 characters once trimmed, and says so", () => {
      expect(problems(values({ description: "Broken." })).description).toBe(DESCRIPTION_TOO_SHORT);
      expect(problems(values({ description: `  ${"x".repeat(19)}  ` })).description).toBe(
        DESCRIPTION_TOO_SHORT,
      );
      expect(problems(values({ description: "x".repeat(20) }))).toEqual({});
    });

    it("allows 2000 characters and no more", () => {
      expect(problems(values({ description: "x".repeat(2000) }))).toEqual({});
      expect(problems(values({ description: "x".repeat(2001) })).description).toMatch(/2000/);
    });

    it("treats blank text as missing, not as too short", () => {
      expect(problems(values({ description: "      " })).description).toMatch(/Tell us what/);
    });
  });

  describe("preferred date", () => {
    it.each([
      ["the first day", "2026-11-02"],
      ["the last day", "2027-01-30"],
      ["a day in between", "2026-12-24"],
    ])("accepts %s of the range", (_name, preferredDate) => {
      expect(problems(values({ preferredDate }))).toEqual({});
    });

    it("refuses a day before the range, with the same words as the API", () => {
      expect(problems(values({ preferredDate: "2026-11-01" })).preferredDate).toBe(
        "Choose a date from tomorrow onwards.",
      );
    });

    it("refuses a day after the range, with the same words as the API", () => {
      expect(problems(values({ preferredDate: "2027-01-31" })).preferredDate).toBe(
        "Choose a date within the next 90 days.",
      );
    });

    it("refuses a date that does not exist", () => {
      expect(problems(values({ preferredDate: "2026-02-30" })).preferredDate).toBe(
        "Choose a date.",
      );
    });

    it("uses the limits it was given, not today's date", () => {
      const schema = createRequestFormSchema({ min: "2030-01-01", max: "2030-03-31" });

      expect(schema.safeParse(values({ preferredDate: "2030-02-01" })).success).toBe(true);
      expect(schema.safeParse(values({ preferredDate: "2026-11-10" })).success).toBe(false);
    });
  });

  describe("address", () => {
    const typedBase = (overrides: Partial<RequestFormValues["newAddress"]> = {}) =>
      values({
        addressMode: "new",
        serviceAddressId: "",
        newAddress: {
          ...EMPTY_NEW_ADDRESS,
          line1: "73 Millrace Court",
          city: "Harbor City",
          postalCode: "10998",
          ...overrides,
        },
      });

    it("needs a saved address to be chosen in saved mode", () => {
      expect(problems(values({ serviceAddressId: "" }))).toEqual({
        serviceAddressId: "Choose where the work is to be done.",
      });
    });

    it("ignores the typed fields in saved mode, however empty", () => {
      expect(problems(values({ newAddress: { ...EMPTY_NEW_ADDRESS } }))).toEqual({});
    });

    it("ignores a missing saved choice in new mode", () => {
      expect(problems(typedBase())).toEqual({});
    });

    it("asks for the street, city and postal code of a typed address, under newAddress", () => {
      const missing = values({ addressMode: "new", serviceAddressId: "" });

      expect(Object.keys(problems(missing)).sort()).toEqual([
        "newAddress.city",
        "newAddress.line1",
        "newAddress.postalCode",
      ]);
    });

    it("refuses a postal code with odd characters", () => {
      expect(problems(typedBase({ postalCode: "10@98!" }))["newAddress.postalCode"]).toMatch(
        /letters, numbers, spaces and hyphens/,
      );
    });

    it("needs no label unless the address is saved", () => {
      expect(problems(typedBase({ label: "" }))).toEqual({});
    });

    it("needs a label to save a typed address, and a real one", () => {
      const save = (label: string) => ({ ...typedBase({ label }), saveAddressToProfile: true });

      expect(problems(save(""))["newAddress.label"]).toMatch(/Enter a label/);
      expect(problems(save("   "))["newAddress.label"]).toMatch(/Enter a label/);
      expect(problems(save("H"))["newAddress.label"]).toMatch(/at least 2/);
      expect(problems(save("Rental unit"))).toEqual({});
    });
  });

  it("has a label for every field it can report, for the error summary", () => {
    const empty = values({
      serviceId: "",
      description: "",
      addressMode: "new",
      serviceAddressId: "",
      saveAddressToProfile: true,
      preferredDate: "",
      preferredWindow: "",
    });

    for (const path of Object.keys(problems(empty))) {
      expect(REQUEST_FIELD_LABELS, path).toHaveProperty([path]);
    }
  });
});

describe("toRequestBody", () => {
  it("sends the saved address's id and nothing about a typed one", () => {
    expect(toRequestBody(values({ description: `  ${DESCRIPTION}  ` }), KEY)).toEqual({
      serviceId: "s1",
      description: DESCRIPTION,
      serviceAddressId: "a1",
      preferredDate: "2026-11-10",
      preferredWindow: "MORNING",
      submissionKey: KEY,
    });
  });

  it("sends a typed address without a label when it is not saved", () => {
    const body = toRequestBody(
      values({
        addressMode: "new",
        serviceAddressId: "a1",
        newAddress: {
          label: "Leftover label",
          line1: " 73 Millrace Court ",
          line2: "",
          city: "Harbor City",
          region: "",
          postalCode: "10998",
          accessNotes: "Ring twice.",
        },
        saveAddressToProfile: false,
      }),
      KEY,
    );

    expect(body).toEqual({
      serviceId: "s1",
      description: DESCRIPTION,
      preferredDate: "2026-11-10",
      preferredWindow: "MORNING",
      submissionKey: KEY,
      newAddress: {
        line1: "73 Millrace Court",
        line2: null,
        city: "Harbor City",
        region: null,
        postalCode: "10998",
        accessNotes: "Ring twice.",
      },
      saveAddressToProfile: false,
    });
    // Never both: the stale saved choice is not sent when a typed address is used.
    expect(body).not.toHaveProperty("serviceAddressId");
  });

  it("sends the label, and the wish to save, when the address is saved to the profile", () => {
    const body = toRequestBody(
      values({
        addressMode: "new",
        saveAddressToProfile: true,
        newAddress: {
          ...EMPTY_NEW_ADDRESS,
          label: " Rental unit ",
          line1: "73 Millrace Court",
          city: "Harbor City",
          postalCode: "10998",
        },
      }),
      KEY,
    );

    expect(body).toMatchObject({
      saveAddressToProfile: true,
      newAddress: { label: "Rental unit", line1: "73 Millrace Court" },
    });
  });

  it("sends only keys the API accepts", () => {
    const body = toRequestBody(values(), KEY);

    expect(Object.keys(body).sort()).toEqual(
      [
        "description",
        "preferredDate",
        "preferredWindow",
        "serviceAddressId",
        "serviceId",
        "submissionKey",
      ].sort(),
    );
  });

  it("refuses to build a body before a window is chosen", () => {
    expect(() => toRequestBody(values({ preferredWindow: "" }), KEY)).toThrow();
  });
});

describe("service preselection (?service=<slug>)", () => {
  const services: Pick<PublicServiceDto, "id" | "slug">[] = [
    { id: "s1", slug: "ac-repair" },
    { id: "s2", slug: "deep-cleaning" },
  ];

  it("preselects the active service with that slug", () => {
    expect(resolveServicePreselection("deep-cleaning", services)).toEqual({
      serviceId: "s2",
      unavailable: false,
    });
  });

  it("preselects nothing, quietly, when no service was asked for", () => {
    expect(resolveServicePreselection(undefined, services)).toEqual({
      serviceId: null,
      unavailable: false,
    });
    expect(resolveServicePreselection("", services)).toEqual({
      serviceId: null,
      unavailable: false,
    });
  });

  it("says so when the service asked for is unknown, unpublished or archived", () => {
    // Inactive services are not in the list of active ones, so they look like unknown ones.
    expect(resolveServicePreselection("old-service", services)).toEqual({
      serviceId: null,
      unavailable: true,
    });
  });

  it("matches the slug exactly, not by prefix or case", () => {
    expect(resolveServicePreselection("ac", services).unavailable).toBe(true);
    expect(resolveServicePreselection("AC-REPAIR", services).unavailable).toBe(true);
  });

  it("reads the search parameter as one short string", () => {
    expect(serviceSlugParam("ac-repair")).toBe("ac-repair");
    expect(serviceSlugParam(["a", "b"])).toBe("a");
    expect(serviceSlugParam("  ac-repair ")).toBe("ac-repair");
    expect(serviceSlugParam("")).toBeUndefined();
    expect(serviceSlugParam(undefined)).toBeUndefined();
    expect(serviceSlugParam("x".repeat(500))).toHaveLength(100);
  });
});

describe("initialRequestValues", () => {
  it("starts on the customer's default address", () => {
    const result = initialRequestValues({
      preselectedServiceId: "s2",
      addresses: [address({ id: "a1" }), address({ id: "a2", isDefault: true })],
    });

    expect(result).toMatchObject({
      serviceId: "s2",
      addressMode: "saved",
      serviceAddressId: "a2",
      preferredDate: "",
      preferredWindow: "",
      description: "",
      saveAddressToProfile: false,
    });
  });

  it("starts on the first address when none is the default", () => {
    expect(defaultAddressId([address({ id: "a1" }), address({ id: "a2" })])).toBe("a1");
  });

  it("starts with the fields to type an address when there are no saved ones", () => {
    const result = initialRequestValues({ preselectedServiceId: null, addresses: [] });

    expect(result.addressMode).toBe("new");
    expect(result.serviceAddressId).toBe("");
    expect(result.serviceId).toBe("");
  });

  it("does not choose a date or a window for the customer", () => {
    const result = initialRequestValues({ preselectedServiceId: null, addresses: [address()] });

    expect(result.preferredDate).toBe("");
    expect(result.preferredWindow).toBe("");
  });
});
