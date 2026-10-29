import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";

import { loadErrorState } from "./load-error";

function failure(
  status: number,
  code: ConstructorParameters<typeof ApiError>[0]["code"],
  extra = {},
) {
  return new ApiError({
    status,
    code,
    message: "The server said no.",
    requestId: "req-42",
    ...extra,
  });
}

const OPTIONS = { title: "We couldn't load the services", retryHref: "/app/settings/services" };

describe("loadErrorState", () => {
  it("shows a server problem inside the page, with a retry that reloads it and a request id", () => {
    render(<>{loadErrorState({ error: failure(503, "SERVICE_UNAVAILABLE"), ...OPTIONS })}</>);

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load the services");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server said no. Try again in a moment.",
    );
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/app/settings/services",
    );
    expect(screen.getByText("req-42")).toBeInTheDocument();
  });

  it("explains an unreachable server in words that suggest checking the connection", () => {
    render(<>{loadErrorState({ error: failure(0, "NETWORK_ERROR"), ...OPTIONS })}</>);

    expect(screen.getByRole("alert")).toHaveTextContent("Check your connection and try again");
  });

  it("shows a rate limit as a retryable problem, not a crash", () => {
    render(<>{loadErrorState({ error: failure(429, "RATE_LIMITED"), ...OPTIONS })}</>);

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it.each([401, 403])(
    "renders nothing for %i: the area layout is the gate and shows the right screen itself",
    (status) => {
      const result = loadErrorState({ error: failure(status, "FORBIDDEN"), ...OPTIONS });

      expect(result).toBeNull();
    },
  );

  it.each([
    [404, "NOT_FOUND"],
    [422, "VALIDATION_ERROR"],
  ] as const)("rethrows a %i, for the not-found page or the error boundary", (status, code) => {
    const error = failure(status, code);

    expect(() => loadErrorState({ error, ...OPTIONS })).toThrow(error);
  });

  it("rethrows what is not an API error at all, so a bug is never hidden as a retry screen", () => {
    const bug = new TypeError("cannot read properties of undefined");

    expect(() => loadErrorState({ error: bug, ...OPTIONS })).toThrow(bug);
  });
});
