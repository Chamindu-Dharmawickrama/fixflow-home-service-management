import { describe, expect, it } from "vitest";

import {
  adminCustomerPath,
  adminCustomerTabPath,
  customersSortHref,
  DEFAULT_TAB,
  defaultOrder,
  hasActiveSearch,
  isZeroAmount,
  parseCustomersQuery,
  parseCustomerTab,
  RECORD_PATHS,
  sortCarryOver,
  tabHref,
  toCustomersApiQueryString,
  toHistoryApiQueryString,
} from "./customers";
import { adminRequestPath } from "./requests-queue";

const ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("paths", () => {
  it("keys a customer by id, and a tab is a query parameter", () => {
    expect(adminCustomerPath(ID)).toBe(`/app/customers/${ID}`);
    expect(adminCustomerTabPath(ID, "invoices")).toBe(`/app/customers/${ID}?tab=invoices`);
  });

  it("does not let an id change the path", () => {
    expect(adminCustomerPath("../requests")).toBe("/app/customers/..%2Frequests");
  });
});

describe("isZeroAmount", () => {
  it.each(["0", "0.00", "00.0", "0.000"])("%s is nothing", (amount) => {
    expect(isZeroAmount(amount)).toBe(true);
  });

  it.each(["0.01", "1", "20.00", "1234567.89", "100.00"])("%s is something", (amount) => {
    expect(isZeroAmount(amount)).toBe(false);
  });
});

describe("parseCustomersQuery", () => {
  it("is the first page by name from A to Z when the address says nothing", () => {
    expect(parseCustomersQuery({})).toEqual({
      q: undefined,
      sort: "name",
      order: "asc",
      page: 1,
    });
  });

  it("starts each column the way it is read: names up, dates newest first", () => {
    expect(defaultOrder("name")).toBe("asc");
    expect(defaultOrder("createdAt")).toBe("desc");
    expect(defaultOrder("lastActivityAt")).toBe("desc");
    expect(parseCustomersQuery({ sort: "lastActivityAt" }).order).toBe("desc");
    expect(parseCustomersQuery({ sort: "createdAt" }).order).toBe("desc");
  });

  it("takes the search, tidied", () => {
    expect(parseCustomersQuery({ q: "  alex    morgan " }).q).toBe("alex morgan");
    expect(parseCustomersQuery({ q: "   " }).q).toBeUndefined();
    expect(parseCustomersQuery({ q: "a".repeat(150) }).q).toHaveLength(100);
    expect(parseCustomersQuery({ q: ["first", "second"] }).q).toBe("first");
  });

  it("falls back for anything it does not recognise", () => {
    expect(parseCustomersQuery({ sort: "email", order: "sideways", page: "abc" })).toEqual({
      q: undefined,
      sort: "name",
      order: "asc",
      page: 1,
    });
    expect(parseCustomersQuery({ page: "0" }).page).toBe(1);
    expect(parseCustomersQuery({ page: "-3" }).page).toBe(1);
    expect(parseCustomersQuery({ page: "3" }).page).toBe(3);
    expect(parseCustomersQuery({ sort: "NAME" }).sort).toBe("name");
  });

  it("keeps an order the person chose", () => {
    expect(parseCustomersQuery({ sort: "name", order: "desc" })).toMatchObject({
      sort: "name",
      order: "desc",
    });
  });
});

describe("toCustomersApiQueryString", () => {
  it("always names the page, size, sort and order", () => {
    expect(toCustomersApiQueryString(parseCustomersQuery({}))).toBe(
      "page=1&pageSize=20&sort=name&order=asc",
    );
  });

  it("adds the search, encoded", () => {
    const query = parseCustomersQuery({ q: "o'brien & sons", page: "2" });
    const params = new URLSearchParams(toCustomersApiQueryString(query));
    expect(params.get("q")).toBe("o'brien & sons");
    expect(params.get("page")).toBe("2");
  });
});

