import { LIMITS } from "@fixflow/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createPaginationSchema, paginated, toPrismaPage } from "./pagination.js";

const schema = createPaginationSchema({
  sortFields: ["createdAt", "customerName", "status"],
  defaultSort: "createdAt",
  defaultOrder: "desc",
});

function issuePaths(input: unknown): string[] {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("Expected the query to be invalid");
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("createPaginationSchema", () => {
  it("applies the defaults to an empty query", () => {
    expect(schema.parse({})).toEqual({
      page: 1,
      pageSize: LIMITS.pagination.defaultPageSize,
      sort: "createdAt",
      order: "desc",
    });
  });

  it("parses query-string values into numbers", () => {
    expect(schema.parse({ page: "3", pageSize: "50", sort: "status", order: "asc" })).toEqual({
      page: 3,
      pageSize: 50,
      sort: "status",
      order: "asc",
    });
  });

  it("accepts the maximum page size", () => {
    expect(schema.parse({ pageSize: "100" }).pageSize).toBe(100);
  });

  it("rejects a page size above the maximum", () => {
    expect(issuePaths({ pageSize: "101" })).toEqual(["pageSize"]);
  });

  it.each(["0", "-1", "1.5", "abc", "", "1e2", "0x10", "+5", " 5", "٣"])(
    "rejects the page size %j",
    (pageSize) => {
      expect(issuePaths({ pageSize })).toEqual(["pageSize"]);
    },
  );

  it.each(["0", "-1", "2.5", "x", ""])("rejects the page %j", (page) => {
    expect(issuePaths({ page })).toEqual(["page"]);
  });

  it("rejects a page beyond the maximum", () => {
    expect(issuePaths({ page: String(LIMITS.pagination.maxPage + 1) })).toEqual(["page"]);
    expect(schema.parse({ page: String(LIMITS.pagination.maxPage) }).page).toBe(
      LIMITS.pagination.maxPage,
    );
  });

  it("rejects repeated parameters", () => {
    expect(issuePaths({ page: ["1", "2"] })).toEqual(["page"]);
  });

  it("rejects a sort field that is not allowlisted", () => {
    expect(issuePaths({ sort: "passwordHash" })).toEqual(["sort"]);
  });

  it("names the allowed sort fields in the message", () => {
    const result = schema.safeParse({ sort: "nope" });

    expect(result.error?.issues[0]?.message).toBe(
      "sort must be one of: createdAt, customerName, status.",
    );
  });

  it("rejects an order that is neither asc nor desc", () => {
    expect(issuePaths({ order: "sideways" })).toEqual(["order"]);
    expect(issuePaths({ order: "ASC" })).toEqual(["order"]);
  });

  it("reports every invalid parameter", () => {
    expect(issuePaths({ page: "0", pageSize: "500", sort: "x", order: "y" })).toEqual([
      "page",
      "pageSize",
      "sort",
      "order",
    ]);
  });

  it("can be extended with endpoint filters and keeps the pagination rules", () => {
    const extended = schema.extend({ status: z.enum(["OPEN", "CLOSED"]).optional() });

    expect(extended.parse({ status: "OPEN", page: "2" })).toMatchObject({
      status: "OPEN",
      page: 2,
    });
    expect(extended.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it("ignores unknown query keys", () => {
    expect(schema.parse({ utm_source: "newsletter" })).toEqual(schema.parse({}));
  });
});

describe("toPrismaPage", () => {
  const params = { page: 1, pageSize: 20, sort: "createdAt", order: "desc" } as const;

  it("computes skip and take from page and pageSize", () => {
    expect(toPrismaPage({ ...params, page: 1 })).toMatchObject({ skip: 0, take: 20 });
    expect(toPrismaPage({ ...params, page: 2 })).toMatchObject({ skip: 20, take: 20 });
    expect(toPrismaPage({ ...params, page: 5, pageSize: 100 })).toMatchObject({
      skip: 400,
      take: 100,
    });
    expect(toPrismaPage({ ...params, page: 3, pageSize: 7 })).toMatchObject({ skip: 14, take: 7 });
  });

  it("orders by the requested field, then by id so pages are stable", () => {
    expect(toPrismaPage(params).orderBy).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
    expect(toPrismaPage({ ...params, sort: "name", order: "asc" }).orderBy).toEqual([
      { name: "asc" },
      { id: "asc" },
    ]);
  });

  it("lets an endpoint map a sort field to a nested column", () => {
    const page = toPrismaPage({ ...params, sort: "customerName", order: "asc" }, (sort, order) =>
      sort === "customerName" ? { customer: { name: order } } : { [sort]: order },
    );

    expect(page.orderBy).toEqual([{ customer: { name: "asc" } }, { id: "asc" }]);
  });

  it("keeps the largest page's skip within a 32-bit integer", () => {
    const { skip } = toPrismaPage({
      ...params,
      page: LIMITS.pagination.maxPage,
      pageSize: LIMITS.pagination.maxPageSize,
    });

    expect(skip).toBeLessThanOrEqual(2_147_483_647);
  });
});

describe("paginated", () => {
  it("wraps items in the list envelope", () => {
    expect(paginated(["a", "b"], { page: 2, pageSize: 20 }, 45)).toEqual({
      data: ["a", "b"],
      pagination: { page: 2, pageSize: 20, totalItems: 45, totalPages: 3 },
    });
  });

  it("rounds the page count up", () => {
    expect(paginated([], { page: 1, pageSize: 20 }, 20).pagination.totalPages).toBe(1);
    expect(paginated([], { page: 1, pageSize: 20 }, 21).pagination.totalPages).toBe(2);
  });

  it("reports zero pages when there are no items", () => {
    expect(paginated([], { page: 1, pageSize: 20 }, 0).pagination).toEqual({
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    });
  });
});
