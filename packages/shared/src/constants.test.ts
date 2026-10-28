import { describe, expect, it } from "vitest";

import { API_PREFIX } from "./constants.js";
import * as shared from "./index.js";

describe("API_PREFIX", () => {
  it("is the versioned API path prefix", () => {
    expect(API_PREFIX).toBe("/api/v1");
  });

  it("starts with a slash and has no trailing slash, so it can be concatenated with route paths", () => {
    expect(API_PREFIX.startsWith("/")).toBe(true);
    expect(API_PREFIX.endsWith("/")).toBe(false);
  });

  it("is re-exported from the package entry point", () => {
    expect(shared.API_PREFIX).toBe(API_PREFIX);
  });
});
