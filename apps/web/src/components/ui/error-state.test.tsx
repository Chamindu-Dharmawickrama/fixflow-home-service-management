import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ErrorState } from "./error-state";

// Next's Link marks itself, so a test can tell a client navigation from a full page load.
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, children }: { href: string; children?: unknown }) =>
      createElement("a", { href, "data-client-navigation": "" }, children as never),
  };
});

describe("ErrorState's retry link", () => {
  it("is a client navigation by default, for a page's own data", () => {
    render(<ErrorState message="Something failed." retryHref="/app/invoices?page=2" />);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "data-client-navigation",
    );
  });

  it("is a full page load with `retryReloads`, for an error a layout drew (T25)", () => {
    render(<ErrorState message="Something failed." retryHref="/app/dashboard" retryReloads />);
    const retry = screen.getByRole("link", { name: "Try again" });
    expect(retry).toHaveAttribute("href", "/app/dashboard");
    expect(retry).not.toHaveAttribute("data-client-navigation");
  });
});