describe("hasActiveSearch and sortCarryOver", () => {
  it("knows when a search narrows the list", () => {
    expect(hasActiveSearch(parseCustomersQuery({}))).toBe(false);
    expect(hasActiveSearch(parseCustomersQuery({ q: "alex" }))).toBe(true);
  });

  it("carries the sort only when it is not the default", () => {
    expect(sortCarryOver(parseCustomersQuery({}))).toEqual({});
    expect(sortCarryOver(parseCustomersQuery({ sort: "name", order: "asc" }))).toEqual({});
    expect(sortCarryOver(parseCustomersQuery({ sort: "name", order: "desc" }))).toEqual({
      sort: "name",
      order: "desc",
    });
    expect(sortCarryOver(parseCustomersQuery({ sort: "lastActivityAt" }))).toEqual({
      sort: "lastActivityAt",
      order: "desc",
    });
  });
});

describe("customersSortHref", () => {
  it("flips the order of the column that is already the sort", () => {
    const params = { sort: "name", order: "asc" };
    expect(customersSortHref(params, parseCustomersQuery(params), "name")).toBe(
      "/app/customers?sort=name&order=desc",
    );
    const reversed = { sort: "name", order: "desc" };
    expect(customersSortHref(reversed, parseCustomersQuery(reversed), "name")).toBe(
      "/app/customers?sort=name&order=asc",
    );
  });

  it("starts another column in its natural order, on page 1, keeping the search", () => {
    const params = { q: "alex", page: "3" };
    expect(customersSortHref(params, parseCustomersQuery(params), "lastActivityAt")).toBe(
      "/app/customers?q=alex&sort=lastActivityAt&order=desc",
    );
    expect(customersSortHref(params, parseCustomersQuery(params), "createdAt")).toBe(
      "/app/customers?q=alex&sort=createdAt&order=desc",
    );
  });

  it("ignores a column that cannot be sorted", () => {
    const params = { q: "alex", page: "3" };
    expect(customersSortHref(params, parseCustomersQuery(params), "phone")).toBe(
      "/app/customers?q=alex",
    );
  });
});

describe("parseCustomerTab", () => {
  it("opens the requests on page 1 unless told otherwise", () => {
    expect(DEFAULT_TAB).toBe("requests");
    expect(parseCustomerTab({})).toEqual({ tab: "requests", page: 1 });
  });

  it("takes any of the four tabs and a page", () => {
    for (const tab of ["requests", "quotations", "jobs", "invoices"] as const) {
      expect(parseCustomerTab({ tab, page: "2" })).toEqual({ tab, page: 2 });
    }
  });

  it("falls back for an unknown tab or page", () => {
    expect(parseCustomerTab({ tab: "payments", page: "x" })).toEqual({ tab: "requests", page: 1 });
    expect(parseCustomerTab({ tab: "JOBS" })).toEqual({ tab: "requests", page: 1 });
    expect(parseCustomerTab({ tab: ["jobs", "invoices"] })).toEqual({ tab: "jobs", page: 1 });
  });
});

describe("history links", () => {
  it("asks the API for the tab's kind, page and size", () => {
    expect(toHistoryApiQueryString({ tab: "jobs", page: 2 })).toBe("type=jobs&page=2&pageSize=10");
  });

  it("goes to another tab on its first page, keeping nothing of the old page", () => {
    expect(tabHref(ID, { tab: "requests", page: "4" }, "jobs")).toBe(
      `/app/customers/${ID}?tab=jobs`,
    );
  });
});

describe("RECORD_PATHS", () => {
  it("opens a request and a quotation, and nothing else has a page yet (no link to a page that does not exist)", () => {
    expect(RECORD_PATHS.requests?.("abc")).toBe(adminRequestPath("abc"));
    expect(RECORD_PATHS.quotations?.("abc")).toBe("/app/quotations/abc");
    expect(RECORD_PATHS.jobs).toBeNull();
    expect(RECORD_PATHS.invoices).toBeNull();
  });
});
