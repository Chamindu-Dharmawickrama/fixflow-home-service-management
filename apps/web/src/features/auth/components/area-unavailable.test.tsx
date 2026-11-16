import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AreaUnavailablePage } from "./area-unavailable";

// Next's Link marks itself, so a test can tell a client navigation from a full page load (in jsdom a
// Link without a router does not intercept the click, so the click alone cannot show it).
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, children }: { href: string; children?: unknown }) =>
      createElement("a", { href, "data-client-navigation": "" }, children as never),
  };
});

describe("AreaUnavailablePage", () => {
  it("says the server is not answering, why that may be, and offers a retry of the same page", () => {
    render(<AreaUnavailablePage retryHref="/app/requests?status=SUBMITTED" requestId="req-9" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "FixFlow is not available" }),
    ).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("We can't reach FixFlow right now");
    expect(alert).toHaveTextContent("starting up");
    expect(alert).toHaveTextContent("req-9");
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/app/requests?status=SUBMITTED",
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("retries with a full page load: the gate is a layout, which a client navigation would not render again", () => {
    render(<AreaUnavailablePage retryHref="/portal" />);

    const retry = screen.getByRole("link", { name: "Try again" });
    expect(retry).toHaveAttribute("href", "/portal");
    expect(retry).not.toHaveAttribute("data-client-navigation");
  });
});
