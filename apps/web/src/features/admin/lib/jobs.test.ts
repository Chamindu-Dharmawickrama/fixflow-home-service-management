import { LIMITS } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  adminJobPath,
  adminJobSchedulePath,
  DEFAULT_VIEW,
  hasActiveJobFilters,
  JOBS_PATH,
  jobsFormCarryOver,
  jobsSortHref,
  jobsTabHref,
  parseJobsQuery,
  toJobsApiQueryString,
  VIEW_DEFAULT_SORT,
  VIEW_LABELS,
} from "./jobs";

const ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

describe("the paths", () => {
  it("keys a job by its id", () => {
    expect(adminJobPath(ID)).toBe(`/app/jobs/${ID}`);
    expect(adminJobPath("a b")).toBe("/app/jobs/a%20b");
  });

  it("opens the scheduling dialog from the address", () => {
    expect(adminJobSchedulePath(ID)).toBe(`/app/jobs/${ID}?schedule=1`);
  });
});

describe("the tabs", () => {
  it("name every tab in words", () => {
    expect(VIEW_LABELS).toEqual({
      "needs-scheduling": "Needs scheduling",
      upcoming: "Upcoming",
      "in-progress": "In progress",
      completed: "Completed",
      all: "All",
    });
  });

  it("open on what is waiting for a time", () => {
    expect(DEFAULT_VIEW).toBe("needs-scheduling");
    expect(parseJobsQuery({}).view).toBe("needs-scheduling");
  });
});

describe("parseJobsQuery", () => {
  it("reads a tab, a search, filters, a sort and a page", () => {
    expect(
      parseJobsQuery({
        view: "upcoming",
        q: "  priya  ",
        technicianId: ID,
        scheduledFrom: "2026-03-01",
        scheduledTo: "2026-03-31",
        sort: "status",
        order: "desc",
        page: "3",
      }),
    ).toEqual({
      view: "upcoming",
      q: "priya",
      technicianId: ID,
      scheduledFrom: "2026-03-01",
      scheduledTo: "2026-03-31",
      sort: "status",
      order: "desc",
      page: 3,
    });
  });

  it("falls back to defaults for anything unusable, instead of failing the page", () => {
    expect(
      parseJobsQuery({
        view: "overdue",
        q: "   ",
        technicianId: "jordan",
        scheduledFrom: "tomorrow",
        scheduledTo: "2026-02-30",
        sort: "reference",
        order: "sideways",
        page: "-2",
      }),
    ).toEqual({
      view: "needs-scheduling",
      q: undefined,
      technicianId: undefined,
      scheduledFrom: undefined,
      scheduledTo: undefined,
      sort: "createdAt",
      order: "asc",
      page: 1,
    });
  });

  it("puts a range given backwards the right way round", () => {
    const query = parseJobsQuery({ scheduledFrom: "2026-03-31", scheduledTo: "2026-03-01" });
    expect(query).toMatchObject({ scheduledFrom: "2026-03-01", scheduledTo: "2026-03-31" });
  });

  it("reads each tab in its own order unless a column is chosen", () => {
    for (const view of [
      "needs-scheduling",
      "upcoming",
      "in-progress",
      "completed",
      "all",
    ] as const) {
      const query = parseJobsQuery({ view });
      expect({ sort: query.sort, order: query.order }).toEqual(VIEW_DEFAULT_SORT[view]);
    }
  });

  it("starts a chosen column ascending, and keeps the tab's own order for its own column", () => {
    expect(parseJobsQuery({ view: "completed", sort: "status" })).toMatchObject({
      sort: "status",
      order: "asc",
    });
    expect(parseJobsQuery({ view: "completed", sort: "scheduledStart" })).toMatchObject({
      sort: "scheduledStart",
      order: "desc",
    });
  });

  it("takes the first of a repeated parameter and caps the page and the search", () => {
    expect(parseJobsQuery({ view: ["all", "upcoming"] }).view).toBe("all");
    expect(parseJobsQuery({ page: "999999999" }).page).toBe(LIMITS.pagination.maxPage);
    expect(parseJobsQuery({ q: "x".repeat(300) }).q).toHaveLength(100);
  });
});

describe("toJobsApiQueryString", () => {
  it("sends the tab, the sort and the page, and only the filters that are set", () => {
    const plain = new URLSearchParams(toJobsApiQueryString(parseJobsQuery({})));
    expect(Object.fromEntries(plain)).toEqual({
      view: "needs-scheduling",
      page: "1",
      pageSize: "20",
      sort: "createdAt",
      order: "asc",
    });

    const full = new URLSearchParams(
      toJobsApiQueryString(
        parseJobsQuery({
          view: "upcoming",
          q: "priya",
          technicianId: ID,
          scheduledFrom: "2026-03-01",
          scheduledTo: "2026-03-31",
        }),
      ),
    );
    expect(Object.fromEntries(full)).toMatchObject({
      view: "upcoming",
      q: "priya",
      technicianId: ID,
      scheduledFrom: "2026-03-01",
      scheduledTo: "2026-03-31",
    });
  });
});

describe("hasActiveJobFilters", () => {
  it("is true for any search or filter, and not for a tab or a sort", () => {
    expect(hasActiveJobFilters(parseJobsQuery({}))).toBe(false);
    expect(hasActiveJobFilters(parseJobsQuery({ view: "all", sort: "status" }))).toBe(false);
    expect(hasActiveJobFilters(parseJobsQuery({ q: "x" }))).toBe(true);
    expect(hasActiveJobFilters(parseJobsQuery({ technicianId: ID }))).toBe(true);
    expect(hasActiveJobFilters(parseJobsQuery({ scheduledFrom: "2026-03-01" }))).toBe(true);
    expect(hasActiveJobFilters(parseJobsQuery({ scheduledTo: "2026-03-01" }))).toBe(true);
  });
});

describe("jobsFormCarryOver", () => {
  it("keeps nothing on the default tab in its default order", () => {
    expect(jobsFormCarryOver(parseJobsQuery({}))).toEqual({});
  });

  it("keeps the tab, and the sort only when it is not the tab's own", () => {
    expect(jobsFormCarryOver(parseJobsQuery({ view: "upcoming" }))).toEqual({ view: "upcoming" });
    expect(jobsFormCarryOver(parseJobsQuery({ view: "upcoming", sort: "status" }))).toEqual({
      view: "upcoming",
      sort: "status",
      order: "asc",
    });
  });
});

describe("the links", () => {
  it("move to a tab on page 1, keeping the search and filters but not the sort", () => {
    expect(
      jobsTabHref(
        { view: "all", q: "priya", sort: "status", order: "desc", page: "4" },
        "upcoming",
      ),
    ).toBe(`${JOBS_PATH}?q=priya&view=upcoming`);
  });

  it("give the default tab a clean address", () => {
    expect(jobsTabHref({ view: "all", q: "priya" }, "needs-scheduling")).toBe(
      `${JOBS_PATH}?q=priya`,
    );
    expect(jobsTabHref({}, "needs-scheduling")).toBe(JOBS_PATH);
  });

  it("flip the order of the column that is the sort, and start another ascending", () => {
    const params = { view: "upcoming" };
    const query = parseJobsQuery(params);
    expect(jobsSortHref(params, query, "scheduledStart")).toBe(
      `${JOBS_PATH}?view=upcoming&sort=scheduledStart&order=desc`,
    );
    expect(jobsSortHref(params, query, "status")).toBe(
      `${JOBS_PATH}?view=upcoming&sort=status&order=asc`,
    );
  });
});
