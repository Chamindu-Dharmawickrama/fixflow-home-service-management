import { describe, expect, it } from "vitest";

import { buildHref } from "./url";

describe("buildHref", () => {
  it("returns the bare path when there is nothing to add", () => {
    expect(buildHref("/app/requests", {})).toBe("/app/requests");
  });

  it("keeps the current parameters and sets the patched one", () => {
    expect(buildHref("/app/requests", { status: "SUBMITTED", page: "3" }, { page: 4 })).toBe(
      "/app/requests?status=SUBMITTED&page=4",
    );
  });

  it("adds a parameter that was not there", () => {
    expect(buildHref("/app/requests", { status: "QUOTED" }, { sort: "createdAt" })).toBe(
      "/app/requests?status=QUOTED&sort=createdAt",
    );
  });

  it("removes a parameter patched to null, undefined or an empty string", () => {
    const current = { status: "QUOTED", page: "2", q: "ac" };
    expect(buildHref("/x", current, { page: null })).toBe("/x?status=QUOTED&q=ac");
    expect(buildHref("/x", current, { page: undefined })).toBe("/x?status=QUOTED&q=ac");
    expect(buildHref("/x", current, { q: "" })).toBe("/x?status=QUOTED&page=2");
  });

  it("keeps repeated parameters", () => {
    expect(buildHref("/x", { status: ["SUBMITTED", "QUOTED"] }, { page: 2 })).toBe(
      "/x?status=SUBMITTED&status=QUOTED&page=2",
    );
  });

  it("ignores undefined values in the current query", () => {
    expect(buildHref("/x", { q: undefined, page: "2" })).toBe("/x?page=2");
  });

  it("encodes values", () => {
    expect(buildHref("/x", {}, { q: "AC repair & tune-up" })).toBe("/x?q=AC+repair+%26+tune-up");
  });
});
