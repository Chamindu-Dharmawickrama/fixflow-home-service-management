import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  adminJob,
  cancelledJob,
  completedJob,
  needsReschedulingJob,
  startedJob,
  unscheduledJob,
} from "../test-fixtures";
import { JobProgress } from "./job-progress";

function steps() {
  const list = within(screen.getByRole("navigation", { name: "Job progress" })).getByRole("list");
  return within(list).getAllByRole("listitem");
}

describe("JobProgress", () => {
  it("is a named list of the four steps, in order", () => {
    render(<JobProgress job={unscheduledJob()} />);

    expect(steps().map((step) => step.textContent)).toEqual([
      expect.stringContaining("Pending scheduling"),
      expect.stringContaining("Scheduled"),
      expect.stringContaining("In progress"),
      expect.stringContaining("Completed"),
    ]);
  });

  it("says each step's state in words, not only in colour", () => {
    render(<JobProgress job={startedJob()} />);
    const [pending, scheduled, inProgress, completed] = steps();

    expect(pending).toHaveTextContent("done");
    expect(scheduled).toHaveTextContent("done");
    expect(inProgress).toHaveTextContent("current step");
    expect(completed).toHaveTextContent("not reached");
  });

  it("marks only the current step with aria-current", () => {
    render(<JobProgress job={adminJob()} />);
    const current = steps().filter((step) => step.getAttribute("aria-current") === "step");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Scheduled");
  });

  it("shows a finished job as having reached the end", () => {
    render(<JobProgress job={completedJob()} />);
    const list = steps();
    expect(list[3]).toHaveAttribute("aria-current", "step");
    expect(list[0]).toHaveTextContent("done");
    expect(screen.queryByText("This job left the usual path:")).not.toBeInTheDocument();
  });

  it("shows the way out for a job that needs a new time", () => {
    render(<JobProgress job={needsReschedulingJob()} />);

    expect(screen.getByText("This job left the usual path:")).toBeVisible();
    expect(
      within(screen.getByRole("navigation", { name: "Job progress" })).getByText(
        "Needs rescheduling",
      ),
    ).toBeVisible();
    expect(steps().some((step) => step.hasAttribute("aria-current"))).toBe(false);
  });

  it("shows the way out for a cancelled job", () => {
    render(<JobProgress job={cancelledJob()} />);
    expect(screen.getByText("This job left the usual path:")).toBeVisible();
    expect(
      within(screen.getByRole("navigation", { name: "Job progress" })).getByText("Cancelled"),
    ).toBeVisible();
  });
});
