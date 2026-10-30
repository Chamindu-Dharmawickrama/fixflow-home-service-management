import { describe, expect, it } from "vitest";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import {
  createRequestBodySchema,
  listMyRequestsQuerySchema,
  requestIdParamsSchema,
} from "./requests.schemas.js";

const SERVICE_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";
const ADDRESS_ID = "1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22";
const KEY = "2d8e3a20-8b3c-4d20-9b3f-4f1f5c9e1c33";

const NEW_ADDRESS = {
  label: "Rental unit",
  line1: "73 Millrace Court",
  city: "Harbor City",
  region: "NY",
  postalCode: "10998",
};

const VALID = {
  serviceId: SERVICE_ID,
  description: "The unit stopped cooling and makes a rattling noise when it starts.",
  serviceAddressId: ADDRESS_ID,
  preferredDate: "2026-11-10",
  preferredWindow: "MORNING",
  submissionKey: KEY,
};

function parse(body: unknown) {
  return createRequestBodySchema.safeParse(body);
}

function errorsOf(body: unknown): Record<string, string> {
  const result = parse(body);
  if (result.success) {
    throw new Error("The body was accepted.");
  }
  return fieldErrorsFromZod(result.error);
}

describe("createRequestBodySchema", () => {
  it("accepts a request for a saved address", () => {
    expect(parse(VALID).success).toBe(true);
  });

  it("accepts a request for a new address that is not saved", () => {
    const { serviceAddressId: _omit, ...rest } = VALID;

    expect(parse({ ...rest, newAddress: NEW_ADDRESS }).success).toBe(true);
    expect(parse({ ...rest, newAddress: NEW_ADDRESS, saveAddressToProfile: false }).success).toBe(
      true,
    );
  });

  it("accepts a new address saved to the profile and keeps the label", () => {
    const { serviceAddressId: _omit, ...rest } = VALID;
    const result = parse({ ...rest, newAddress: NEW_ADDRESS, saveAddressToProfile: true });

    expect(result.success).toBe(true);
    expect(result.data?.newAddress?.label).toBe("Rental unit");
  });

  it("does not need a label for an address that is not saved", () => {
    const { serviceAddressId: _omit, ...rest } = VALID;
    const { label: _label, ...unlabelled } = NEW_ADDRESS;

    expect(parse({ ...rest, newAddress: unlabelled }).success).toBe(true);
  });

  it("trims the description and counts only what remains", () => {
    const result = parse({ ...VALID, description: `   ${"x".repeat(20)}   ` });

    expect(result.success).toBe(true);
    expect(result.data?.description).toBe("x".repeat(20));
    expect(errorsOf({ ...VALID, description: `   ${"x".repeat(19)}   ` })).toHaveProperty(
      "description",
    );
  });

  it("keeps line breaks in a description", () => {
    const result = parse({
      ...VALID,
      description: "The unit stopped cooling.\n\nIt rattles when it starts.",
    });

    expect(result.data?.description).toContain("\n\n");
  });

  describe("description", () => {
    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["too short", "Too short."],
      ["blank", " ".repeat(40)],
    ])("rejects a %s description", (_name, description) => {
      expect(errorsOf({ ...VALID, description })).toHaveProperty("description");
    });

    it("rejects more than 2000 characters and accepts exactly 2000", () => {
      expect(errorsOf({ ...VALID, description: "x".repeat(2001) }).description).toMatch(/2000/);
      expect(parse({ ...VALID, description: "x".repeat(2000) }).success).toBe(true);
    });

    it("rejects control characters", () => {
      expect(
        errorsOf({ ...VALID, description: `The unit stopped cooling.${"\u0007"} It rattles.` }),
      ).toHaveProperty("description");
    });
  });

  describe("service, window and key", () => {
    it.each([
      ["serviceId", undefined],
      ["serviceId", "not-a-uuid"],
      ["serviceId", 12],
      ["preferredWindow", undefined],
      ["preferredWindow", "NIGHT"],
      ["preferredWindow", "morning"],
      ["submissionKey", undefined],
      ["submissionKey", "123"],
    ])("rejects %s = %j", (field, value) => {
      expect(errorsOf({ ...VALID, [field]: value })).toHaveProperty(field);
    });

    it("explains a missing service and window in words", () => {
      expect(errorsOf({ ...VALID, serviceId: undefined }).serviceId).toBe("Choose a service.");
      expect(errorsOf({ ...VALID, preferredWindow: undefined }).preferredWindow).toBe(
        "Choose a time window.",
      );
    });
  });

  describe("preferredDate", () => {
    it.each(["", "2026-02-30", "10/11/2026", "2026-11-10T08:00:00Z", "tomorrow", "2026-1-5"])(
      "rejects %j, which is not a calendar date",
      (preferredDate) => {
        expect(errorsOf({ ...VALID, preferredDate })).toHaveProperty("preferredDate");
      },
    );

    it("leaves the range to the service, which knows the clock", () => {
      // Valid in shape, however far in the past: only the service can say it is out of range.
      expect(parse({ ...VALID, preferredDate: "2001-01-01" }).success).toBe(true);
    });
  });

  describe("the address", () => {
    it("needs either a saved address or a new one", () => {
      const { serviceAddressId: _omit, ...rest } = VALID;

      expect(errorsOf(rest)).toEqual({ serviceAddressId: "Choose where the work is to be done." });
    });

    it("refuses both at once", () => {
      expect(errorsOf({ ...VALID, newAddress: NEW_ADDRESS })).toEqual({
        newAddress: "Choose a saved address or enter a new one, not both.",
      });
    });

    it("refuses a saved-address id that is not a UUID", () => {
      expect(errorsOf({ ...VALID, serviceAddressId: "home" })).toHaveProperty("serviceAddressId");
    });

    it("refuses 'save to profile' for a saved address, whatever its value", () => {
      for (const saveAddressToProfile of [true, false]) {
        expect(errorsOf({ ...VALID, saveAddressToProfile })).toEqual({
          saveAddressToProfile: "Only a new address can be saved to your profile.",
        });
      }
    });

    it("needs a label to save a new address, and not a one-letter label", () => {
      const { serviceAddressId: _omit, ...rest } = VALID;
      const { label: _label, ...unlabelled } = NEW_ADDRESS;

      expect(errorsOf({ ...rest, newAddress: unlabelled, saveAddressToProfile: true })).toEqual({
        "newAddress.label": "Enter a label so you can find this address again, like Home.",
      });
      expect(
        errorsOf({
          ...rest,
          newAddress: { ...NEW_ADDRESS, label: "  " },
          saveAddressToProfile: true,
        }),
      ).toHaveProperty(["newAddress.label"]);
      expect(
        errorsOf({
          ...rest,
          newAddress: { ...NEW_ADDRESS, label: "H" },
          saveAddressToProfile: true,
        })["newAddress.label"],
      ).toMatch(/at least 2/);
    });

    it("reports the fields of a new address under newAddress", () => {
      const { serviceAddressId: _omit, ...rest } = VALID;

      const errors = errorsOf({
        ...rest,
        newAddress: { line1: "", city: "", postalCode: "bad!code" },
      });

      expect(Object.keys(errors).sort()).toEqual([
        "newAddress.city",
        "newAddress.line1",
        "newAddress.postalCode",
      ]);
    });

    it("rejects unknown fields on a new address", () => {
      const { serviceAddressId: _omit, ...rest } = VALID;

      expect(errorsOf({ ...rest, newAddress: { ...NEW_ADDRESS, customerId: ADDRESS_ID } })).toEqual(
        { "newAddress.customerId": "Unknown field." },
      );
    });
  });

  describe("fields only the server may set", () => {
    it.each([
      ["customerId", ADDRESS_ID],
      ["reference", "FF-2026-00001"],
      ["status", "ACCEPTED"],
      ["preferredStart", "2026-11-10T13:00:00.000Z"],
      ["preferredEnd", "2026-11-10T17:00:00.000Z"],
      ["serviceNameSnapshot", "Anything"],
      ["submittedAt", "2020-01-01T00:00:00.000Z"],
      ["role", "BUSINESS_ADMIN"],
      ["id", SERVICE_ID],
    ])("rejects %s", (field, value) => {
      expect(errorsOf({ ...VALID, [field]: value })).toEqual({ [field]: "Unknown field." });
    });
  });

  it("reports every problem at once, so a form can show them all", () => {
    const errors = errorsOf({
      serviceId: "x",
      description: "short",
      preferredDate: "never",
      preferredWindow: "NIGHT",
      submissionKey: "y",
    });

    expect(Object.keys(errors).sort()).toEqual([
      "description",
      "preferredDate",
      "preferredWindow",
      "serviceId",
      "submissionKey",
    ]);
  });
});

describe("listMyRequestsQuerySchema", () => {
  it("defaults to the first page, newest first", () => {
    expect(listMyRequestsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: "submittedAt",
      order: "desc",
    });
  });

  it("accepts a status filter", () => {
    expect(listMyRequestsQuerySchema.parse({ status: "SUBMITTED" }).status).toBe("SUBMITTED");
  });

  it.each([
    { status: "OPEN" },
    { status: "submitted" },
    { sort: "reference" },
    { pageSize: "101" },
  ])("rejects %j", (query) => {
    expect(listMyRequestsQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("requestIdParamsSchema", () => {
  it("accepts an id", () => {
    expect(requestIdParamsSchema.safeParse({ id: SERVICE_ID }).success).toBe(true);
  });

  it("does not accept a reference in place of an id (BR-21)", () => {
    expect(requestIdParamsSchema.safeParse({ id: "FF-2026-00012" }).success).toBe(false);
  });
});
