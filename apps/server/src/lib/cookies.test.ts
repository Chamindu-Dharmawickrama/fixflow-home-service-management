import { describe, expect, it } from "vitest";

import { parseCookie } from "./cookies.js";

describe("parseCookie", () => {
  it("finds a cookie among several", () => {
    expect(parseCookie("theme=dark; fixflow_session=abc123; other=1", "fixflow_session")).toBe(
      "abc123",
    );
  });

  it("returns undefined when the cookie, or the header, is missing", () => {
    expect(parseCookie("theme=dark", "fixflow_session")).toBeUndefined();
    expect(parseCookie("", "fixflow_session")).toBeUndefined();
    expect(parseCookie(undefined, "fixflow_session")).toBeUndefined();
  });

  it("matches the whole name, not a suffix or prefix", () => {
    expect(parseCookie("x_fixflow_session=nope; fixflow_session_2=nope", "fixflow_session")).toBe(
      undefined,
    );
    expect(parseCookie("__Host-fixflow_session=yes", "__Host-fixflow_session")).toBe("yes");
  });

  it("unquotes and decodes the value, and keeps '=' inside it", () => {
    expect(parseCookie('a="hello%20world"', "a")).toBe("hello world");
    expect(parseCookie("a=b=c==", "a")).toBe("b=c==");
  });

  it("ignores malformed pairs and undecodable values instead of throwing", () => {
    expect(parseCookie("garbage; a=%E0%A4%A", "a")).toBeUndefined();
    expect(parseCookie("garbage; a=ok", "a")).toBe("ok");
  });
});
