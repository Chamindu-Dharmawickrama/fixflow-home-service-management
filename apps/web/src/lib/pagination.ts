export type PaginationItem = number | "ellipsis-start" | "ellipsis-end";

/**
 * The page links to show: always the first and last page, the current page and its neighbours,
 * and an ellipsis for each gap. `getPaginationItems(6, 20)` → `1 … 5 6 7 … 20`. Gaps of a single
 * page are shown as the page itself instead of an ellipsis, so the row never hides just one number.
 */
export function getPaginationItems(
  page: number,
  totalPages: number,
  siblings = 1,
): PaginationItem[] {
  if (totalPages <= 1) {
    return totalPages === 1 ? [1] : [];
  }

  const current = Math.min(Math.max(1, Math.trunc(page)), totalPages);
  const start = Math.max(2, current - siblings);
  const end = Math.min(totalPages - 1, current + siblings);

  const items: PaginationItem[] = [1];

  if (start > 3) {
    items.push("ellipsis-start");
  } else if (start === 3) {
    items.push(2);
  }

  for (let value = start; value <= end; value += 1) {
    items.push(value);
  }

  if (end < totalPages - 2) {
    items.push("ellipsis-end");
  } else if (end === totalPages - 2) {
    items.push(totalPages - 1);
  }

  items.push(totalPages);
  return items;
}

export interface PageRange {
  /** 1-based index of the first item on the page; `0` when there are no items. */
  from: number;
  to: number;
  totalPages: number;
  /** The requested page limited to the pages that exist. */
  page: number;
}

/** "Showing 21–40 of 132" numbers for a page of a list. */
export function getPageRange(page: number, pageSize: number, totalItems: number): PageRange {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  const current = totalPages === 0 ? 1 : Math.min(Math.max(1, Math.trunc(page)), totalPages);
  if (totalItems === 0) {
    return { from: 0, to: 0, totalPages, page: current };
  }
  const from = (current - 1) * pageSize + 1;
  return { from, to: Math.min(current * pageSize, totalItems), totalPages, page: current };
}
