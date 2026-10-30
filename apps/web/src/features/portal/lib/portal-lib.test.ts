import type { ServiceAddressDto } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  addressFormSchema,
  type AddressFormValues,
  addressToFormValues,
  changedAddressFields,
  EMPTY_ADDRESS_VALUES,
  toAddressBody,
} from "./address-form";
import { formatAddressLines, formatAddressOneLine } from "./format-address";
import { profileFormSchema, profileToFormValues, toProfileBody } from "./profile-form";

const ADDRESS: ServiceAddressDto = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  label: "Home",
  line1: "214 Larkspur Lane",
  line2: "Apt 2B",
  city: "Harbor City",
  region: "NY",
  postalCode: "10999",
  accessNotes: "Buzz apartment 2B.",
  isDefault: true,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-28T10:30:00.000Z",
};

const VALID: AddressFormValues = {
  label: "Home",
  line1: "214 Larkspur Lane",
  line2: "",
  city: "Harbor City",
  region: "",
  postalCode: "10999",
  accessNotes: "",
};

function messages(values: Partial<AddressFormValues>): Record<string, string> {
  const result = addressFormSchema.safeParse({ ...VALID, ...values });
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
  );
}

describe("formatAddressLines", () => {
  it("writes the street, the second line, then city, region and postal code", () => {
    expect(formatAddressLines(ADDRESS)).toEqual([
      "214 Larkspur Lane",
      "Apt 2B",
      "Harbor City, NY 10999",
    ]);
  });

  it("leaves out empty parts without a stray comma or blank line", () => {
    expect(formatAddressLines({ ...ADDRESS, line2: null, region: null })).toEqual([
      "214 Larkspur Lane",
      "Harbor City 10999",
    ]);
    expect(formatAddressLines({ ...ADDRESS, line2: null, region: "" })).toEqual([
      "214 Larkspur Lane",
      "Harbor City 10999",
    ]);
  });

  it("joins the lines for places with room for one", () => {
    expect(formatAddressOneLine(ADDRESS)).toBe("214 Larkspur Lane, Apt 2B, Harbor City, NY 10999");
  });
});

describe("addressFormSchema", () => {
  it("accepts the required fields", () => {
    expect(addressFormSchema.safeParse(VALID).success).toBe(true);
  });

  it("asks for each required field by name", () => {
    expect(messages({ label: "", line1: "", city: "", postalCode: "" })).toEqual({
      label: "Enter the label.",
      line1: "Enter the street address.",
      city: "Enter the city.",
      postalCode: "Enter the postal code.",
    });
  });

  it("counts a label of spaces as missing and one character as too short", () => {
    expect(messages({ label: "   " }).label).toBe("Enter the label.");
    expect(messages({ label: "H" }).label).toBe("The label must be at least 2 characters.");
  });

  it("enforces the length limits", () => {
    expect(messages({ label: "H".repeat(41) }).label).toMatch(/40 characters or fewer/);
    expect(messages({ accessNotes: "n".repeat(501) }).accessNotes).toMatch(
      /500 characters or fewer/,
    );
    expect(messages({ accessNotes: "n".repeat(500) })).toEqual({});
  });

  it("explains a postal code with characters the API would refuse", () => {
    expect(messages({ postalCode: "109<99>" }).postalCode).toMatch(
      /letters, numbers, spaces and hyphens/,
    );
    expect(messages({ postalCode: "SW1A 1AA" })).toEqual({});
  });
});

describe("toAddressBody", () => {
  it("trims the text and sends blank optional fields as null", () => {
    expect(
      toAddressBody({
        ...VALID,
        label: "  Home ",
        line2: "   ",
        region: "",
        accessNotes: "  ",
      }),
    ).toEqual({
      label: "Home",
      line1: "214 Larkspur Lane",
      line2: null,
      city: "Harbor City",
      region: null,
      postalCode: "10999",
      accessNotes: null,
    });
  });

  it("round-trips a saved address through the form without changing it", () => {
    const values = addressToFormValues(ADDRESS);

    expect(toAddressBody(values)).toEqual({
      label: "Home",
      line1: "214 Larkspur Lane",
      line2: "Apt 2B",
      city: "Harbor City",
      region: "NY",
      postalCode: "10999",
      accessNotes: "Buzz apartment 2B.",
    });
  });

  it("starts a new address empty", () => {
    expect(Object.values(EMPTY_ADDRESS_VALUES).every((value) => value === "")).toBe(true);
  });
});

describe("changedAddressFields", () => {
  const saved = toAddressBody(addressToFormValues(ADDRESS));

  it("is empty when nothing changed", () => {
    expect(changedAddressFields(saved, { ...saved })).toEqual({});
  });

  it("holds only the fields that differ, including a cleared one", () => {
    expect(
      changedAddressFields(saved, { ...saved, city: "Port Alder", accessNotes: null }),
    ).toEqual({ city: "Port Alder", accessNotes: null });
  });
});

describe("profileFormSchema", () => {
  const messagesOf = (values: { name: string; phone: string }) => {
    const result = profileFormSchema.safeParse(values);
    return result.success
      ? {}
      : Object.fromEntries(
          result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        );
  };

  it("accepts a name with or without a phone number", () => {
    expect(messagesOf({ name: "Alex Morgan", phone: "" })).toEqual({});
    expect(messagesOf({ name: "Alex Morgan", phone: "  (212)  555-0142 " })).toEqual({});
    expect(messagesOf({ name: "Alex Morgan", phone: "+44 20 7946 0958" })).toEqual({});
  });

  it("rejects a missing, one-character or over-long name", () => {
    expect(messagesOf({ name: "  ", phone: "" }).name).toBe("Enter your name.");
    expect(messagesOf({ name: "A", phone: "" }).name).toBe(
      "Your name must be at least 2 characters.",
    );
    expect(messagesOf({ name: "A".repeat(101), phone: "" }).name).toMatch(
      /100 characters or fewer/,
    );
  });

  it.each(["555-01", "212-CALL-NOW", "212.555.0142", "((((((((", "1234 5678 9012 3456"])(
    "rejects the phone number %j",
    (phone) => {
      expect(messagesOf({ name: "Alex Morgan", phone }).phone).toMatch(/7 to 15 digits/);
    },
  );
});

describe("toProfileBody", () => {
  const saved = profileToFormValues({ name: "Alex Morgan", phone: "(212) 555-0171" });

  it("shows a missing phone number as an empty field", () => {
    expect(profileToFormValues({ name: "Alex Morgan", phone: null })).toEqual({
      name: "Alex Morgan",
      phone: "",
    });
  });

  it("is empty when nothing changed, even if only spacing differs", () => {
    expect(toProfileBody(saved, { ...saved })).toEqual({});
    expect(toProfileBody(saved, { name: " Alex Morgan ", phone: "(212)   555-0171" })).toEqual({});
  });

  it("holds only the field that changed", () => {
    expect(toProfileBody(saved, { ...saved, phone: "(212) 555-0199" })).toEqual({
      phone: "(212) 555-0199",
    });
    expect(toProfileBody(saved, { ...saved, name: "Alexandra Morgan" })).toEqual({
      name: "Alexandra Morgan",
    });
  });

  it("sends a cleared phone number as null", () => {
    expect(toProfileBody(saved, { ...saved, phone: "  " })).toEqual({ phone: null });
  });
});
