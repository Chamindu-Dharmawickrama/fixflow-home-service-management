import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RequestQueueFilters,
  type RequestQueueFiltersProps,
  SEARCH_DEBOUNCE_MS,
} from "./request-queue-filters";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const SERVICES = [
  { id: "5d3c2b1a-9f8e-4d7c-8b6a-5e4d3c2b1a09", name: "AC Repair" },
  { id: "6e4d3c2b-0a9f-4e8d-9c7b-6f5e4d3c2b1a", name: "Plumbing" },
];

const DEFAULTS: RequestQueueFiltersProps = {
  q: undefined,
  serviceId: undefined,
  submittedFrom: undefined,
  submittedTo: undefined,
  services: SERVICES,
  preserve: {},
  canClear: false,
};

function setup(props: Partial<RequestQueueFiltersProps> = {}) {
  const view = render(<RequestQueueFilters {...DEFAULTS} {...props} />);
  const rerender = (next: Partial<RequestQueueFiltersProps>) =>
    view.rerender(<RequestQueueFilters {...DEFAULTS} {...props} {...next} />);
  return { rerender, unmount: view.unmount };
}

/** The address the list was last sent to, as readable parameters. */
function lastAddress(): { path: string; params: URLSearchParams } {
  const href = replace.mock.calls.at(-1)?.[0] as string;
  const [path = "", query = ""] = href.split("?");
  return { path, params: new URLSearchParams(query) };
}

const search = () => screen.getByRole("searchbox", { name: "Search" });
const type = (value: string) => fireEvent.change(search(), { target: { value } });
const submit = () => fireEvent.submit(screen.getByRole("search"));
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

describe("RequestQueueFilters: what it shows", () => {
  it("has a labelled search, service and date range, with the committed values", () => {
    setup({
      q: "okafor",
      serviceId: SERVICES[1]?.id,
      submittedFrom: "2026-03-01",
      submittedTo: "2026-03-31",
    });

    expect(screen.getByRole("search", { name: "Search and filter requests" })).toBeVisible();
    expect(search()).toHaveValue("okafor");
    expect(screen.getByLabelText("Service")).toHaveValue(SERVICES[1]?.id);
    expect(screen.getByLabelText("Submitted from")).toHaveValue("2026-03-01");
    expect(screen.getByLabelText("Submitted to")).toHaveValue("2026-03-31");
  });

  it("lists every service, after 'All services'", () => {
    setup();

    const options = Array.from(screen.getByLabelText<HTMLSelectElement>("Service").options).map(
      (option) => option.textContent,
    );
    expect(options).toEqual(["All services", "AC Repair", "Plumbing"]);
  });

  it("offers Clear filters only when there is something to clear, and keeps the status and the sort", () => {
    const preserve = { status: "QUOTED", sort: "reference", order: "asc" };
    const { rerender } = setup({ preserve });
    expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();

    rerender({ q: "okafor", canClear: true, preserve });
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/app/requests?status=QUOTED&sort=reference&order=asc",
    );
  });

  it("is a plain GET form that also works without scripts, carrying the status and the sort", () => {
    setup({ preserve: { status: "QUOTED", sort: "reference", order: "asc" } });

    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/app/requests");
    const hidden = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]'));
    expect(hidden.map((input) => [input.name, input.value])).toEqual([
      ["status", "QUOTED"],
      ["sort", "reference"],
      ["order", "asc"],
    ]);
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
  });
});

