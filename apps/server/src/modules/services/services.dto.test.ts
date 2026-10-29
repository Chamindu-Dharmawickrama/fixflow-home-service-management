import { describe, expect, it } from "vitest";

import { Prisma, type Service } from "../../generated/prisma/client.js";
import { toAdminServiceDto, toPublicServiceDto } from "./services.dto.js";

const ROW: Service = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  name: "AC Routine Maintenance",
  slug: "ac-routine-maintenance",
  category: "Air conditioning",
  shortDescription: "A yearly service.",
  fullDescription: "A thorough service for split and ducted air conditioners.",
  inclusions: ["Filter cleaning", "Refrigerant check"],
  estimatedDurationMinutes: 90,
  pricingMode: "FIXED",
  startingPrice: new Prisma.Decimal("129"),
  imageKey: "air-conditioning",
  imageUrl: null,
  isPublished: true,
  archivedAt: null,
  sortOrder: 20,
  createdAt: new Date("2026-10-01T09:00:00.000Z"),
  updatedAt: new Date("2026-10-28T10:30:00.000Z"),
};

/** Exactly what a visitor may read. A column added to `services` later must not appear by itself. */
const PUBLIC_KEYS = [
  "category",
  "currencyCode",
  "estimatedDurationMinutes",
  "fullDescription",
  "id",
  "imageKey",
  "imageUrl",
  "inclusions",
  "name",
  "pricingMode",
  "shortDescription",
  "slug",
  "startingPrice",
];

describe("toPublicServiceDto", () => {
  it("has exactly the public keys", () => {
    expect(Object.keys(toPublicServiceDto(ROW, "USD")).sort()).toEqual(PUBLIC_KEYS);
  });

  it("does not reveal how the service is managed", () => {
    const json = JSON.stringify(toPublicServiceDto(ROW, "USD"));
    for (const hidden of [
      "isPublished",
      "archivedAt",
      "sortOrder",
      "createdAt",
      "updatedAt",
      "availableActions",
      "isActive",
      "status",
    ]) {
      expect(json, hidden).not.toContain(hidden);
    }
  });

  it("serializes the price as a two-decimal string beside the currency", () => {
    const dto = toPublicServiceDto(ROW, "EUR");
    expect(dto.startingPrice).toBe("129.00");
    expect(dto.currencyCode).toBe("EUR");
    expect(toPublicServiceDto({ ...ROW, startingPrice: null }, "USD").startingPrice).toBeNull();
  });

  it("copies the inclusions, so a caller cannot change the row through the DTO", () => {
    const dto = toPublicServiceDto(ROW, "USD");
    dto.inclusions.push("Extra");
    expect(ROW.inclusions).toHaveLength(2);
  });
});

describe("toAdminServiceDto", () => {
  it("adds the lifecycle to the public fields", () => {
    expect(Object.keys(toAdminServiceDto(ROW, "USD")).sort()).toEqual(
      [
        ...PUBLIC_KEYS,
        "archivedAt",
        "availableActions",
        "createdAt",
        "isActive",
        "isPublished",
        "sortOrder",
        "status",
        "updatedAt",
      ].sort(),
    );
  });

  it("derives the status, the active flag and the actions from the lifecycle (D-43)", () => {
    expect(toAdminServiceDto(ROW, "USD")).toMatchObject({
      status: "PUBLISHED",
      isActive: true,
      availableActions: ["EDIT", "UNPUBLISH", "ARCHIVE"],
    });
    expect(toAdminServiceDto({ ...ROW, isPublished: false }, "USD")).toMatchObject({
      status: "UNPUBLISHED",
      isActive: false,
      availableActions: ["EDIT", "PUBLISH", "ARCHIVE"],
    });
    expect(
      toAdminServiceDto(
        { ...ROW, isPublished: false, archivedAt: new Date("2026-10-20T08:00:00.000Z") },
        "USD",
      ),
    ).toMatchObject({
      status: "ARCHIVED",
      isActive: false,
      archivedAt: "2026-10-20T08:00:00.000Z",
      availableActions: ["EDIT", "RESTORE"],
    });
  });

  it("never calls an archived service active, even if the row still says published", () => {
    const dto = toAdminServiceDto(
      { ...ROW, archivedAt: new Date("2026-10-20T08:00:00.000Z") },
      "USD",
    );
    expect(dto.isActive).toBe(false);
    expect(dto.status).toBe("ARCHIVED");
  });

  it("writes timestamps as ISO 8601 UTC", () => {
    const dto = toAdminServiceDto(ROW, "USD");
    expect(dto.createdAt).toBe("2026-10-01T09:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-10-28T10:30:00.000Z");
    expect(dto.archivedAt).toBeNull();
  });
});
