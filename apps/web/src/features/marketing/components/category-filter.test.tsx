import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CategoryFilter } from "./category-filter";

const CATEGORIES = [
  { label: "Air conditioning", count: 2 },
  { label: "Appliance repair", count: 1 },
  { label: "Cleaning", count: 1 },
];

function setup(selected: string | undefined) {
  render(<CategoryFilter categories={CATEGORIES} total={4} selected={selected} />);
  return within(screen.getByRole("navigation", { name: "Filter services by category" }));
}

describe("CategoryFilter", () => {
  it("is a labelled navigation of real links, one per category and one for all", () => {
    const filter = setup(undefined);

    expect(filter.getAllByRole("link")).toHaveLength(4);
    expect(filter.getByRole("link", { name: /^All/ })).toHaveAttribute("href", "/services");
    expect(filter.getByRole("link", { name: /^Air conditioning/ })).toHaveAttribute(
      "href",
      "/services?category=Air%20conditioning",
    );
  });

  it("shows how many services each choice leads to", () => {
    const filter = setup(undefined);

    expect(filter.getByRole("link", { name: "All (4)" })).toBeInTheDocument();
    expect(filter.getByRole("link", { name: "Air conditioning (2)" })).toBeInTheDocument();
  });

  it("marks All as current when nothing is chosen, and no other link", () => {
    const filter = setup(undefined);

    expect(filter.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "true");
    expect(filter.getByRole("link", { name: /^Cleaning/ })).not.toHaveAttribute("aria-current");
  });

  it("marks the chosen category as current, by more than colour, and not All", () => {
    const filter = setup("Cleaning");

    expect(filter.getByRole("link", { name: /^Cleaning/ })).toHaveAttribute("aria-current", "true");
    expect(filter.getByRole("link", { name: /^All/ })).not.toHaveAttribute("aria-current");
  });

  it("matches the chosen category without regard to case", () => {
    const filter = setup("air CONDITIONING");

    expect(filter.getByRole("link", { name: /^Air conditioning/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("falls back to All when the URL names a category that does not exist", () => {
    const filter = setup("Roof repair");

    expect(filter.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "true");
  });
});
