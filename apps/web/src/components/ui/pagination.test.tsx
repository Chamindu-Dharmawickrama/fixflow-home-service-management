import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Pagination, type PaginationProps } from "./pagination";

function renderPagination(overrides: Partial<PaginationProps> = {}) {
  return render(
    <Pagination
      page={3}
      pageSize={20}
      totalItems={132}
      basePath="/app/requests"
      searchParams={{ status: "SUBMITTED", sort: "createdAt", order: "desc", page: "3" }}
      itemLabel="requests"
      {...overrides}
    />,
  );
}

const hrefOf = (name: string | RegExp) =>
  within(screen.getByRole("navigation", { name: "Pagination" }))
    .getByRole("link", { name })
    .getAttribute("href");

describe("Pagination", () => {
  it("summarises the range", () => {
    renderPagination();
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 41–60 of 132 requests");
  });

  it("builds page links that keep filters and sort, changing only the page", () => {
    renderPagination();
    expect(hrefOf("Go to next page")).toBe(
      "/app/requests?status=SUBMITTED&sort=createdAt&order=desc&page=4",
    );
    expect(hrefOf("Go to previous page")).toBe(
      "/app/requests?status=SUBMITTED&sort=createdAt&order=desc&page=2",
    );
    expect(hrefOf("Go to page 7")).toBe(
      "/app/requests?status=SUBMITTED&sort=createdAt&order=desc&page=7",
    );
  });

  it("leaves the page parameter out for page 1, so the first page has a clean URL", () => {
    renderPagination();
    expect(hrefOf("Go to page 1")).toBe("/app/requests?status=SUBMITTED&sort=createdAt&order=desc");

    renderPagination({ searchParams: {}, page: 2 });
    expect(
      screen.getAllByRole("link", { name: "Go to previous page" }).at(-1)?.getAttribute("href"),
    ).toBe("/app/requests");
  });

  it("marks the current page", () => {
    renderPagination();
    const current = screen.getByRole("link", { name: "Page 3, current page" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveTextContent("3");
    expect(screen.getAllByRole("link", { current: "page" })).toHaveLength(1);
  });

  it("shows ellipses for gaps in a long list", () => {
    renderPagination({ page: 10, totalItems: 400, searchParams: {} });
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(nav).toHaveTextContent("1…91011…20");
  });

  it("disables Previous on the first page and Next on the last, without linking them", () => {
    const { unmount } = renderPagination({ page: 1, searchParams: {} });
    expect(screen.queryByRole("link", { name: "Go to previous page" })).toBeNull();
    expect(screen.getByRole("link", { name: "Go to next page" })).toBeVisible();
    unmount();

    renderPagination({ page: 7, searchParams: {} });
    expect(screen.queryByRole("link", { name: "Go to next page" })).toBeNull();
    expect(screen.getByRole("link", { name: "Go to previous page" })).toBeVisible();
    expect(
      screen.getAllByText("Next").some((node) => node.closest("[aria-disabled='true']") !== null),
    ).toBe(true);
  });

  it("clamps a page beyond the end to the last page", () => {
    renderPagination({ page: 99, searchParams: {} });
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 121–132 of 132 requests");
    expect(screen.getByRole("link", { name: "Page 7, current page" })).toBeVisible();
  });

  it("renders nothing for an empty list", () => {
    const { container } = renderPagination({ totalItems: 0, page: 1 });
    expect(container).toBeEmptyDOMElement();
  });

  it("supports another page parameter name", () => {
    renderPagination({ pageParam: "p", searchParams: { p: "3" } });
    expect(hrefOf("Go to next page")).toBe("/app/requests?p=4");
  });

  it("gives phones a compact position instead of the numbered links", () => {
    renderPagination();
    expect(screen.getByText("Page 3 of 7")).toBeInTheDocument();
  });
});
