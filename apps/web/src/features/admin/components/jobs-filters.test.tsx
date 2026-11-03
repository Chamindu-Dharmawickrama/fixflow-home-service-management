import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SEARCH_DEBOUNCE_MS } from "../lib/use-draft";
import { JobsFilters, type JobsFiltersProps } from "./jobs-filters";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const JORDAN = "3c1d9e52-7a64-4f0b-8b0e-5a2f6d4c8e77";
const RAE = "8e3f2a1b-0c9d-4e8f-9a7b-6c5d4e3f2a11";

const DEFAULTS: JobsFiltersProps = {
  q: undefined,
  technicianId: undefined,
  scheduledFrom: undefined,
  scheduledTo: undefined,
  technicians: [
    { id: JORDAN, name: "Jordan Lee", isActive: true },
    { id: RAE, name: "Rae Retired", isActive: false },
  ],
  preserve: {},
  canClear: false,
};

function setup(props: Partial<JobsFiltersProps> = {}) {
  const view = render(<JobsFilters {...DEFAULTS} {...props} />);
  return {
    rerender: (next: Partial<JobsFiltersProps>) =>
      view.rerender(<JobsFilters {...DEFAULTS} {...props} {...next} />),
  };
}

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

// `fireEvent` is synchronous: user-event waits on timers through Testing Library's async wrapper,
// and that hangs while the timers are faked.
beforeEach(() => {
  vi.useFakeTimers();
  replace.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("JobsFilters: what it shows", () => {
  it("has a labelled search, technician and date range, with the committed values", () => {
    setup({
      q: "okafor",
      technicianId: JORDAN,
      scheduledFrom: "2026-03-01",
      scheduledTo: "2026-03-31",
    });

    expect(screen.getByRole("search", { name: "Search and filter jobs" })).toBeVisible();
    expect(search()).toHaveValue("okafor");
    expect(screen.getByLabelText("Technician")).toHaveValue(JORDAN);
    expect(screen.getByLabelText("Scheduled from")).toHaveValue("2026-03-01");
    expect(screen.getByLabelText("Scheduled to")).toHaveValue("2026-03-31");
  });

  it("lists every technician, inactive ones marked, after 'All technicians'", () => {
    setup();
    const options = Array.from(screen.getByLabelText<HTMLSelectElement>("Technician").options).map(
      (option) => option.textContent,
    );
    expect(options).toEqual(["All technicians", "Jordan Lee", "Rae Retired (inactive)"]);
  });

  it("offers Clear filters only when something is set, and keeps the tab and the sort", () => {
    const preserve = { view: "upcoming", sort: "status", order: "asc" };
    const { rerender } = setup({ preserve });
    expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();

    rerender({ q: "okafor", canClear: true, preserve });
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/app/jobs?view=upcoming&sort=status&order=asc",
    );
  });

  it("is a plain GET form that also works without scripts, carrying the tab and the sort", () => {
    setup({ preserve: { view: "upcoming", sort: "status", order: "asc" } });
    const form = screen.getByRole("search");

    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/app/jobs");
    const hidden = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]'));
    expect(hidden.map((input) => [input.name, input.value])).toEqual([
      ["view", "upcoming"],
      ["sort", "status"],
      ["order", "asc"],
    ]);
  });
});

describe("JobsFilters: changing them", () => {
  it("waits for a pause in typing before it reloads the list, then reloads it once", () => {
    setup({ preserve: { view: "upcoming" } });

    type("o");
    type("ok");
    type("okafor");
    wait(SEARCH_DEBOUNCE_MS - 1);
    expect(replace).not.toHaveBeenCalled();
    wait(1);

    expect(replace).toHaveBeenCalledTimes(1);
    const { path, params } = lastAddress();
    expect(path).toBe("/app/jobs");
    expect(Object.fromEntries(params)).toEqual({ view: "upcoming", q: "okafor" });
  });

  it("reloads at once when a technician is chosen, back on page 1 with the tab kept", () => {
    setup({ preserve: { view: "upcoming" } });
    fireEvent.change(screen.getByLabelText("Technician"), { target: { value: JORDAN } });

    expect(Object.fromEntries(lastAddress().params)).toEqual({
      view: "upcoming",
      technicianId: JORDAN,
    });
  });

  it("reloads at once when a date is chosen", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Scheduled from"), { target: { value: "2026-03-01" } });
    expect(Object.fromEntries(lastAddress().params)).toEqual({ scheduledFrom: "2026-03-01" });

    fireEvent.change(screen.getByLabelText("Scheduled to"), { target: { value: "2026-03-31" } });
    expect(Object.fromEntries(lastAddress().params)).toEqual({
      scheduledFrom: "2026-03-01",
      scheduledTo: "2026-03-31",
    });
  });

  it("writes a cleared field out of the address", () => {
    setup({ technicianId: JORDAN, q: "okafor" });
    fireEvent.change(screen.getByLabelText("Technician"), { target: { value: "" } });
    expect(Object.fromEntries(lastAddress().params)).toEqual({ q: "okafor" });
  });

  it("says a range is backwards and does not reload for it", () => {
    setup({ scheduledFrom: "2026-03-10" });
    fireEvent.change(screen.getByLabelText("Scheduled to"), { target: { value: "2026-03-01" } });

    expect(screen.getByText("Choose a date on or after the start date.")).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });

  it("searches at once when the button is pressed", () => {
    setup();
    type("okafor");
    fireEvent.submit(screen.getByRole("search"));

    expect(Object.fromEntries(lastAddress().params)).toEqual({ q: "okafor" });
    wait(SEARCH_DEBOUNCE_MS * 2);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
