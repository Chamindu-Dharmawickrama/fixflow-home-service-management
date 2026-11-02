import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpecialtyTags } from "./specialty-tags";

describe("SpecialtyTags", () => {
  it("lists the tags in the order given, named for a screen reader when it is told how", () => {
    render(<SpecialtyTags tags={["Air conditioning", "Heat pumps"]} label="Specialties" />);

    const list = screen.getByRole("list", { name: "Specialties" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Air conditioning", "Heat pumps"]);
  });

  it("lets a 40-character tag with no space shrink to its line and break anywhere", () => {
    const tag = "s".repeat(40);
    render(<SpecialtyTags tags={[tag]} />);

    const badge = screen.getByText(tag);
    // `break-words` alone keeps the longest word whole and widens the page.
    expect(badge).toHaveClass("[overflow-wrap:anywhere]", "max-w-full", "whitespace-normal");
    expect(badge).not.toHaveClass("shrink-0");
    expect(badge.closest("li")).toHaveClass("min-w-0", "max-w-full");
  });

  it("shows nothing for no tags (the caller says what is missing)", () => {
    const { container } = render(<SpecialtyTags tags={[]} />);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});
