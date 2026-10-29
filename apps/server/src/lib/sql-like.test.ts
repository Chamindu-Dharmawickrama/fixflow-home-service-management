import { describe, expect, it } from "vitest";

import { escapeLikePattern } from "./sql-like.js";

describe("escapeLikePattern", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeLikePattern("air conditioning")).toBe("air conditioning");
    expect(escapeLikePattern("")).toBe("");
    expect(escapeLikePattern("AC-2 (split)")).toBe("AC-2 (split)");
  });

  it("escapes the wildcards and the escape character itself", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    expect(escapeLikePattern("%_\\")).toBe("\\%\\_\\\\");
  });
});
