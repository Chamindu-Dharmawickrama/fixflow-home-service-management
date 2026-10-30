import { describe, expect, it } from "vitest";

import type { ServiceAddress } from "../../generated/prisma/client.js";
import { toCustomerProfileDto, toServiceAddressDto } from "./customers.dto.js";

const ROW: ServiceAddress = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  customerId: "5d2f6c1a-3a47-4a49-8f7e-0d4a6f1c2b33",
  label: "Home",
  line1: "214 Larkspur Lane",
  line2: "Apt 2B",
  city: "Harbor City",
  region: "NY",
  postalCode: "10999",
  accessNotes: "Buzz apartment 2B.",
  isDefault: true,
  createdAt: new Date("2026-10-01T09:00:00.000Z"),
  updatedAt: new Date("2026-10-28T10:30:00.000Z"),
};

const USER = {
  name: "Alex Morgan",
  email: "alex.morgan@example.test",
  avatarUrl: null,
  passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$not-a-real-hash",
  googleSubject: "google-subject-1234567890",
};

describe("toServiceAddressDto", () => {
  it("has exactly the keys the owner may read", () => {
    expect(Object.keys(toServiceAddressDto(ROW)).sort()).toEqual([
      "accessNotes",
      "city",
      "createdAt",
      "id",
      "isDefault",
      "label",
      "line1",
      "line2",
      "postalCode",
      "region",
      "updatedAt",
    ]);
  });

  it("does not carry the owner's id, and ignores a column it does not know", () => {
    const withExtra = { ...ROW, internalFlag: "staff-only" } as unknown as ServiceAddress;
    const json = JSON.stringify(toServiceAddressDto(withExtra));

    expect(json).not.toContain(ROW.customerId);
    expect(json).not.toContain("internalFlag");
    expect(json).not.toContain("staff-only");
  });

  it("serializes dates as ISO 8601 UTC and keeps empty optional fields as null", () => {
    const dto = toServiceAddressDto({ ...ROW, line2: null, region: null, accessNotes: null });

    expect(dto.createdAt).toBe("2026-10-01T09:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-10-28T10:30:00.000Z");
    expect(dto).toMatchObject({ line2: null, region: null, accessNotes: null });
  });
});

describe("toCustomerProfileDto", () => {
  it("has exactly the profile keys", () => {
    const dto = toCustomerProfileDto({
      user: USER,
      phone: "(212) 555-0171",
      passwordChangeLocked: false,
      addresses: [ROW],
    });

    expect(Object.keys(dto).sort()).toEqual([
      "addresses",
      "avatarUrl",
      "email",
      "hasGoogle",
      "hasPassword",
      "name",
      "passwordChangeLocked",
      "phone",
    ]);
  });

  it("reduces the password hash and the Google subject to two booleans", () => {
    const dto = toCustomerProfileDto({
      user: USER,
      phone: null,
      passwordChangeLocked: false,
      addresses: [],
    });
    const json = JSON.stringify(dto);

    expect(dto).toMatchObject({ hasPassword: true, hasGoogle: true, phone: null });
    expect(json).not.toContain("argon2");
    expect(json).not.toContain(USER.googleSubject);
  });

  it("reports a Google-only account as having no password", () => {
    const dto = toCustomerProfileDto({
      user: { ...USER, passwordHash: null },
      phone: null,
      passwordChangeLocked: false,
      addresses: [],
    });

    expect(dto.hasPassword).toBe(false);
  });

  it("keeps the addresses in the order it was given", () => {
    const second = { ...ROW, id: "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d", isDefault: false };
    const dto = toCustomerProfileDto({
      user: USER,
      phone: null,
      passwordChangeLocked: true,
      addresses: [ROW, second],
    });

    expect(dto.addresses.map((address) => address.id)).toEqual([ROW.id, second.id]);
    expect(dto.passwordChangeLocked).toBe(true);
  });
});
