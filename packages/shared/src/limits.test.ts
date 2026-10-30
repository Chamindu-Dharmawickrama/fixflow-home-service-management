import { describe, expect, it } from "vitest";

import * as shared from "./index.js";
import { LIMITS } from "./limits.js";

const MAX_INT32 = 2_147_483_647;
const TWO_DECIMAL_PLACES = /^\d+(\.\d{1,2})?$/;

describe("LIMITS", () => {
  it("is re-exported from the package entry point", () => {
    expect(shared.LIMITS).toBe(LIMITS);
  });

  it("keeps every min below its max", () => {
    expect(Number(LIMITS.quantity.min)).toBeLessThan(Number(LIMITS.quantity.max));
    expect(Number(LIMITS.unitPrice.min)).toBeLessThan(Number(LIMITS.unitPrice.max));
    expect(Number(LIMITS.taxRate.min)).toBeLessThan(Number(LIMITS.taxRate.max));
    expect(LIMITS.lineItems.min).toBeLessThanOrEqual(LIMITS.lineItems.max);
    expect(LIMITS.requestDescription.minLength).toBeLessThan(LIMITS.requestDescription.maxLength);
    expect(LIMITS.reason.minLength).toBeLessThan(LIMITS.reason.maxLength);
  });

  it("matches the values fixed in D-20", () => {
    expect(LIMITS.quantity).toEqual({ min: "0.01", max: "9999.99" });
    expect(LIMITS.unitPrice).toEqual({ min: "0.00", max: "999999.99" });
    expect(LIMITS.lineItems).toEqual({ min: 1, max: 50 });
    expect(LIMITS.taxRate).toEqual({ min: "0", max: "100" });
    expect(LIMITS.discount.min).toBe("0.00");
    expect(LIMITS.paymentAmount.min).toBe("0.01");
    expect(LIMITS.requestDescription).toEqual({ minLength: 20, maxLength: 2000 });
    expect(LIMITS.notes.maxLength).toBe(2000);
    expect(LIMITS.reason).toEqual({ minLength: 5, maxLength: 500 });
    expect(LIMITS.appointment.maxDurationMinutes).toBe(12 * 60);
  });

  it("expresses money and quantities as decimal strings with at most two decimal places", () => {
    const decimals = [
      LIMITS.quantity.min,
      LIMITS.quantity.max,
      LIMITS.unitPrice.min,
      LIMITS.unitPrice.max,
      LIMITS.taxRate.min,
      LIMITS.taxRate.max,
      LIMITS.discount.min,
      LIMITS.paymentAmount.min,
    ];
    for (const value of decimals) {
      expect(value).toMatch(TWO_DECIMAL_PLACES);
    }
  });

  it("requires a strictly positive quantity and payment, while a unit price and discount may be zero", () => {
    expect(Number(LIMITS.quantity.min)).toBeGreaterThan(0);
    expect(Number(LIMITS.paymentAmount.min)).toBeGreaterThan(0);
    expect(Number(LIMITS.unitPrice.min)).toBe(0);
    expect(Number(LIMITS.discount.min)).toBe(0);
  });

  it("holds the customer profile and address limits of T10", () => {
    const { address, customerPhone } = LIMITS;

    expect(address.maxPerCustomer).toBe(10);
    expect(address.label).toEqual({ minLength: 2, maxLength: 40 });
    expect(address.accessNotes.maxLength).toBe(500);
    expect(customerPhone.minLength).toBe(7);
    expect(customerPhone.maxLength).toBe(20);
    // The digits must fit inside the characters allowed, or no number could ever be valid.
    expect(customerPhone.minDigits).toBeLessThanOrEqual(customerPhone.maxDigits);
    expect(customerPhone.minDigits).toBeGreaterThanOrEqual(customerPhone.minLength);
    expect(customerPhone.maxDigits).toBeLessThanOrEqual(customerPhone.maxLength);
  });

  it("has pagination defaults that are consistent with each other", () => {
    const { defaultPageSize, maxPageSize, maxPage } = LIMITS.pagination;

    expect(defaultPageSize).toBe(20);
    expect(maxPageSize).toBe(100);
    expect(defaultPageSize).toBeGreaterThanOrEqual(1);
    expect(defaultPageSize).toBeLessThanOrEqual(maxPageSize);
    expect(maxPage).toBeGreaterThanOrEqual(1);
  });

  it("keeps the largest possible skip within a 32-bit integer", () => {
    const { maxPageSize, maxPage } = LIMITS.pagination;

    expect((maxPage - 1) * maxPageSize).toBeLessThanOrEqual(MAX_INT32);
  });

  it("uses positive integers for every count and length", () => {
    const counts = [
      LIMITS.pagination.defaultPageSize,
      LIMITS.pagination.maxPageSize,
      LIMITS.pagination.maxPage,
      LIMITS.lineItems.min,
      LIMITS.lineItems.max,
      LIMITS.requestDescription.minLength,
      LIMITS.requestDescription.maxLength,
      LIMITS.notes.maxLength,
      LIMITS.reason.minLength,
      LIMITS.reason.maxLength,
      LIMITS.appointment.maxDurationMinutes,
    ];
    for (const value of counts) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });
});
