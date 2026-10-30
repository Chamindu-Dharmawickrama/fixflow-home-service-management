import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CUSTOMER_ID, customerListItem } from "../test-fixtures";
import { CustomersTable } from "./customers-table";

const TZ = "America/New_York";

function renderTable(
  customers = [customerListItem()],
  sort: { field: string; order: "asc" | "desc" } = { field: "name", order: "asc" },
) {
  return render(
    <CustomersTable
      customers={customers}
      timeZone={TZ}
      sort={sort}
      getSortHref={(field) => `/app/customers?sort=${field}`}
    />,
  );
}

const rowOf = (index = 1) =>
  within(screen.getByRole("table", { name: "Customers" })).getAllByRole("row")[
    index
  ] as HTMLElement;

describe("CustomersTable", () => {
  it("has a column for each thing the list is scanned for", () => {
    renderTable();

    expect(
      within(screen.getByRole("table", { name: "Customers" }))
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Customer",
      "Contact",
      "City",
      "Requests",
      "Open jobs",
      "Outstanding",
      "Last activity",
    ]);
  });

  it("opens the customer from the name", () => {
    renderTable();

    expect(within(rowOf()).getByRole("link", { name: "Amara Okafor" })).toHaveAttribute(
      "href",
      `/app/customers/${CUSTOMER_ID}`,
    );
  });

  it("shows the email and the phone number, named for a screen reader, and the city", () => {
    renderTable();

    const row = within(rowOf());
    expect(row.getByText("amara.okafor@example.com")).toBeVisible();
    expect(row.getByText("(212) 555-0142")).toBeVisible();
    expect(row.getByText("Email:")).toBeInTheDocument();
    expect(row.getByText("Phone:")).toBeInTheDocument();
    expect(row.getByText("Harbor City")).toBeVisible();
  });

  it("says so when there is no phone number or no address, rather than leaving a gap", () => {
    renderTable([customerListItem({ phone: null, city: null })]);

    const row = within(rowOf());
    expect(row.getByText("No phone number")).toBeVisible();
    expect(row.getByText("No address saved")).toBeVisible();
  });

  it("counts requests and open jobs and shows the balance with its currency", () => {
    renderTable([customerListItem({ requestCount: 12, openJobCount: 2 })]);

    const cells = within(rowOf()).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("12");
    expect(cells[4]).toHaveTextContent("2");
    expect(cells[5]).toHaveTextContent("$175.50");
  });

  it("formats the balance in the customer's own currency, not the browser's", () => {
    renderTable([customerListItem({ outstandingBalance: "1284.50", currencyCode: "EUR" })]);

    expect(within(rowOf()).getAllByRole("cell")[5]).toHaveTextContent("€1,284.50");
  });

  it("shows a balance of nothing quietly and a balance owed firmly", () => {
    renderTable([
      customerListItem({ id: "a", name: "Owes Money", outstandingBalance: "50.00" }),
      customerListItem({ id: "b", name: "Owes Nothing", outstandingBalance: "0.00" }),
    ]);

    const owes = within(rowOf(1)).getByText("$50.00");
    const clear = within(rowOf(2)).getByText("$0.00");
    expect(owes).toHaveClass("font-semibold");
    expect(clear).not.toHaveClass("font-semibold");
  });

  it("shows the last activity in the business time zone", () => {
    renderTable([
      customerListItem({
        // 02:30 UTC on 31 October is still the evening of 30 October in New York.
        lastActivityAt: "2026-10-31T02:30:00.000Z",
      }),
    ]);

    expect(within(rowOf()).getAllByRole("cell")[6]).toHaveTextContent("Oct 30, 2026");
  });

  it("makes the name and last activity columns sortable, and says which is sorted", () => {
    renderTable([customerListItem()], { field: "lastActivityAt", order: "desc" });

    const headers = within(screen.getByRole("table", { name: "Customers" })).getAllByRole(
      "columnheader",
    );
    const byName = (name: string) => headers.find((header) => header.textContent === name);
    expect(byName("Customer")).toHaveAttribute("aria-sort", "none");
    expect(byName("Last activity")).toHaveAttribute("aria-sort", "descending");
    expect(byName("Contact")).not.toHaveAttribute("aria-sort");
    expect(within(byName("Last activity") as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "/app/customers?sort=lastActivityAt",
    );
  });

  it("lists every customer it is given", () => {
    renderTable([
      customerListItem({ id: "a", name: "First Person" }),
      customerListItem({ id: "b", name: "Second Person" }),
      customerListItem({ id: "c", name: "Third Person" }),
    ]);

    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
    expect(screen.getByRole("list", { name: "Customers" })).toBeInTheDocument();
  });
});
