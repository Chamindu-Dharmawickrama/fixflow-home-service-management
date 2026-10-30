import type { RequestStatusCounts } from "@fixflow/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RequestStatusChips } from "./request-status-chips";

const COUNTS: RequestStatusCounts = {
  SUBMITTED: 3,
  UNDER_REVIEW: 2,
  QUOTED: 0,
  ACCEPTED: 1,
  DECLINED: 0,
  CONVERTED_TO_JOB: 4,
  CANCELLED: 5,
};

function query(href: string | null): URLSearchParams {
  return new URL(href ?? "", "http://localhost").searchParams;
}

function chip(name: string): HTMLAnchorElement {
  return screen.getByRole<HTMLAnchorElement>("link", { name });
}

describe("RequestStatusChips", () => {
  it("offers All and one chip for each status, in the order of the workflow, each with its count", () => {
    render(<RequestStatusChips selected={[]} counts={COUNTS} total={15} params={{}} />);

    const nav = screen.getByRole("navigation", { name: "Filter requests by status" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "All 15",
      "Submitted 3",
      "Under review 2",
      "Quoted 0",
      "Accepted 1",
      "Declined 0",
      "Converted to job 4",
      "Cancelled 5",
    ]);
  });

  it("marks All as the current filter when no status is chosen", () => {
    render(<RequestStatusChips selected={[]} counts={COUNTS} total={15} params={{}} />);

    expect(chip("All 15")).toHaveAttribute("aria-current", "true");
    expect(chip("Submitted 3")).not.toHaveAttribute("aria-current");
  });

  it("marks every chosen status, in words for assistive technology and not by colour alone", () => {
    render(
      <RequestStatusChips
        selected={["SUBMITTED", "UNDER_REVIEW"]}
        counts={COUNTS}
        total={15}
        params={{ status: "SUBMITTED,UNDER_REVIEW" }}
      />,
    );

    expect(chip("Submitted 3")).toHaveAttribute("aria-current", "true");
    expect(chip("Under review 2")).toHaveAttribute("aria-current", "true");
    expect(chip("Quoted 0")).not.toHaveAttribute("aria-current");
    expect(chip("All 15")).not.toHaveAttribute("aria-current");
  });

  it("adds a status to the filter when its chip is pressed, and goes back to page 1", () => {
    render(
      <RequestStatusChips
        selected={["QUOTED"]}
        counts={COUNTS}
        total={15}
        params={{ status: "QUOTED", q: "okafor", page: "3" }}
      />,
    );

    const params = query(chip("Submitted 3").getAttribute("href"));
    expect(params.get("status")).toBe("SUBMITTED,QUOTED");
    expect(params.get("q")).toBe("okafor");
    expect(params.has("page")).toBe(false);
  });

  it("takes a status out of the filter when its selected chip is pressed", () => {
    render(
      <RequestStatusChips
        selected={["SUBMITTED", "QUOTED"]}
        counts={COUNTS}
        total={15}
        params={{ status: "SUBMITTED,QUOTED" }}
      />,
    );

    expect(query(chip("Submitted 3").getAttribute("href")).get("status")).toBe("QUOTED");
  });

  it("clears the status filter, and only that, with All", () => {
    render(
      <RequestStatusChips
        selected={["CANCELLED"]}
        counts={COUNTS}
        total={15}
        params={{ status: "CANCELLED", q: "okafor", sort: "reference", order: "asc" }}
      />,
    );

    const params = query(chip("All 15").getAttribute("href"));
    expect(params.has("status")).toBe(false);
    expect(params.get("q")).toBe("okafor");
    expect(params.get("sort")).toBe("reference");
  });

  it("shows a status with no requests as a chip with a zero, so the layout does not jump", () => {
    render(<RequestStatusChips selected={[]} counts={COUNTS} total={15} params={{}} />);

    expect(chip("Quoted 0")).toBeVisible();
  });
});