describe("RequestQueueFilters: the search box", () => {
  it("waits for a pause in typing before it reloads the list, then reloads once", () => {
    setup();

    type("okafor");
    expect(replace).not.toHaveBeenCalled();

    wait(SEARCH_DEBOUNCE_MS - 1);
    expect(replace).not.toHaveBeenCalled();

    wait(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(lastAddress().params.get("q")).toBe("okafor");
  });

  it("starts the wait again with every key", () => {
    setup();

    type("ok");
    wait(SEARCH_DEBOUNCE_MS - 50);
    type("okafor");
    wait(SEARCH_DEBOUNCE_MS - 50);
    expect(replace).not.toHaveBeenCalled();

    wait(50);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(lastAddress().params.get("q")).toBe("okafor");
  });

  it("searches at once on Enter or the Search button, and does not search again after the wait", () => {
    setup();

    type("FF-2026-00012");
    submit();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(lastAddress().params.get("q")).toBe("FF-2026-00012");

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(replace).toHaveBeenCalledTimes(2);

    wait(SEARCH_DEBOUNCE_MS * 2);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("trims the search, and drops it from the address when it is emptied", () => {
    setup({ q: "okafor" });

    type("   ");
    submit();

    expect(lastAddress().params.has("q")).toBe(false);
  });

  it("encodes characters that mean something in an address", () => {
    setup();

    type("A&B=C #1 100%");
    submit();

    expect(lastAddress().params.get("q")).toBe("A&B=C #1 100%");
    expect([...lastAddress().params.keys()]).toEqual(["q"]);
  });

  it("goes to the queue's own path, on page 1, keeping the status and the sort", () => {
    setup({ preserve: { status: "SUBMITTED,QUOTED", sort: "status", order: "desc" } });

    type("okafor");
    submit();

    const { path, params } = lastAddress();
    expect(path).toBe("/app/requests");
    expect(Object.fromEntries(params)).toEqual({
      status: "SUBMITTED,QUOTED",
      sort: "status",
      order: "desc",
      q: "okafor",
    });
    expect(params.has("page")).toBe(false);
  });

  it("does not cancel the other filters when it searches", () => {
    setup({
      serviceId: SERVICES[0]?.id,
      submittedFrom: "2026-03-01",
      submittedTo: "2026-03-31",
    });

    type("okafor");
    submit();

    expect(Object.fromEntries(lastAddress().params)).toEqual({
      q: "okafor",
      serviceId: SERVICES[0]?.id,
      submittedFrom: "2026-03-01",
      submittedTo: "2026-03-31",
    });
  });

  it("does not reload a page that has been left", () => {
    const { unmount } = setup();

    type("okafor");
    unmount();
    wait(SEARCH_DEBOUNCE_MS * 2);

    expect(replace).not.toHaveBeenCalled();
  });

  it("sends the search typed so far when another filter changes first, and not again afterwards", () => {
    setup();

    type("okafor");
    wait(SEARCH_DEBOUNCE_MS - 100);
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: SERVICES[1]?.id } });
    expect(Object.fromEntries(lastAddress().params)).toEqual({
      q: "okafor",
      serviceId: SERVICES[1]?.id,
    });
    replace.mockClear();

    wait(SEARCH_DEBOUNCE_MS);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("RequestQueueFilters: service and dates", () => {
  it("reloads at once when a service is chosen", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Service"), { target: { value: SERVICES[1]?.id } });

    expect(replace).toHaveBeenCalledTimes(1);
    expect(lastAddress().params.get("serviceId")).toBe(SERVICES[1]?.id);
  });

  it("drops the service from the address when All services is chosen", () => {
    setup({ serviceId: SERVICES[0]?.id });

    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "" } });

    expect(lastAddress().params.has("serviceId")).toBe(false);
  });

  it("reloads at once when a date is chosen", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Submitted from"), { target: { value: "2026-03-01" } });
    expect(lastAddress().params.get("submittedFrom")).toBe("2026-03-01");

    fireEvent.change(screen.getByLabelText("Submitted to"), { target: { value: "2026-03-31" } });
    expect(Object.fromEntries(lastAddress().params)).toEqual({
      submittedFrom: "2026-03-01",
      submittedTo: "2026-03-31",
    });
  });

  it("accepts a one-day range", () => {
    setup({ submittedFrom: "2026-03-10" });

    fireEvent.change(screen.getByLabelText("Submitted to"), { target: { value: "2026-03-10" } });

    expect(lastAddress().params.get("submittedTo")).toBe("2026-03-10");
    expect(screen.queryByText(/on or after the start date/)).not.toBeInTheDocument();
  });

  it("says so beside the field, and does not reload, when the range runs backwards", () => {
    setup({ submittedFrom: "2026-03-20" });

    fireEvent.change(screen.getByLabelText("Submitted to"), { target: { value: "2026-03-01" } });

    expect(replace).not.toHaveBeenCalled();
    const to = screen.getByLabelText("Submitted to");
    expect(to).toBeInvalid();
    expect(to).toHaveAccessibleDescription("Choose a date on or after the start date.");
  });

  it("reloads once the range is put right", () => {
    setup({ submittedFrom: "2026-03-20" });
    fireEvent.change(screen.getByLabelText("Submitted to"), { target: { value: "2026-03-01" } });
    expect(replace).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Submitted to"), { target: { value: "2026-03-25" } });

    expect(lastAddress().params.get("submittedTo")).toBe("2026-03-25");
    expect(screen.queryByText(/on or after the start date/)).not.toBeInTheDocument();
  });
});

describe("RequestQueueFilters: following the address", () => {
  it("follows the address when it changes while nothing is being typed (Clear filters, the back button)", () => {
    const { rerender } = setup({ q: "okafor" });
    expect(search()).toHaveValue("okafor");

    rerender({ q: undefined });

    expect(search()).toHaveValue("");
  });

  it("does not take away what is being typed when an earlier search comes back", () => {
    const { rerender } = setup();

    type("okafor");
    // The answer to an earlier keystroke arrives while more has been typed.
    rerender({ q: "oka" });

    expect(search()).toHaveValue("okafor");
  });

  it("follows the address for the service and the dates as well", () => {
    const { rerender } = setup({
      serviceId: SERVICES[0]?.id,
      submittedFrom: "2026-03-01",
      submittedTo: "2026-03-31",
    });

    rerender({ serviceId: undefined, submittedFrom: undefined, submittedTo: undefined });

    expect(screen.getByLabelText("Service")).toHaveValue("");
    expect(screen.getByLabelText("Submitted from")).toHaveValue("");
    expect(screen.getByLabelText("Submitted to")).toHaveValue("");
  });
});
