import { describe, expect, it } from "vitest";

import {
  ADDRESS_LIMIT_MESSAGE,
  canAddAddress,
  isFirstAddress,
  MAX_ADDRESSES,
  pickReplacementDefault,
} from "./customers.domain.js";

describe("canAddAddress (the limit of ten)", () => {
  it("allows an address until the customer has ten", () => {
    expect(MAX_ADDRESSES).toBe(10);
    expect(canAddAddress(0)).toBe(true);
    expect(canAddAddress(9)).toBe(true);
  });

  it("refuses the eleventh", () => {
    expect(canAddAddress(10)).toBe(false);
    expect(canAddAddress(11)).toBe(false);
  });

  it("tells the customer the limit and what to do about it", () => {
    expect(ADDRESS_LIMIT_MESSAGE).toContain("10");
    expect(ADDRESS_LIMIT_MESSAGE).toMatch(/delete/i);
  });
});

describe("isFirstAddress", () => {
  it("is true only for a customer with no address yet", () => {
    expect(isFirstAddress(0)).toBe(true);
    expect(isFirstAddress(1)).toBe(false);
    expect(isFirstAddress(9)).toBe(false);
  });
});

describe("pickReplacementDefault", () => {
  const at = (iso: string) => new Date(iso);

  it("picks the address that was changed most recently", () => {
    const picked = pickReplacementDefault([
      { id: "a", updatedAt: at("2026-10-01T10:00:00.000Z") },
      { id: "b", updatedAt: at("2026-10-03T10:00:00.000Z") },
      { id: "c", updatedAt: at("2026-10-02T10:00:00.000Z") },
    ]);

    expect(picked?.id).toBe("b");
  });

  it("does not depend on the order the rows arrive in", () => {
    const rows = [
      { id: "a", updatedAt: at("2026-10-01T10:00:00.000Z") },
      { id: "b", updatedAt: at("2026-10-03T10:00:00.000Z") },
      { id: "c", updatedAt: at("2026-10-02T10:00:00.000Z") },
    ];

    expect(pickReplacementDefault([...rows].reverse())?.id).toBe("b");
    expect(pickReplacementDefault([rows[1]!, rows[0]!, rows[2]!])?.id).toBe("b");
  });

  it("breaks a tie by id, so the answer is always the same", () => {
    const sameInstant = at("2026-10-02T10:00:00.000Z");
    const rows = [
      { id: "11111111-1111-4111-8111-111111111111", updatedAt: sameInstant },
      { id: "99999999-9999-4999-8999-999999999999", updatedAt: sameInstant },
    ];

    expect(pickReplacementDefault(rows)?.id).toBe("99999999-9999-4999-8999-999999999999");
    expect(pickReplacementDefault([...rows].reverse())?.id).toBe(
      "99999999-9999-4999-8999-999999999999",
    );
  });

  it("picks the only address that remains", () => {
    expect(
      pickReplacementDefault([{ id: "only", updatedAt: at("2026-10-01T10:00:00.000Z") }]),
    ).toEqual({
      id: "only",
      updatedAt: at("2026-10-01T10:00:00.000Z"),
    });
  });

  it("picks nothing when no address remains", () => {
    expect(pickReplacementDefault([])).toBeUndefined();
  });
});
