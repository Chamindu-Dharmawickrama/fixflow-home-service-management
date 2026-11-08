import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JOB_ID, jobListItem, TECHNICIAN_ID } from "../test-fixtures";
import { JobsEmpty } from "./jobs-empty";
import { JobsTable } from "./jobs-table";

// The Ready to invoice tab has a button in each row (T20), and a button navigates.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const NEW_YORK = "America/New_York";

function renderTable(
  jobs = [jobListItem()],
  sort: { field: string; order: "asc" | "desc" } = { field: "createdAt", order: "asc" },
) {
  render(
    <JobsTable
      jobs={jobs}
      timeZone={NEW_YORK}
      view="all"
      sort={sort}
      getSortHref={(field) => `/app/jobs?sort=${field}`}
    />,
  );
}

describe("JobsTable", () => {
  it("shows a job's reference, status, customer, service, appointment and technician", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Jobs" });
    const row = within(table).getAllByRole("row")[1] as HTMLElement;

    expect(within(row).getByRole("link", { name: "JOB-2026-00007" })).toHaveAttribute(
      "href",
      `/app/jobs/${JOB_ID}`,
    );
    expect(within(row).getByText("Scheduled")).toBeVisible();
    expect(within(row).getByText("Amara Okafor")).toBeVisible();
    expect(within(row).getByText("Harbor City")).toBeVisible();
    expect(within(row).getByText("AC Repair")).toBeVisible();
    expect(within(row).getByText("Jordan Lee")).toBeVisible();
  });

  it("writes the appointment on the business's clocks, with the zone's name", () => {
    renderTable();
    const row = within(screen.getByRole("table", { name: "Jobs" })).getAllByRole("row")[1];

    // 15:00 to 17:00 UTC on 3 March is 10:00 AM to 12:00 PM in New York (EST).
    expect(row).toHaveTextContent("Mar 3, 2026");
    expect(row).toHaveTextContent("10:00 AM – 12:00 PM EST");
  });

  it("shows the date an evening visit happens on in New York, not in UTC", () => {
    renderTable([
      jobListItem({
        scheduledStart: "2026-03-04T02:30:00.000Z",
        scheduledEnd: "2026-03-04T03:30:00.000Z",
      }),
    ]);
    const row = within(screen.getByRole("table", { name: "Jobs" })).getAllByRole("row")[1];

    expect(row).toHaveTextContent("Mar 3, 2026");
    expect(row).toHaveTextContent("9:30 – 10:30 PM EST");
  });

  it("says plainly that a job has no appointment or technician yet", () => {
    renderTable([
      jobListItem({
        status: "PENDING_SCHEDULING",
        statusLabel: "Pending scheduling",
        scheduledStart: null,
        scheduledEnd: null,
        technician: null,
      }),
    ]);
    const row = within(screen.getByRole("table", { name: "Jobs" })).getAllByRole("row")[1];

    expect(row).toHaveTextContent("Not scheduled yet");
    expect(row).toHaveTextContent("Unassigned");
    expect(within(row as HTMLElement).getByText("Pending scheduling")).toBeVisible();
  });

  it("makes status, appointment and creation date sortable, and the rest not", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Jobs" });
    const sortable = within(table)
      .getAllByRole("columnheader")
      .filter((header) => within(header).queryByRole("link") !== null)
      .map((header) => header.textContent?.trim());

    expect(sortable).toEqual(["Status", "Scheduled", "Created"]);
    expect(within(table).getByRole("link", { name: /Scheduled/ })).toHaveAttribute(
      "href",
      "/app/jobs?sort=scheduledStart",
    );
  });

  it("marks the column the list is sorted by", () => {
    renderTable([jobListItem()], { field: "scheduledStart", order: "desc" });
    const header = within(screen.getByRole("table", { name: "Jobs" })).getByRole("columnheader", {
      name: /Scheduled/,
    });
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("is also a list of cards for narrow screens, with the same links", () => {
    renderTable([jobListItem(), jobListItem({ id: TECHNICIAN_ID, reference: "JOB-2026-00008" })]);
    const cards = screen.getByRole("list", { name: "Jobs" });

    expect(within(cards).getAllByRole("listitem")).toHaveLength(2);
    expect(within(cards).getByRole("link", { name: "JOB-2026-00008" })).toHaveAttribute(
      "href",
      `/app/jobs/${TECHNICIAN_ID}`,
    );
  });

  it("keeps a long name from widening the row", () => {
    const long = "N".repeat(100);
    renderTable([
      jobListItem({
        customerName: long,
        technician: { id: TECHNICIAN_ID, name: long, calendarColor: "rose" },
      }),
    ]);
    const table = screen.getByRole("table", { name: "Jobs" });
    expect(within(table).getAllByText(long).length).toBeGreaterThan(0);
    for (const element of within(table).getAllByText(long)) {
      expect(element.className).toMatch(/overflow-wrap:anywhere/);
    }
  });
});

