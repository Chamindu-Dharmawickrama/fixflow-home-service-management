import { describe, expect, it } from "vitest";

import { hasActiveFilters, parseServicesQuery, toApiQueryString } from "./services-list";

describe("parseServicesQuery", () => {
  it("defaults to the website's order, first page, every status", () => {
    expect(parseServicesQuery({})).toEqual({
      status: undefined,
      search: undefined,
      page: 1,
      sort: "sortOrder",
      order: "asc",
    });
  });

  it("reads a valid status, search, sort, order and page", () => {
    expect(
      parseServicesQuery({
        status: "archived",
        search: "  air  ",
        sort: "updatedAt",
        order: "desc",
        page: "3",
      }),
    ).toEqual({ status: "archived", search: "air", page: 3, sort: "updatedAt", order: "desc" });
  });

  it("ignores what it does not understand rather than failing", () => {
    expect(
      parseServicesQuery({
        status: "deleted",
        sort: "startingPrice",
        order: "sideways",
        page: "abc",
      }),
    ).toEqual({ status: undefined, search: undefined, page: 1, sort: "sortOrder", order: "asc" });
    expect(parseServicesQuery({ page: "0" }).page).toBe(1);
    expect(parseServicesQuery({ page: "-2" }).page).toBe(1);
    expect(parseServicesQuery({ page: "1.5" }).page).toBe(1);
    expect(parseServicesQuery({ page: "99999999999" }).page).toBe(100_000);
  });

  it("treats a blank search as none and cuts a long one to the limit", () => {
    expect(parseServicesQuery({ search: "   " }).search).toBeUndefined();
    expect(parseServicesQuery({ search: "" }).search).toBeUndefined();
    expect(parseServicesQuery({ search: "x".repeat(150) }).search).toHaveLength(100);
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseServicesQuery({ status: ["published", "archived"] }).status).toBe("published");
    expect(parseServicesQuery({ search: ["ac", "cleaning"] }).search).toBe("ac");
  });
});

describe("toApiQueryString", () => {
  it("always sends page, size, sort and order, and the filters that are set", () => {
    expect(
      toApiQueryString({
        status: undefined,
        search: undefined,
        page: 1,
        sort: "sortOrder",
        order: "asc",
      }),
    ).toBe("page=1&pageSize=20&sort=sortOrder&order=asc");
    expect(
      toApiQueryString({
        status: "published",
        search: "ac & heat",
        page: 2,
        sort: "name",
        order: "desc",
      }),
    ).toBe("page=2&pageSize=20&sort=name&order=desc&status=published&search=ac+%26+heat");
  });

  it("round-trips through the parser, so what the page shows is what it asked for", () => {
    const query = parseServicesQuery({
      status: "unpublished",
      search: "wash",
      sort: "category",
      order: "desc",
      page: "4",
    });
    const params = Object.fromEntries(new URLSearchParams(toApiQueryString(query)));
    expect(parseServicesQuery(params)).toEqual(query);
  });
});

describe("hasActiveFilters", () => {
  it("is true for a status or a search, false for sort and page alone", () => {
    expect(hasActiveFilters(parseServicesQuery({}))).toBe(false);
    expect(hasActiveFilters(parseServicesQuery({ sort: "name", page: "2" }))).toBe(false);
    expect(hasActiveFilters(parseServicesQuery({ status: "archived" }))).toBe(true);
    expect(hasActiveFilters(parseServicesQuery({ search: "ac" }))).toBe(true);
  });
});
