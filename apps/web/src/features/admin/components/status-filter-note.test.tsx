import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { joinLabels, StatusFilterNote } from "./status-filter-note";

describe("joinLabels", () => {
  it("reads the labels as a choice", () => {
    expect(joinLabels([])).toBe("");
    expect(joinLabels(["Overdue"])).toBe("Overdue");
    expect(joinLabels(["Issued", "Overdue"])).toBe("Issued or Overdue");
    expect(joinLabels(["Issued", "Partially paid", "Overdue"])).toBe(
      "Issued, Partially paid or Overdue",
    );
  });
});

describe("StatusFilterNote", () => {
  it("says in words which statuses the list is limited to, with the way out", () => {
    render(
      <StatusFilterNote
        noun="invoices"
        labels={["Issued", "Partially paid", "Overdue"]}
        clearHref="/app/invoices"
      />,
    );
    expect(screen.getByTestId("status-filter-note")).toHaveTextContent(
      "Showing invoices that are Issued, Partially paid or Overdue.",
    );
    expect(screen.getByRole("link", { name: "Show all invoices" })).toHaveAttribute(
      "href",
      "/app/invoices",
    );
  });

  it("draws nothing without a status filter", () => {
    const { container } = render(
      <StatusFilterNote noun="jobs" labels={[]} clearHref="/app/jobs" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