describe("JobsEmpty", () => {
  const base = {
    filtered: false,
    pastLastPage: false,
    firstPageHref: "/app/jobs?view=upcoming",
    clearFiltersHref: "/app/jobs?view=upcoming",
  } as const;

  it("tells a page past the end to go back to the first", () => {
    render(<JobsEmpty {...base} view="upcoming" pastLastPage />);
    expect(screen.getByRole("heading", { name: "There is nothing on this page" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to the first page" })).toHaveAttribute(
      "href",
      "/app/jobs?view=upcoming",
    );
  });

  it("says no job matches a search, and offers to clear it", () => {
    render(<JobsEmpty {...base} view="all" filtered />);
    expect(screen.getByRole("heading", { name: "No jobs match" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Clear search and filters" })).toHaveAttribute(
      "href",
      "/app/jobs?view=upcoming",
    );
  });

  it("prefers 'past the last page' to 'no match' when there are jobs but not on this page", () => {
    render(<JobsEmpty {...base} view="all" filtered pastLastPage />);
    expect(screen.getByRole("heading", { name: "There is nothing on this page" })).toBeVisible();
  });

  it.each([
    [
      "needs-scheduling",
      "Nothing is waiting for a time",
      "See upcoming jobs",
      "/app/jobs?view=upcoming",
    ],
    ["upcoming", "No upcoming visits", "See jobs that need scheduling", "/app/jobs"],
    ["in-progress", "No jobs in progress", null, null],
    [
      "ready-to-invoice",
      "Nothing is waiting to be invoiced",
      "See jobs in progress",
      "/app/jobs?view=in-progress",
    ],
    ["completed", "No completed jobs yet", null, null],
    ["all", "No jobs yet", "Go to the requests", "/app/requests"],
  ] as const)("explains an empty %s tab and what to do next", (view, title, link, href) => {
    render(<JobsEmpty {...base} view={view} />);

    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    if (link === null) {
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    } else {
      expect(screen.getByRole("link", { name: link })).toHaveAttribute("href", href);
    }
  });

  it("does not offer to create an invoice from the empty Ready to invoice tab: that arrives with invoices", () => {
    render(<JobsEmpty {...base} view="ready-to-invoice" />);
    expect(screen.queryByRole("link", { name: /invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invoice/i })).not.toBeInTheDocument();
  });

  it("never suggests creating a job from the empty list: a job is made from an accepted quotation", () => {
    render(<JobsEmpty {...base} view="all" />);
    expect(screen.queryByRole("button", { name: /create job/i })).not.toBeInTheDocument();
    expect(screen.getByText(/accepted/)).toBeVisible();
  });
});

describe("JobsTable: the Ready to invoice tab offers the next step (T20)", () => {
  function renderFor(view: "ready-to-invoice" | "completed" | "all") {
    render(
      <JobsTable
        jobs={[jobListItem({ status: "COMPLETED", statusLabel: "Completed" })]}
        timeZone={NEW_YORK}
        view={view}
        sort={{ field: "completedAt", order: "asc" }}
        getSortHref={(field) => `/app/jobs?sort=${field}`}
      />,
    );
  }

  it("puts a Create invoice button in each row, named for its job", () => {
    renderFor("ready-to-invoice");
    const table = screen.getByRole("table", { name: "Jobs" });
    expect(
      within(table).getByRole("button", { name: "Create invoice for JOB-2026-00007" }),
    ).toBeEnabled();
    expect(within(table).getByRole("columnheader", { name: "Invoice" })).toBeVisible();
  });

  it.each(["completed", "all"] as const)("has no such button on the %s tab", (view) => {
    renderFor(view);
    expect(screen.queryByRole("button", { name: /create invoice/i })).not.toBeInTheDocument();
  });
});

describe("JobsTable: finished work and old appointments (T18)", () => {
  function renderFor(
    view: "ready-to-invoice" | "completed" | "all" | "upcoming",
    jobs = [jobListItem()],
  ) {
    render(
      <JobsTable
        jobs={jobs}
        timeZone={NEW_YORK}
        view={view}
        sort={{ field: "completedAt", order: "asc" }}
        getSortHref={(field) => `/app/jobs?sort=${field}`}
      />,
    );
  }

  it.each(["ready-to-invoice", "completed"] as const)(
    "adds a sortable 'Completed' column on the %s tab",
    (view) => {
      renderFor(view, [
        jobListItem({
          status: "COMPLETED",
          statusLabel: "Completed",
          // A day of its own, so the cell cannot be mistaken for the appointment's.
          completedAt: "2026-03-04T16:40:00.000Z",
        }),
      ]);
      const header = screen.getByRole("columnheader", { name: /Completed/ });
      expect(within(header).getByRole("link")).toHaveAttribute(
        "href",
        "/app/jobs?sort=completedAt",
      );
      const row = within(screen.getByRole("table")).getAllByRole("row")[1] as HTMLElement;
      expect(within(row).getByText("Mar 4, 2026", { selector: "time" })).toBeVisible();
    },
  );

  it.each(["upcoming", "all"] as const)("has no 'Completed' column on the %s tab", (view) => {
    renderFor(view);
    expect(screen.queryByRole("columnheader", { name: /Completed/ })).not.toBeInTheDocument();
  });

  it("labels the old appointment of a job that needs a new time or was cancelled", () => {
    renderFor("all", [
      jobListItem({ status: "NEEDS_RESCHEDULING", statusLabel: "Needs rescheduling" }),
      jobListItem({
        id: "second",
        reference: "JOB-2026-00008",
        status: "CANCELLED",
        statusLabel: "Cancelled",
      }),
      jobListItem({ id: "third", reference: "JOB-2026-00009" }),
    ]);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);

    expect(within(rows[0] as HTMLElement).getByText("Previously scheduled")).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText("Previously scheduled")).toBeVisible();
    expect(
      within(rows[2] as HTMLElement).queryByText("Previously scheduled"),
    ).not.toBeInTheDocument();
  });
});
