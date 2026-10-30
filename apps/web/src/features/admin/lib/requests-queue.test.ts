import { describe, expect, it } from "vitest";

import {
  adminRequestPath,
  allStatusesHref,
  formCarryOver,
  hasActiveFilters,
  hasFormFilters,
  parseQueueQuery,
  QUEUE_PATH,
  type QueueQuery,
  sortHref,
  statusChipHref,
  toApiQueryString,
  toggleStatus,
} from "./requests-queue";

const SERVICE_ID = "0b5f8d6e-6a1c-4f43-9d2e-3d1c8e4a7b10";

const DEFAULTS: QueueQuery = {
  q: undefined,
  status: [],
  serviceId: undefined,
  submittedFrom: undefined,
  submittedTo: undefined,
  sort: "submittedAt",
  order: "desc",
  page: 1,
};

/** The query parameters of a link, so a test does not depend on how a comma is encoded. */
function paramsOf(href: string): URLSearchParams {
  return new URL(href, "http://localhost").searchParams;
}

describe("adminRequestPath", () => {
  it("keys the request by its id", () => {
    expect(adminRequestPath("abc")).toBe("/app/requests/abc");
  });
});

describe("parseQueueQuery", () => {
  it("shows the newest requests first when nothing is asked", () => {
    expect(parseQueueQuery({})).toEqual(DEFAULTS);
  });

  it("reads the search, trimmed and without an empty value", () => {
    expect(parseQueueQuery({ q: "  FF-2026-00012  " }).q).toBe("FF-2026-00012");
    expect(parseQueueQuery({ q: "   " }).q).toBeUndefined();
    expect(parseQueueQuery({ q: "" }).q).toBeUndefined();
  });

  it("keeps the search within the length the API accepts", () => {
    expect(parseQueueQuery({ q: "x".repeat(300) }).q).toHaveLength(100);
  });

  it("uses the first value when a parameter is repeated", () => {
    expect(parseQueueQuery({ q: ["first", "second"] }).q).toBe("first");
  });

  describe("status", () => {
    it.each([
      { name: "one status", input: "UNDER_REVIEW", expected: ["UNDER_REVIEW"] },
      {
        name: "a comma-separated list",
        input: "UNDER_REVIEW,SUBMITTED",
        expected: ["SUBMITTED", "UNDER_REVIEW"],
      },
      {
        name: "a repeated parameter",
        input: ["CANCELLED", "SUBMITTED"],
        expected: ["SUBMITTED", "CANCELLED"],
      },
      {
        name: "a list with spaces and repeats",
        input: " QUOTED , QUOTED,SUBMITTED",
        expected: ["SUBMITTED", "QUOTED"],
      },
      {
        name: "an unknown status among valid ones",
        input: "SUBMITTED,NOPE",
        expected: ["SUBMITTED"],
      },
      { name: "only unknown statuses", input: "NOPE,submitted", expected: [] },
      { name: "an empty value", input: "", expected: [] },
    ])("accepts $name, in workflow order", ({ input, expected }) => {
      expect(parseQueueQuery({ status: input }).status).toEqual(expected);
    });
  });

  describe("service and dates", () => {
    it("accepts a service id and drops anything that is not one", () => {
      expect(parseQueueQuery({ serviceId: SERVICE_ID }).serviceId).toBe(SERVICE_ID);
      expect(parseQueueQuery({ serviceId: "not-a-uuid" }).serviceId).toBeUndefined();
      expect(parseQueueQuery({ serviceId: "" }).serviceId).toBeUndefined();
    });

    it("accepts real calendar dates and drops the rest", () => {
      expect(
        parseQueueQuery({ submittedFrom: "2026-03-01", submittedTo: "2026-03-31" }),
      ).toMatchObject({ submittedFrom: "2026-03-01", submittedTo: "2026-03-31" });
      const bad = parseQueueQuery({ submittedFrom: "2026-02-30", submittedTo: "tomorrow" });
      expect(bad.submittedFrom).toBeUndefined();
      expect(bad.submittedTo).toBeUndefined();
    });

    it("puts a range given backwards the right way round", () => {
      expect(
        parseQueueQuery({ submittedFrom: "2026-04-10", submittedTo: "2026-04-01" }),
      ).toMatchObject({ submittedFrom: "2026-04-01", submittedTo: "2026-04-10" });
    });

    it("keeps a one-day range", () => {
      expect(
        parseQueueQuery({ submittedFrom: "2026-04-10", submittedTo: "2026-04-10" }),
      ).toMatchObject({ submittedFrom: "2026-04-10", submittedTo: "2026-04-10" });
    });

    it("keeps an open-ended range", () => {
      const query = parseQueueQuery({ submittedFrom: "2026-04-10" });
      expect(query.submittedFrom).toBe("2026-04-10");
      expect(query.submittedTo).toBeUndefined();
    });
  });

  describe("sort and order", () => {
    it.each([
      { sort: "submittedAt", order: undefined, expected: "desc" },
      { sort: "updatedAt", order: undefined, expected: "asc" },
      { sort: "status", order: undefined, expected: "asc" },
      { sort: "reference", order: undefined, expected: "asc" },
      { sort: "reference", order: "desc", expected: "desc" },
      { sort: "submittedAt", order: "asc", expected: "asc" },
    ])("sorts $sort with order $order as $expected", ({ sort, order, expected }) => {
      const query = parseQueueQuery({ sort, ...(order ? { order } : {}) });
      expect(query.sort).toBe(sort);
      expect(query.order).toBe(expected);
    });

    it("falls back to newest first for an unknown sort or order", () => {
      expect(parseQueueQuery({ sort: "customerName" })).toMatchObject({
        sort: "submittedAt",
        order: "desc",
      });
      expect(parseQueueQuery({ order: "sideways" }).order).toBe("desc");
    });
  });

  describe("page", () => {
    it.each([
      { input: "3", expected: 3 },
      { input: "1", expected: 1 },
      { input: "0", expected: 1 },
      { input: "-2", expected: 1 },
      { input: "2.5", expected: 1 },
      { input: "abc", expected: 1 },
      { input: "", expected: 1 },
      { input: "99999999", expected: 100_000 },
    ])("reads page $input as $expected", ({ input, expected }) => {
      expect(parseQueueQuery({ page: input }).page).toBe(expected);
    });
  });
});

