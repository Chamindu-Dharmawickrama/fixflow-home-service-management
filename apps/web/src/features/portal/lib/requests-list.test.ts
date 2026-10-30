import { describe, expect, it } from "vitest";

import {
  hasActiveFilters,
  parseRequestsQuery,
  requestConfirmationPath,
  requestPath,
  REQUESTS_PAGE_SIZE,
  toApiQueryString,
} from "./requests-list";

describe("parseRequestsQuery (D-40: filters live in the URL)", () => {
  it("defaults to every status on the first page", () => {
    expect(parseRequestsQuery({})).toEqual({ status: undefined, page: 1 });
  });

  it("reads a status and a page", () => {
    expect(parseRequestsQuery({ status: "QUOTED", page: "3" })).toEqual({
      status: "QUOTED",
      page: 3,
    });
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseRequestsQuery({ status: ["CANCELLED", "QUOTED"], page: ["2", "9"] })).toEqual({
      status: "CANCELLED",
      page: 2,
    });
  });

  it.each(["", "open", "submitted", "ALL", "SUBMITTED; DROP TABLE"])(
    "falls back to every status for the unusable status %j",
    (status) => {
      expect(parseRequestsQuery({ status }).status).toBeUndefined();
    },
  );

  it.each(["", "0", "-1", "1.5", "abc", "1e3", " 2"])(
    "falls back to the first page for the unusable page %j",
    (page) => {
      expect(parseRequestsQuery({ page }).page).toBe(1);
    },
  );

  it("caps the page, so the API is never asked for an absurd offset", () => {
    expect(parseRequestsQuery({ page: "99999999" }).page).toBe(100_000);
  });
});

describe("toApiQueryString", () => {
  it("asks for a page of the default size", () => {
    expect(toApiQueryString({ status: undefined, page: 2 })).toBe(
      `page=2&pageSize=${REQUESTS_PAGE_SIZE}`,
    );
  });

  it("adds the status filter, and a page size when given", () => {
    expect(toApiQueryString({ status: "SUBMITTED", page: 1 }, 3)).toBe(
      "page=1&pageSize=3&status=SUBMITTED",
    );
  });
});

describe("hasActiveFilters", () => {
  it("is true only when a status narrows the list", () => {
    expect(hasActiveFilters({ status: undefined, page: 4 })).toBe(false);
    expect(hasActiveFilters({ status: "DECLINED", page: 1 })).toBe(true);
  });
});

describe("request paths", () => {
  it("key a request by its id", () => {
    expect(requestPath("0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11")).toBe(
      "/portal/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    );
  });

  it("mark the confirmation page after sending", () => {
    expect(requestConfirmationPath("abc")).toBe("/portal/requests/abc?submitted=1");
  });
});
