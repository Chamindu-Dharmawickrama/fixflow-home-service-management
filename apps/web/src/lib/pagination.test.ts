import { describe, expect, it } from "vitest";

import { getPageRange, getPaginationItems } from "./pagination";

describe("getPaginationItems", () => {
  it("is empty when there are no pages and a single page when there is one", () => {
    expect(getPaginationItems(1, 0)).toEqual([]);
    expect(getPaginationItems(1, 1)).toEqual([1]);
  });

  it("lists every page when there are few", () => {
    expect(getPaginationItems(1, 2)).toEqual([1, 2]);
    expect(getPaginationItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPaginationItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses the far end with an ellipsis", () => {
    expect(getPaginationItems(1, 20)).toEqual([1, 2, "ellipsis-end", 20]);
    expect(getPaginationItems(2, 20)).toEqual([1, 2, 3, "ellipsis-end", 20]);
  });

  it("collapses the near end with an ellipsis", () => {
    expect(getPaginationItems(20, 20)).toEqual([1, "ellipsis-start", 19, 20]);
    expect(getPaginationItems(19, 20)).toEqual([1, "ellipsis-start", 18, 19, 20]);
  });

  it("collapses both sides in the middle", () => {
    expect(getPaginationItems(10, 20)).toEqual([
      1,
      "ellipsis-start",
      9,
      10,
      11,
      "ellipsis-end",
      20,
    ]);
  });

  it("shows a single hidden page instead of an ellipsis", () => {
    // 1 _ 4 5 6 … : page 2 and 3 are hidden → ellipsis; but 1 [2] 3 4 5 needs no ellipsis.
    expect(getPaginationItems(4, 20)).toEqual([1, 2, 3, 4, 5, "ellipsis-end", 20]);
    expect(getPaginationItems(17, 20)).toEqual([1, "ellipsis-start", 16, 17, 18, 19, 20]);
  });

  it("clamps a page outside the range", () => {
    expect(getPaginationItems(0, 20)).toEqual(getPaginationItems(1, 20));
    expect(getPaginationItems(99, 20)).toEqual(getPaginationItems(20, 20));
  });

  it("never repeats or reorders a page", () => {
    for (let totalPages = 1; totalPages <= 30; totalPages += 1) {
      for (let page = 1; page <= totalPages; page += 1) {
        const numbers = getPaginationItems(page, totalPages).filter(
          (item): item is number => typeof item === "number",
        );
        expect(numbers).toEqual([...new Set(numbers)].sort((a, b) => a - b));
        expect(numbers).toContain(page);
        expect(numbers[0]).toBe(1);
        expect(numbers.at(-1)).toBe(totalPages);
      }
    }
  });
});

describe("getPageRange", () => {
  it("describes a middle page", () => {
    expect(getPageRange(2, 20, 132)).toEqual({ from: 21, to: 40, totalPages: 7, page: 2 });
  });

  it("ends the last page at the total", () => {
    expect(getPageRange(7, 20, 132)).toEqual({ from: 121, to: 132, totalPages: 7, page: 7 });
  });

  it("handles an exact multiple and a single short page", () => {
    expect(getPageRange(2, 20, 40)).toEqual({ from: 21, to: 40, totalPages: 2, page: 2 });
    expect(getPageRange(1, 20, 7)).toEqual({ from: 1, to: 7, totalPages: 1, page: 1 });
  });

  it("returns zeros for an empty list", () => {
    expect(getPageRange(1, 20, 0)).toEqual({ from: 0, to: 0, totalPages: 0, page: 1 });
  });

  it("clamps a page beyond the end", () => {
    expect(getPageRange(50, 20, 132).page).toBe(7);
  });
});
