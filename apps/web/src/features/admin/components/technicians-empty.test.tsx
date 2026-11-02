import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TechniciansEmpty, type TechniciansEmptyProps } from "./technicians-empty";

const BASE: TechniciansEmptyProps = {
  searching: false,
  active: "true",
  counts: { all: 3, active: 2, inactive: 1 },
  pastLastPage: false,
  firstPageHref: "/app/technicians",
  clearSearchHref: "/app/technicians",
  addTechnician: <button type="button">Add technician</button>,
};

function renderEmpty(overrides: Partial<TechniciansEmptyProps> = {}) {
  return render(<TechniciansEmpty {...BASE} {...overrides} />);
}

describe("TechniciansEmpty", () => {
  it("says nobody matches a search and offers to clear it, keeping the tab", () => {
    renderEmpty({
      searching: true,
      active: "false",
      clearSearchHref: "/app/technicians?active=false",
    });

    expect(screen.getByRole("heading", { level: 2, name: "No technicians match" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Clear search" })).toHaveAttribute(
      "href",
      "/app/technicians?active=false",
    );
    // A search with no result is not the moment to ask for a new technician.
    expect(screen.queryByRole("button", { name: "Add technician" })).not.toBeInTheDocument();
  });

  it("guides the first technician, with the way to add one", () => {
    renderEmpty({ counts: { all: 0, active: 0, inactive: 0 } });

    expect(screen.getByRole("heading", { level: 2, name: "No technicians yet" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add technician" })).toBeVisible();
  });

  it("says no technician is inactive, on the Inactive tab, and offers the active ones", () => {
    renderEmpty({ active: "false", counts: { all: 3, active: 3, inactive: 0 } });

    expect(screen.getByRole("heading", { name: "No inactive technicians" })).toBeVisible();
    expect(screen.getByText(/Their jobs stay assigned and you can reactivate them/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Show active technicians" })).toHaveAttribute(
      "href",
      "/app/technicians",
    );
  });

  it("says nobody can be given a job when everyone is inactive, and offers both ways out", () => {
    renderEmpty({ active: "true", counts: { all: 2, active: 0, inactive: 2 } });

    expect(screen.getByRole("heading", { name: "No active technicians" })).toBeVisible();
    expect(screen.getByText(/nobody can be given a new job/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Show inactive technicians" })).toHaveAttribute(
      "href",
      "/app/technicians?active=false",
    );
    expect(screen.getByRole("button", { name: "Add technician" })).toBeVisible();
  });

  it("does not claim the list is empty when the page asked for is past the last one", () => {
    renderEmpty({
      pastLastPage: true,
      // Everyone is inactive is what the counts would otherwise say: it must not be said here.
      counts: { all: 2, active: 0, inactive: 2 },
      firstPageHref: "/app/technicians?active=all",
    });

    expect(screen.getByRole("heading", { name: "There is nothing on this page" })).toBeVisible();
    expect(screen.queryByText(/Everyone is inactive/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the first page" })).toHaveAttribute(
      "href",
      "/app/technicians?active=all",
    );
  });

  it("puts the page-past-the-end message ahead of the search one", () => {
    renderEmpty({ pastLastPage: true, searching: true });
    expect(screen.getByRole("heading", { name: "There is nothing on this page" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "No technicians match" })).not.toBeInTheDocument();
  });
});
