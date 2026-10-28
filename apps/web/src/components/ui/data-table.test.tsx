import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataTable, type DataTableColumn } from "./data-table";

interface Row {
  id: string;
  reference: string;
  customer: string;
  total: string;
}

const ROWS: Row[] = [
  { id: "1", reference: "FF-2026-00125", customer: "Morgan Reyes", total: "$1,284.50" },
  { id: "2", reference: "FF-2026-00124", customer: "Priya Shah", total: "$189.00" },
];

const COLUMNS: DataTableColumn<Row>[] = [
  {
    id: "reference",
    header: "Reference",
    primary: true,
    sortable: true,
    cell: (row) => row.reference,
  },
  { id: "customer", header: "Customer", sortable: true, cell: (row) => row.customer },
  { id: "internal", header: "Internal id", hideOnCard: true, cell: (row) => `id-${row.id}` },
  { id: "total", header: "Total", align: "right", cell: (row) => row.total },
];

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable
      caption="Service requests"
      columns={COLUMNS}
      rows={ROWS}
      getRowId={(row) => row.id}
      {...props}
    />,
  );
}

describe("DataTable", () => {
  it("is a real table with an accessible name and column headers", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Service requests", hidden: true });
    const headers = within(table).getAllByRole("columnheader", { hidden: true });
    expect(headers.map((header) => header.textContent)).toEqual([
      "Reference",
      "Customer",
      "Internal id",
      "Total",
    ]);
    for (const header of headers) {
      expect(header).toHaveAttribute("scope", "col");
    }
    expect(within(table).getAllByRole("row", { hidden: true })).toHaveLength(3);
  });

  it("renders the same rows as stacked cards for narrow screens", () => {
    renderTable();
    const cards = screen.getByRole("list", { name: "Service requests", hidden: true });
    const items = within(cards).getAllByRole("listitem", { hidden: true });

    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("FF-2026-00125");
    expect(items[0]).toHaveTextContent("Customer");
    expect(items[0]).toHaveTextContent("Morgan Reyes");
    expect(items[0]).toHaveTextContent("$1,284.50");
  });

  it("leaves columns marked hideOnCard out of the cards", () => {
    renderTable();
    const cards = screen.getByRole("list", { name: "Service requests", hidden: true });
    expect(cards).not.toHaveTextContent("Internal id");
    expect(cards).not.toHaveTextContent("id-1");
  });

  it("switches between table and cards at the chosen breakpoint", () => {
    const { container, rerender } = renderTable();
    const table = container.querySelector("table")?.parentElement;
    const cards = container.querySelector("ul");
    expect(table?.className).toContain("hidden md:block");
    expect(cards?.className).toContain("md:hidden");

    rerender(
      <DataTable
        caption="Service requests"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        breakpoint="lg"
      />,
    );
    expect(container.querySelector("table")?.parentElement?.className).toContain("hidden lg:block");
    expect(container.querySelector("ul")?.className).toContain("lg:hidden");
  });

  describe("row links", () => {
    it("puts one real link in the primary cell of each row, in both layouts", () => {
      renderTable({ rowHref: (row) => `/app/requests/${row.id}` });

      const links = screen.getAllByRole("link", { hidden: true });
      // one per row in the table, one per row in the cards
      expect(links).toHaveLength(4);
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        "/app/requests/1",
        "/app/requests/2",
        "/app/requests/1",
        "/app/requests/2",
      ]);
      expect(links[0]).toHaveAccessibleName("FF-2026-00125");
    });

    it("stretches the link over the whole row", () => {
      renderTable({ rowHref: (row) => `/app/requests/${row.id}` });
      const link = screen.getAllByRole("link", { hidden: true })[0];
      expect(link?.className).toContain("after:absolute");
      expect(link?.className).toContain("after:inset-0");
      expect(link?.closest("tr")?.className).toContain("relative");
    });

    it("has no links without rowHref", () => {
      renderTable();
      expect(screen.queryAllByRole("link", { hidden: true })).toHaveLength(0);
    });
  });

  describe("sorting", () => {
    it("exposes the sort state with aria-sort and links sortable headers to the next sort", () => {
      renderTable({
        sort: { field: "customer", order: "asc" },
        getSortHref: (field) => `/app/requests?sort=${field}`,
      });
      const headers = screen.getAllByRole("columnheader", { hidden: true });

      expect(headers[0]).toHaveAttribute("aria-sort", "none");
      expect(headers[1]).toHaveAttribute("aria-sort", "ascending");
      expect(headers[2]).not.toHaveAttribute("aria-sort");
      expect(headers[3]).not.toHaveAttribute("aria-sort");

      expect(within(headers[0] as HTMLElement).getByRole("link", { hidden: true })).toHaveAttribute(
        "href",
        "/app/requests?sort=reference",
      );
      expect(within(headers[2] as HTMLElement).queryByRole("link", { hidden: true })).toBeNull();
    });

    it("reports descending order", () => {
      renderTable({
        sort: { field: "reference", order: "desc" },
        getSortHref: (field) => `?sort=${field}`,
      });
      expect(screen.getAllByRole("columnheader", { hidden: true })[0]).toHaveAttribute(
        "aria-sort",
        "descending",
      );
    });
  });

  it("right-aligns numeric columns", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader", { hidden: true });
    expect(headers[3]?.className).toContain("text-right");
    const cell = screen.getAllByText("$1,284.50")[0]?.closest("td");
    expect(cell?.className).toContain("text-right");
    expect(cell?.className).toContain("tabular-nums");
  });
});