describe("toApiQueryString", () => {
  it("always sends the page, size and a sort", () => {
    const params = paramsOf(`/x?${toApiQueryString(DEFAULTS)}`);
    expect(Object.fromEntries(params)).toEqual({
      page: "1",
      pageSize: "20",
      sort: "submittedAt",
      order: "desc",
    });
  });

  it("sends every filter that is set, with the statuses joined", () => {
    const params = paramsOf(
      `/x?${toApiQueryString({
        q: "Okafor",
        status: ["SUBMITTED", "UNDER_REVIEW"],
        serviceId: SERVICE_ID,
        submittedFrom: "2026-03-01",
        submittedTo: "2026-03-31",
        sort: "status",
        order: "asc",
        page: 4,
      })}`,
    );
    expect(Object.fromEntries(params)).toEqual({
      page: "4",
      pageSize: "20",
      sort: "status",
      order: "asc",
      q: "Okafor",
      status: "SUBMITTED,UNDER_REVIEW",
      serviceId: SERVICE_ID,
      submittedFrom: "2026-03-01",
      submittedTo: "2026-03-31",
    });
  });

  it("encodes a search that contains characters with meaning in a URL", () => {
    const search = "A&B=C #1 100%";
    const params = paramsOf(`/x?${toApiQueryString({ ...DEFAULTS, q: search })}`);
    expect(params.get("q")).toBe(search);
    expect([...params.keys()]).not.toContain("B");
  });

  it("does not send a filter that is not set", () => {
    const keys = [...paramsOf(`/x?${toApiQueryString(DEFAULTS)}`).keys()];
    for (const unset of ["q", "status", "serviceId", "submittedFrom", "submittedTo"]) {
      expect(keys).not.toContain(unset);
    }
  });
});

describe("hasActiveFilters", () => {
  it("is false for the plain queue, whatever the sort and page", () => {
    expect(hasActiveFilters(DEFAULTS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULTS, sort: "reference", order: "asc", page: 7 })).toBe(false);
  });

  it.each([
    { name: "a search", change: { q: "pipe" } },
    { name: "a status", change: { status: ["QUOTED" as const] } },
    { name: "a service", change: { serviceId: SERVICE_ID } },
    { name: "a start date", change: { submittedFrom: "2026-03-01" } },
    { name: "an end date", change: { submittedTo: "2026-03-01" } },
  ])("is true with $name", ({ change }) => {
    expect(hasActiveFilters({ ...DEFAULTS, ...change })).toBe(true);
  });
});

describe("hasFormFilters", () => {
  it("ignores the status, which the chips own", () => {
    expect(hasFormFilters(DEFAULTS)).toBe(false);
    expect(hasFormFilters({ ...DEFAULTS, status: ["QUOTED"] })).toBe(false);
  });

  it.each([
    { name: "a search", change: { q: "pipe" } },
    { name: "a service", change: { serviceId: SERVICE_ID } },
    { name: "a start date", change: { submittedFrom: "2026-03-01" } },
    { name: "an end date", change: { submittedTo: "2026-03-01" } },
  ])("is true with $name", ({ change }) => {
    expect(hasFormFilters({ ...DEFAULTS, ...change })).toBe(true);
  });
});

