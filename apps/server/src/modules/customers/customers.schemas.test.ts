import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import {
  addressIdParamsSchema,
  createAddressBodySchema,
  updateAddressBodySchema,
  updateProfileBodySchema,
} from "./customers.schemas.js";

function run<T extends z.ZodType>(schema: T, input: unknown) {
  const result = schema.safeParse(input);
  return result.success
    ? { data: result.data, errors: undefined }
    : { data: undefined, errors: fieldErrorsFromZod(result.error) };
}

const VALID_ADDRESS = {
  label: "Home",
  line1: "214 Larkspur Lane",
  city: "Harbor City",
  postalCode: "10999",
};

describe("updateProfileBodySchema (FR-013, FR-014)", () => {
  it("accepts a name on its own, trimmed", () => {
    expect(run(updateProfileBodySchema, { name: "  Alex Morgan  " }).data).toEqual({
      name: "Alex Morgan",
    });
  });

  it("accepts a phone number on its own and tidies it for storage", () => {
    expect(run(updateProfileBodySchema, { phone: "  (212)   555-0142 " }).data).toEqual({
      phone: "(212) 555-0142",
    });
    expect(run(updateProfileBodySchema, { phone: "+44 20 7946 0958" }).data).toEqual({
      phone: "+44 20 7946 0958",
    });
  });

  it("clears the phone number with an empty string, blanks or null", () => {
    for (const phone of ["", "   ", null]) {
      expect(run(updateProfileBodySchema, { phone }).data).toEqual({ phone: null });
    }
  });

  it("does not touch what is not sent", () => {
    expect(run(updateProfileBodySchema, { name: "Alex Morgan" }).data).not.toHaveProperty("phone");
  });

  it.each([
    ["role", { role: "BUSINESS_ADMIN" }],
    ["email", { email: "someone.else@example.test" }],
    ["userId", { userId: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" }],
    ["customerId", { customerId: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" }],
    ["isActive", { isActive: false }],
    ["passwordHash", { passwordHash: "x" }],
    ["avatarUrl", { avatarUrl: "https://example.test/a.png" }],
    ["an unknown key", { nickname: "Al" }],
  ])("rejects %s, even beside valid fields", (_name, extra) => {
    const result = run(updateProfileBodySchema, { name: "Alex Morgan", ...extra });

    expect(result.data).toBeUndefined();
    expect(Object.keys(result.errors ?? {}).join(" ")).toContain(Object.keys(extra)[0]);
  });

  it("rejects an empty body and a body of undefined values", () => {
    expect(run(updateProfileBodySchema, {}).errors).toBeDefined();
    expect(run(updateProfileBodySchema, { name: undefined }).errors).toBeDefined();
  });

  it("rejects a name that is blank, one character or longer than 100", () => {
    expect(run(updateProfileBodySchema, { name: "   " }).errors?.name).toBeDefined();
    expect(run(updateProfileBodySchema, { name: "A" }).errors?.name).toMatch(/at least 2/);
    expect(run(updateProfileBodySchema, { name: "A".repeat(101) }).errors?.name).toMatch(/100/);
    expect(run(updateProfileBodySchema, { name: "A".repeat(100) }).errors).toBeUndefined();
  });

  it("rejects a name with a line break or a control character", () => {
    expect(run(updateProfileBodySchema, { name: "Alex\nMorgan" }).errors?.name).toBeDefined();
    expect(run(updateProfileBodySchema, { name: "Alex\u0007Morgan" }).errors?.name).toBeDefined();
  });

  it("rejects a name that is not a string", () => {
    expect(run(updateProfileBodySchema, { name: 42 }).errors?.name).toBeDefined();
    expect(run(updateProfileBodySchema, { name: null }).errors?.name).toBeDefined();
  });

  it.each(["555-01", "212-CALL-NOW", "212.555.0142", "<b>5550142</b>", "((((((((", 5550142])(
    "rejects the phone number %j",
    (phone) => {
      expect(run(updateProfileBodySchema, { phone }).errors?.phone).toBeDefined();
    },
  );
});

describe("createAddressBodySchema", () => {
  it("accepts the required fields, leaving the optional ones out", () => {
    expect(run(createAddressBodySchema, VALID_ADDRESS).data).toEqual(VALID_ADDRESS);
  });

  it("accepts every field and trims the text", () => {
    const result = run(createAddressBodySchema, {
      label: "  Rental unit ",
      line1: " 73 Millrace Court ",
      line2: " Unit 4 ",
      city: " Harbor City ",
      region: " NY ",
      postalCode: " SW1A 1AA ",
      accessNotes: "  Gate code 4471.\nPark on the street.  ",
    });

    expect(result.data).toEqual({
      label: "Rental unit",
      line1: "73 Millrace Court",
      line2: "Unit 4",
      city: "Harbor City",
      region: "NY",
      postalCode: "SW1A 1AA",
      accessNotes: "Gate code 4471.\nPark on the street.",
    });
  });

  it("turns blank optional fields into null", () => {
    const result = run(createAddressBodySchema, {
      ...VALID_ADDRESS,
      line2: "  ",
      region: "",
      accessNotes: null,
    });

    expect(result.data).toMatchObject({ line2: null, region: null, accessNotes: null });
  });

  it("reports each missing required field by name", () => {
    const { errors } = run(createAddressBodySchema, {});

    expect(Object.keys(errors ?? {}).sort()).toEqual(["city", "label", "line1", "postalCode"]);
  });

  it.each([
    ["role", { role: "BUSINESS_ADMIN" }],
    ["customerId", { customerId: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" }],
    ["isDefault", { isDefault: true }],
    ["id", { id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" }],
    ["an unknown key", { country: "US" }],
  ])("rejects %s", (_name, extra) => {
    const result = run(createAddressBodySchema, { ...VALID_ADDRESS, ...extra });

    expect(result.data).toBeUndefined();
    expect(result.errors).toBeDefined();
  });

  it("enforces the length limits", () => {
    expect(run(createAddressBodySchema, { ...VALID_ADDRESS, label: "H" }).errors?.label).toMatch(
      /at least 2/,
    );
    expect(
      run(createAddressBodySchema, { ...VALID_ADDRESS, label: "H".repeat(41) }).errors?.label,
    ).toMatch(/40/);
    expect(
      run(createAddressBodySchema, { ...VALID_ADDRESS, label: "H".repeat(40) }).errors,
    ).toBeUndefined();
    expect(
      run(createAddressBodySchema, { ...VALID_ADDRESS, line1: "x".repeat(121) }).errors?.line1,
    ).toBeDefined();
    expect(
      run(createAddressBodySchema, { ...VALID_ADDRESS, postalCode: "1".repeat(21) }).errors
        ?.postalCode,
    ).toBeDefined();
  });

  it("allows access notes of 500 characters and refuses 501", () => {
    expect(
      run(createAddressBodySchema, { ...VALID_ADDRESS, accessNotes: "n".repeat(500) }).errors,
    ).toBeUndefined();
    expect(
      run(createAddressBodySchema, { ...VALID_ADDRESS, accessNotes: "n".repeat(501) }).errors
        ?.accessNotes,
    ).toMatch(/500/);
  });

  it("refuses a line break in a single-line field, but not in the access notes", () => {
    expect(
      run(createAddressBodySchema, { ...VALID_ADDRESS, line1: "214 Larkspur\nLane" }).errors?.line1,
    ).toBeDefined();
    expect(
      run(createAddressBodySchema, { ...VALID_ADDRESS, accessNotes: "Gate code 4471\nPets inside" })
        .errors,
    ).toBeUndefined();
  });

  it("refuses a postal code with characters outside letters, digits, spaces and hyphens", () => {
    expect(
      run(createAddressBodySchema, { ...VALID_ADDRESS, postalCode: "109<99>" }).errors?.postalCode,
    ).toMatch(/letters, numbers, spaces and hyphens/);
  });
});

describe("updateAddressBodySchema", () => {
  it("accepts any single field", () => {
    expect(run(updateAddressBodySchema, { label: "Beach house" }).data).toEqual({
      label: "Beach house",
    });
    expect(run(updateAddressBodySchema, { city: "Port Alder" }).data).toEqual({
      city: "Port Alder",
    });
  });

  it("clears an optional field with null or blank text", () => {
    expect(run(updateAddressBodySchema, { accessNotes: null }).data).toEqual({
      accessNotes: null,
    });
    expect(run(updateAddressBodySchema, { line2: "  " }).data).toEqual({ line2: null });
  });

  it("never lets a required field be cleared", () => {
    for (const field of ["label", "line1", "city", "postalCode"]) {
      expect(run(updateAddressBodySchema, { [field]: "  " }).errors?.[field]).toBeDefined();
      expect(run(updateAddressBodySchema, { [field]: null }).errors?.[field]).toBeDefined();
    }
  });

  it("rejects an empty body and unknown keys, including isDefault and customerId", () => {
    expect(run(updateAddressBodySchema, {}).errors).toBeDefined();
    expect(run(updateAddressBodySchema, { isDefault: true }).errors).toBeDefined();
    expect(
      run(updateAddressBodySchema, {
        label: "Home",
        customerId: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
      }).errors,
    ).toBeDefined();
  });
});

describe("addressIdParamsSchema", () => {
  it("accepts a UUID and rejects anything else", () => {
    expect(
      run(addressIdParamsSchema, { id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" }).errors,
    ).toBeUndefined();
    expect(run(addressIdParamsSchema, { id: "default" }).errors?.id).toBeDefined();
    expect(
      run(addressIdParamsSchema, { id: "1; DROP TABLE service_addresses" }).errors?.id,
    ).toBeDefined();
  });
});
