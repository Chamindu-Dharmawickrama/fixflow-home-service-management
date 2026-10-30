import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { listItem, REQUEST_ID } from "../test-fixtures";
import { RequestsQueueTable } from "./requests-queue-table";

const TZ = "America/New_York";

function renderTable(
  requests = [listItem()],
  sort: { field: string; order: "asc" | "desc" } = { field: "submittedAt", order: "desc" },
) {
  return render(
    <RequestsQueueTable
      requests={requests}
      timeZone={TZ}
      sort={sort}
      getSortHref={(field) => `/app/requests?sort=${field}`}
    />,
  );
}

describe("RequestsQueueTable", () => {
  it("has a column for what the business needs to scan for", () => {
    renderTable();

    const table = screen.getByRole("table", { name: "Service requests" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Reference",
      "Customer",
      "Service",
      "Status",
      "Preferred time",
      "Submitted",
      "Updated",
    ]);
  });

  it("shows one request: reference as the link to it, customer with city, service, status, times", () => {
    renderTable();

    const row = within(screen.getByRole("table")).getAllByRole("row")[1] as HTMLElement;
    expect(within(row).getByRole("link", { name: /FF-2026-00012/ })).toHaveAttribute(
      "href",
      `/app/requests/${REQUEST_ID}`,
    );
    expect(within(row).getByText("Amara Okafor")).toBeVisible();
    expect(within(row).getByText("Harbor City")).toBeVisible();
    expect(within(row).getByText("AC Repair")).toBeVisible();
    expect(within(row).getByText("Submitted", { selector: "span" })).toBeVisible();
    expect(within(row).getByText("Nov 10, 2026")).toBeVisible();
    expect(within(row).getByText("Morning")).toBeVisible();
    expect(within(row).getAllByText("Oct 30, 2026")).toHaveLength(2);
  });

  it("marks a request waiting for its first look as New, and no other", () => {
    renderTable([
      listItem(),
      listItem({
        id: "1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22",
        reference: "FF-2026-00011",
        status: "UNDER_REVIEW",
        statusLabel: "Under review",
        isNew: false,
      }),
    ]);

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(rows[1] as HTMLElement).getByText("New")).toBeVisible();
    expect(within(rows[2] as HTMLElement).queryByText("New")).not.toBeInTheDocument();
  });

  it("dates the submission on the business's calendar, not UTC's", () => {
    // 03:30 UTC on 31 October is 23:30 on 30 October in New York.
    renderTable([
      listItem({ submittedAt: "2026-10-31T03:30:00.000Z", updatedAt: "2026-10-31T03:30:00.000Z" }),
    ]);

    const row = within(screen.getByRole("table")).getAllByRole("row")[1] as HTMLElement;
    expect(within(row).getAllByText("Oct 30, 2026")).toHaveLength(2);
  });

  it("makes the sortable headers links, marks the sorted one, and leaves the rest as text", () => {
    renderTable([listItem()], { field: "status", order: "asc" });

    const headers = screen.getAllByRole("columnheader");
    const byName = (name: string) => headers.find((header) => header.textContent === name);
    expect(byName("Status")).toHaveAttribute("aria-sort", "ascending");
    expect(byName("Submitted")).toHaveAttribute("aria-sort", "none");
    expect(within(byName("Reference") as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "/app/requests?sort=reference",
    );
    for (const name of ["Customer", "Service", "Preferred time"]) {
      expect(within(byName(name) as HTMLElement).queryByRole("link")).toBeNull();
      expect(byName(name)).not.toHaveAttribute("aria-sort");
    }
  });

  it("also renders cards for narrow screens, with the same links", () => {
    renderTable();

    const cards = screen.getByRole("list", { name: "Service requests" });
    expect(within(cards).getByRole("link", { name: /FF-2026-00012/ })).toHaveAttribute(
      "href",
      `/app/requests/${REQUEST_ID}`,
    );
    expect(within(cards).getByText("Amara Okafor")).toBeVisible();
  });
});