describe("formCarryOver", () => {
  it("carries nothing for the plain queue", () => {
    expect(formCarryOver(DEFAULTS)).toEqual({});
  });

  it("carries the statuses, joined", () => {
    expect(formCarryOver({ ...DEFAULTS, status: ["SUBMITTED", "QUOTED"] })).toEqual({
      status: "SUBMITTED,QUOTED",
    });
  });

  it("carries a sort that is not the default, with its order", () => {
    expect(formCarryOver({ ...DEFAULTS, sort: "reference", order: "asc" })).toEqual({
      sort: "reference",
      order: "asc",
    });
    expect(formCarryOver({ ...DEFAULTS, order: "asc" })).toEqual({
      sort: "submittedAt",
      order: "asc",
    });
  });

  it("does not carry the search, the service or the dates", () => {
    expect(
      formCarryOver({
        ...DEFAULTS,
        q: "pipe",
        serviceId: SERVICE_ID,
        submittedFrom: "2026-03-01",
        submittedTo: "2026-03-02",
        page: 3,
      }),
    ).toEqual({});
  });
});

describe("toggleStatus", () => {
  it("adds a status that is not chosen", () => {
    expect(toggleStatus([], "QUOTED")).toEqual(["QUOTED"]);
  });

  it("removes a status that is chosen", () => {
    expect(toggleStatus(["SUBMITTED", "QUOTED"], "SUBMITTED")).toEqual(["QUOTED"]);
  });

  it("keeps the workflow order whatever order they were chosen in", () => {
    expect(toggleStatus(["CANCELLED", "QUOTED"], "SUBMITTED")).toEqual([
      "SUBMITTED",
      "QUOTED",
      "CANCELLED",
    ]);
  });

  it("does not change what it was given", () => {
    const current = ["QUOTED" as const];
    toggleStatus(current, "SUBMITTED");
    expect(current).toEqual(["QUOTED"]);
  });
});

describe("links", () => {
  it("toggles a status on and sends the person back to page 1", () => {
    const href = statusChipHref(
      { q: "pipe", page: "4", sort: "reference" },
      ["QUOTED"],
      "SUBMITTED",
    );
    expect(href.startsWith(`${QUEUE_PATH}?`)).toBe(true);
    const params = paramsOf(href);
    expect(params.get("status")).toBe("SUBMITTED,QUOTED");
    expect(params.get("q")).toBe("pipe");
    expect(params.get("sort")).toBe("reference");
    expect(params.has("page")).toBe(false);
  });

  it("toggles the last status off by dropping the parameter", () => {
    const href = statusChipHref({ status: "QUOTED", q: "pipe" }, ["QUOTED"], "QUOTED");
    const params = paramsOf(href);
    expect(params.has("status")).toBe(false);
    expect(params.get("q")).toBe("pipe");
  });

  it("clears every status for All, keeping the rest", () => {
    const params = paramsOf(
      allStatusesHref({ status: "QUOTED,CANCELLED", q: "pipe", serviceId: SERVICE_ID, page: "2" }),
    );
    expect(params.has("status")).toBe(false);
    expect(params.has("page")).toBe(false);
    expect(params.get("q")).toBe("pipe");
    expect(params.get("serviceId")).toBe(SERVICE_ID);
  });

  it("links to the plain queue when nothing is left", () => {
    expect(allStatusesHref({ status: "QUOTED" })).toBe(QUEUE_PATH);
  });

  it("starts a new sort ascending, and flips the one in force", () => {
    const query: QueueQuery = { ...DEFAULTS, sort: "reference", order: "asc" };
    expect(paramsOf(sortHref({}, query, "status")).get("order")).toBe("asc");
    expect(paramsOf(sortHref({}, query, "reference")).get("order")).toBe("desc");
    expect(paramsOf(sortHref({}, { ...query, order: "desc" }, "reference")).get("order")).toBe(
      "asc",
    );
  });

  it("keeps the filters and goes back to page 1 when the sort changes", () => {
    const params = paramsOf(
      sortHref({ q: "pipe", status: "QUOTED", page: "5" }, DEFAULTS, "updatedAt"),
    );
    expect(params.get("sort")).toBe("updatedAt");
    expect(params.get("q")).toBe("pipe");
    expect(params.get("status")).toBe("QUOTED");
    expect(params.has("page")).toBe(false);
  });
});
