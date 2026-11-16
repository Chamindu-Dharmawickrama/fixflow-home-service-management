import { describe, expect, it } from "vitest";

import {
  jobPath,
  JOBS_PATH,
  parsePastPage,
  PAST_JOBS_PAGE_SIZE,
  pastQuery,
  UPCOMING_JOBS_LIMIT,
  upcomingQuery,
} from "./jobs";

describe("the portal job addresses", () => {
  it("keys a job by its id, encoded, and never by its reference", () => {
    expect(JOBS_PATH).toBe("/portal/jobs");
    expect(jobPath("0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11")).toBe(
      "/portal/jobs/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    );
    expect(jobPath("a/b?c")).toBe("/portal/jobs/a%2Fb%3Fc");
  });
});

describe("parsePastPage", () => {
  it("reads a page number from the address", () => {
    expect(parsePastPage({ page: "3" })).toBe(3);
  });

  it.each([undefined, "", "0", "-1", "abc", "1.5", "2e3"])(
    "falls back to the first page for %j",
    (page) => {
      expect(parsePastPage(page === undefined ? {} : { page })).toBe(1);
    },
  );

  it("takes the first of a repeated parameter", () => {
    expect(parsePastPage({ page: ["4", "9"] })).toBe(4);
  });

  it("caps an absurd page at the API's limit", () => {
    expect(parsePastPage({ page: "99999999999" })).toBe(100_000);
  });
});

describe("the queries to GET /work-orders/me", () => {
  it("asks for every upcoming job at once, up to the API's page ceiling", () => {
    expect(new URLSearchParams(upcomingQuery()).get("group")).toBe("upcoming");
    expect(Number(new URLSearchParams(upcomingQuery()).get("pageSize"))).toBe(UPCOMING_JOBS_LIMIT);
    expect(UPCOMING_JOBS_LIMIT).toBe(100);
  });

  it("asks for one page of the past jobs", () => {
    const params = new URLSearchParams(pastQuery(2));
    expect(params.get("group")).toBe("past");
    expect(params.get("page")).toBe("2");
    expect(Number(params.get("pageSize"))).toBe(PAST_JOBS_PAGE_SIZE);
  });
});
