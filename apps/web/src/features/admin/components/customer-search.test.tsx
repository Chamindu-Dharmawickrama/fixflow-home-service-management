import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerSearch, type CustomerSearchProps, SEARCH_DEBOUNCE_MS } from "./customer-search";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const DEFAULTS: CustomerSearchProps = {
  q: undefined,
  sort: "name",
  order: "asc",
  canClear: false,
};

function setup(props: Partial<CustomerSearchProps> = {}) {
  const view = render(<CustomerSearch {...DEFAULTS} {...props} />);
  const rerender = (next: Partial<CustomerSearchProps>) =>
    view.rerender(<CustomerSearch {...DEFAULTS} {...props} {...next} />);
  return { rerender };
}

/** The address the list was last sent to, as readable parameters. */
function lastAddress(): { path: string; params: URLSearchParams } {
  const href = replace.mock.calls.at(-1)?.[0] as string;
  const [path = "", query = ""] = href.split("?");
  return { path, params: new URLSearchParams(query) };
}

const search = () => screen.getByRole("searchbox", { name: "Search" });
const type = (value: string) => fireEvent.change(search(), { target: { value } });
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

// The tests drive the fields with `fireEvent`, which is synchronous: user-event waits on timers
// through Testing Library's async wrapper, and that hangs while the timers are faked.
beforeEach(() => {
  vi.useFakeTimers();
  replace.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CustomerSearch: what it shows", () => {
  it("has a labelled search and sort, with the committed values", () => {
    setup({ q: "alex", sort: "lastActivityAt", order: "desc" });

    expect(screen.getByRole("search", { name: "Search customers" })).toBeVisible();
    expect(search()).toHaveValue("alex");
    expect(search()).toHaveAttribute("placeholder", "Name, email or phone");
    expect(screen.getByLabelText("Sort by")).toHaveValue("lastActivityAt");
    expect(screen.getByLabelText("Order")).toHaveValue("desc");
  });

  it("offers the three sorts the API has, by their plain names", () => {
    setup();

    const options = Array.from(screen.getByLabelText<HTMLSelectElement>("Sort by").options);
    expect(options.map((option) => [option.value, option.textContent])).toEqual([
      ["name", "Name"],
      ["createdAt", "Customer since"],
      ["lastActivityAt", "Last activity"],
    ]);
  });

  it("words the order for what is being sorted", () => {
    const { rerender } = setup();
    const orderLabels = () =>
      Array.from(screen.getByLabelText<HTMLSelectElement>("Order").options).map(
        (option) => option.textContent,
      );

    expect(orderLabels()).toEqual(["A to Z", "Z to A"]);
    rerender({ sort: "createdAt", order: "desc" });
    expect(orderLabels()).toEqual(["Oldest first", "Newest first"]);
  });

  it("offers Clear search only when a search is applied, and keeps the sort", () => {
    const { rerender } = setup({ sort: "lastActivityAt", order: "desc" });
    expect(screen.queryByRole("link", { name: "Clear search" })).not.toBeInTheDocument();

    rerender({ q: "alex", canClear: true, sort: "lastActivityAt", order: "desc" });
    expect(screen.getByRole("link", { name: "Clear search" })).toHaveAttribute(
      "href",
      "/app/customers?sort=lastActivityAt&order=desc",
    );
  });

  it("clears to the plain directory when the sort is the default", () => {
    setup({ q: "alex", canClear: true });

    expect(screen.getByRole("link", { name: "Clear search" })).toHaveAttribute(
      "href",
      "/app/customers",
    );
  });

  it("is a plain GET form that also works without scripts", () => {
    setup();

    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/app/customers");
    expect(search()).toHaveAttribute("name", "q");
    expect(screen.getByLabelText("Sort by")).toHaveAttribute("name", "sort");
    expect(screen.getByLabelText("Order")).toHaveAttribute("name", "order");
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
  });
});

describe("CustomerSearch: the search box", () => {
  it("waits for a pause in typing before it reloads the list, then reloads once", () => {
    setup();

    type("alex");
    expect(replace).not.toHaveBeenCalled();

    wait(SEARCH_DEBOUNCE_MS - 1);
    expect(replace).not.toHaveBeenCalled();

    wait(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(lastAddress().path).toBe("/app/customers");
    expect(lastAddress().params.get("q")).toBe("alex");
  });

  it("starts the wait again with every key", () => {
    setup();

    type("al");
    wait(SEARCH_DEBOUNCE_MS - 50);
    type("alex");
    wait(SEARCH_DEBOUNCE_MS - 50);
    expect(replace).not.toHaveBeenCalled();

    wait(50);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(lastAddress().params.get("q")).toBe("alex");
  });

  it("trims what was typed, and leaves the address clean when it was cleared", () => {
    setup({ q: "alex" });

    type("  morgan  ");
    wait(SEARCH_DEBOUNCE_MS);
    expect(lastAddress().params.get("q")).toBe("morgan");

    type("   ");
    wait(SEARCH_DEBOUNCE_MS);
    expect(replace).toHaveBeenLastCalledWith("/app/customers", { scroll: false });
  });

  it("goes back to page 1 and never writes a page into the address", () => {
    setup({ q: "alex" });

    type("alexa");
    wait(SEARCH_DEBOUNCE_MS);
    expect(lastAddress().params.has("page")).toBe(false);
  });

  it("searches at once when the button is pressed, without waiting for a pause", () => {
    setup();

    type("priya");
    fireEvent.submit(screen.getByRole("search"));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(lastAddress().params.get("q")).toBe("priya");

    wait(SEARCH_DEBOUNCE_MS * 2);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("follows the address when it changes under it, but not over what is being typed", () => {
    const { rerender } = setup({ q: "alex" });
    expect(search()).toHaveValue("alex");

    // The back button or "Clear search" moved the address while nothing was being typed.
    rerender({ q: undefined });
    expect(search()).toHaveValue("");
  });

  it("limits the search to 100 characters, as the API does", () => {
    setup();

    expect(search()).toHaveAttribute("maxlength", "100");
  });
});

describe("CustomerSearch: the sort", () => {
  it("reloads at once, starting a new column the way it is read", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "lastActivityAt" } });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(lastAddress().params.get("sort")).toBe("lastActivityAt");
    expect(lastAddress().params.get("order")).toBe("desc");
  });

  it("keeps the search that is in the box when the sort changes", () => {
    setup({ q: "alex" });

    type("alexa");
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "createdAt" } });
    expect(lastAddress().params.get("q")).toBe("alexa");
    expect(lastAddress().params.get("sort")).toBe("createdAt");
  });

  it("reverses the order without touching the column", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Order"), { target: { value: "desc" } });
    expect(lastAddress().params.get("sort")).toBe("name");
    expect(lastAddress().params.get("order")).toBe("desc");
  });

  it("leaves the default sort out of the address", () => {
    setup({ sort: "createdAt", order: "desc" });

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "name" } });
    expect(replace).toHaveBeenLastCalledWith("/app/customers", { scroll: false });
  });
});
