import { describe, expect, it } from "vitest";

import { apiPath } from "./paths";

describe("apiPath", () => {
  it("prefixes a route with the shared API prefix", () => {
    expect(apiPath("/health")).toBe("/api/v1/health");
  });

  it("keeps nested route segments intact", () => {
    expect(apiPath("/service-requests/123/notes")).toBe("/api/v1/service-requests/123/notes");
  });

  it("returns a relative URL so the browser stays on the web origin", () => {
    expect(apiPath("/health").startsWith("/")).toBe(true);
    expect(apiPath("/health")).not.toMatch(/^[a-z]+:\/\//i);
  });
});
