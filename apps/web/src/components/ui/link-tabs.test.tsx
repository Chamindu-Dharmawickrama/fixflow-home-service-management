import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LinkTabs } from "./link-tabs";

const ITEMS = [
  { label: "All", href: "/app/settings/services", count: 5, current: false },
  { label: "Published", href: "/app/settings/services?status=published", count: 3, current: true },
  { label: "Archived", href: "/app/settings/services?status=archived", count: 0, current: false },
] as const;

describe("LinkTabs", () => {
  it("is a named navigation landmark holding one link per tab", () => {
    render(<LinkTabs label="Filter services by status" items={ITEMS} />);

    const nav = screen.getByRole("navigation", { name: "Filter services by status" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/app/settings/services",
      "/app/settings/services?status=published",
      "/app/settings/services?status=archived",
    ]);
  });

  it("marks only the current tab, with aria-current rather than colour alone", () => {
    render(<LinkTabs label="Filter" items={ITEMS} />);

    expect(screen.getByRole("link", { name: /Published/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^All/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /Archived/ })).not.toHaveAttribute("aria-current");
  });

  it("shows how many records each tab holds, including zero", () => {
    render(<LinkTabs label="Filter" items={ITEMS} />);

    expect(screen.getByRole("link", { name: "All 5" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Published 3" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Archived 0" })).toBeInTheDocument();
  });

  it("leaves the count out when a tab has none", () => {
    render(
      <LinkTabs label="Filter" items={[{ label: "Everything", href: "/x", current: true }]} />,
    );

    expect(screen.getByRole("link", { name: "Everything" })).toBeInTheDocument();
  });
});
