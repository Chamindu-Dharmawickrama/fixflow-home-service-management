import { describe, expect, it } from "vitest";

import { documentTotalRows } from "./document-totals";
import { isZeroAmount } from "./money";

const AMOUNTS = {
  subtotal: "252.00",
  discountAmount: "25.20",
  taxAmount: "3.28",
  totalAmount: "230.08",
};

describe("documentTotalRows", () => {
  it("lists the subtotal, the discount as a negative, the tax with its rate, and the total", () => {
    expect(documentTotalRows(AMOUNTS, "8.00")).toEqual([
      { label: "Subtotal", amount: "252.00" },
      { label: "Discount", amount: "-25.20" },
      { label: "Tax (8%)", amount: "3.28" },
      { label: "Total", amount: "230.08", strong: true },
    ]);
  });

  it("leaves the discount row out when there is none, however it is written", () => {
    for (const discountAmount of ["0", "0.00", "0.0"]) {
      const labels = documentTotalRows({ ...AMOUNTS, discountAmount }, "8").map((row) => row.label);
      expect(labels).toEqual(["Subtotal", "Tax (8%)", "Total"]);
    }
  });

  it("writes a rate with decimals as it is, and still shows a tax row at zero per cent", () => {
    expect(documentTotalRows(AMOUNTS, "8.25")[2]?.label).toBe("Tax (8.25%)");
    expect(documentTotalRows({ ...AMOUNTS, taxAmount: "0.00" }, "0.00")[2]).toEqual({
      label: "Tax (0%)",
      amount: "0.00",
    });
  });

  it("emphasises only the total", () => {
    const rows = documentTotalRows(AMOUNTS, "8.00");
    expect(rows.filter((row) => row.strong).map((row) => row.label)).toEqual(["Total"]);
  });

  it("does no arithmetic: the amounts come out exactly as they went in", () => {
    const rows = documentTotalRows(
      { subtotal: "0.10", discountAmount: "0.20", taxAmount: "0.30", totalAmount: "0.1000000001" },
      "1",
    );
    expect(rows.map((row) => row.amount)).toEqual(["0.10", "-0.20", "0.30", "0.1000000001"]);
  });
});

describe("isZeroAmount", () => {
  it("is true only for a decimal string with no value in it", () => {
    expect(isZeroAmount("0")).toBe(true);
    expect(isZeroAmount("0.00")).toBe(true);
    expect(isZeroAmount("-0.00")).toBe(true);
    expect(isZeroAmount("0.01")).toBe(false);
    expect(isZeroAmount("10.00")).toBe(false);
  });
});
