import type { NotificationDto, NotificationListResponse } from "@fixflow/shared";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, apiFetchEnvelope } from "@/lib/api";

import { NotificationBell } from "./notification-bell";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
  apiFetchEnvelope: vi.fn(),
}));

// `next/link` needs the App Router; a plain anchor is enough to see where a row would go.
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ prefetch: _prefetch, ...rest }: ComponentProps<"a"> & { prefetch?: boolean }) =>
      createElement("a", rest),
  };
});

/**
 * jsdom cannot navigate, and complains when an anchor is clicked. Cancelling the click here, on
 * the document, runs after React's handlers, so the popover still sees the click and closes.
 */
function preventNavigation(event: Event) {
  if (event.target instanceof Element && event.target.closest("a") !== null) {
    event.preventDefault();
  }
}

const apiFetchMock = vi.mocked(apiFetch);
const envelopeMock = vi.mocked(apiFetchEnvelope);

const TIME_ZONE = "America/New_York";
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function notification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    type: "QUOTATION_SENT",
    title: "Quotation QT-2026-00004 is ready",
    message: "We sent you a quotation for AC Repair. Please review it.",
    linkPath: "/portal/quotations/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    readAt: null,
    createdAt: minutesAgo(5),
    ...overrides,
  };
}

function page(
  items: NotificationDto[],
  options: { unreadCount?: number; totalItems?: number } = {},
): NotificationListResponse {
  return {
    data: items,
    pagination: {
      page: 1,
      pageSize: 10,
      totalItems: options.totalItems ?? items.length,
      totalPages: 1,
    },
    meta: {
      unreadCount: options.unreadCount ?? items.filter((item) => item.readAt === null).length,
      timeZone: TIME_ZONE,
    },
  };
}

/** Answers the count poll (pageSize=1) and the list request (pageSize=10) from one fixture. */
function serve(
  items: NotificationDto[],
  options: { unreadCount?: number; totalItems?: number } = {},
) {
  envelopeMock.mockImplementation(() => Promise.resolve(page(items, options) as never));
  return () => envelopeMock.mock.calls.map(([route]) => route);
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.clearAllMocks();
  document.addEventListener("click", preventNavigation);
});

afterEach(() => {
  document.removeEventListener("click", preventNavigation);
  setVisibility("visible");
  vi.useRealTimers();
});

const trigger = () => screen.getByRole("button", { name: /notification/i });

async function openBell(user = userEvent.setup()) {
  await user.click(trigger());
  return user;
}

describe("the badge and its accessible name", () => {
  it("names the bell 'Notifications' when everything has been read", async () => {
    serve([notification({ readAt: minutesAgo(1) })]);
    render(<NotificationBell />);

    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it.each([
    [1, "1 unread notification"],
    [3, "3 unread notifications"],
    [12, "12 unread notifications"],
  ])("announces %i unread as '%s'", async (count, name) => {
    serve([], { unreadCount: count });
    render(<NotificationBell />);

    expect(await screen.findByRole("button", { name })).toBeInTheDocument();
  });

  it("shows the number on the badge, and 9+ for ten or more, without repeating it to screen readers", async () => {
    serve([], { unreadCount: 12 });
    render(<NotificationBell />);

    const bell = await screen.findByRole("button", { name: "12 unread notifications" });
    expect(within(bell).getByText("9+")).toHaveAttribute("aria-hidden", "true");
  });

  it("asks the API for the count as soon as it appears", async () => {
    const calls = serve([], { unreadCount: 2 });
    render(<NotificationBell />);

    await screen.findByRole("button", { name: "2 unread notifications" });
    expect(calls()).toEqual(["/notifications/me?pageSize=1"]);
  });

  it("stays quiet about the count if the first request fails", async () => {
    envelopeMock.mockRejectedValue(
      new ApiError({ status: 0, code: "NETWORK_ERROR", message: "offline" }),
    );
    render(<NotificationBell />);

    await waitFor(() => {
      expect(envelopeMock).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });
});

describe("polling the count (D-40)", () => {
  it("asks again every 60 seconds while the tab is visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const calls = serve([], { unreadCount: 1 });
    render(<NotificationBell />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(calls()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(calls()).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls()).toHaveLength(3);
  });

  it("does not ask while the tab is hidden, and asks at once when it becomes visible again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const calls = serve([], { unreadCount: 1 });
    render(<NotificationBell />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls()).toHaveLength(1);

    act(() => {
      setVisibility("hidden");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(calls()).toHaveLength(1);

    act(() => {
      setVisibility("visible");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls()).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls()).toHaveLength(3);
  });

  it("does not start polling when the page loads in a hidden tab", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const calls = serve([]);
    render(<NotificationBell />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(calls()).toHaveLength(0);
  });

  it("stops asking once the session has ended (401)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    envelopeMock.mockRejectedValue(
      new ApiError({ status: 401, code: "UNAUTHENTICATED", message: "Sign in to continue." }),
    );
    render(<NotificationBell />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(envelopeMock).toHaveBeenCalledTimes(1);
  });

  it("keeps trying after a temporary failure and shows the latest count", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    envelopeMock
      .mockRejectedValueOnce(new ApiError({ status: 0, code: "NETWORK_ERROR", message: "offline" }))
      .mockResolvedValue(page([], { unreadCount: 4 }));
    render(<NotificationBell />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("button", { name: "4 unread notifications" })).toBeInTheDocument();
  });

  it("stops polling when the bell is removed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const calls = serve([]);
    const { unmount } = render(<NotificationBell />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(calls()).toHaveLength(1);
  });
});

describe("the list", () => {
  it("shows a loading state while it loads, then each notification with its time", async () => {
    let resolveList: (value: never) => void = () => undefined;
    envelopeMock.mockImplementation((route) =>
      route.includes("pageSize=10")
        ? new Promise((resolve) => {
            resolveList = resolve;
          })
        : Promise.resolve(page([], { unreadCount: 1 })),
    );
    render(<NotificationBell />);
    await openBell();

    expect(await screen.findByText("Loading notifications")).toBeInTheDocument();

    resolveList(page([notification()]) as never);
    const row = await screen.findByRole("link", { name: /Quotation QT-2026-00004 is ready/ });
    expect(row).toHaveTextContent("We sent you a quotation for AC Repair. Please review it.");
    expect(row).toHaveTextContent("5 minutes ago");
    expect(screen.queryByText("Loading notifications")).not.toBeInTheDocument();
  });

  it("asks for the latest ten when it opens", async () => {
    const calls = serve([notification()]);
    render(<NotificationBell />);
    await openBell();

    await screen.findByRole("link", { name: /Quotation QT-2026-00004/ });
    expect(calls()).toContain("/notifications/me?pageSize=10");
  });

  it("marks unread notifications for screen readers and by shape, not colour alone", async () => {
    serve([
      notification({ id: "11111111-1111-4111-8111-111111111111", title: "Unread one" }),
      notification({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Already read",
        readAt: minutesAgo(1),
      }),
    ]);
    render(<NotificationBell />);
    await openBell();

    const unread = await screen.findByRole("link", { name: /Unread one/ });
    const read = screen.getByRole("link", { name: /Already read/ });
    expect(within(unread).getByText("Unread:")).toBeInTheDocument();
    expect(within(read).queryByText("Unread:")).not.toBeInTheDocument();
  });

  it("says 'You're all caught up' when there is nothing", async () => {
    serve([]);
    render(<NotificationBell />);
    await openBell();

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.getByText("New notifications will appear here.")).toBeInTheDocument();
  });

  it("says how many are not shown when there are more than the list holds", async () => {
    serve([notification()], { totalItems: 25, unreadCount: 25 });
    render(<NotificationBell />);
    await openBell();

    expect(await screen.findByText("Showing the latest 1 of 25.")).toBeInTheDocument();
  });

  it("shows an error with a retry, and recovers when the retry works", async () => {
    envelopeMock.mockImplementation((route) =>
      route.includes("pageSize=10")
        ? Promise.reject(
            new ApiError({ status: 503, code: "SERVICE_UNAVAILABLE", message: "Try again soon." }),
          )
        : Promise.resolve(page([], { unreadCount: 1 })),
    );
    render(<NotificationBell />);
    const user = await openBell();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't load your notifications");
    expect(alert).toHaveTextContent("Try again soon.");

    envelopeMock.mockImplementation(() => Promise.resolve(page([notification()]) as never));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("link", { name: /Quotation QT-2026-00004/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never mentions email in what it says about a notification", async () => {
    serve([]);
    render(<NotificationBell />);
    await openBell();

    const popover = await screen.findByRole("dialog", { name: "Notifications" });
    expect(popover.textContent).not.toMatch(/e-?mail|delivered|inbox/i);
  });
});

describe("choosing a notification", () => {
  const ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

  it("goes to its page and marks it read straight away", async () => {
    serve([notification({ id: ID })]);
    apiFetchMock.mockResolvedValue(notification({ id: ID, readAt: new Date().toISOString() }));
    render(<NotificationBell />);
    const user = await openBell();

    const row = await screen.findByRole("link", { name: /Quotation QT-2026-00004/ });
    expect(row).toHaveAttribute("href", `/portal/quotations/${ID}`);
    await user.click(row);

    expect(apiFetchMock).toHaveBeenCalledWith(`/notifications/${ID}/read`, { method: "PATCH" });
    // The badge dropped at once, without waiting for the next poll.
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("closes the popover when a notification is chosen", async () => {
    serve([notification({ id: ID })]);
    apiFetchMock.mockResolvedValue(notification({ id: ID, readAt: new Date().toISOString() }));
    render(<NotificationBell />);
    const user = await openBell();

    await user.click(await screen.findByRole("link", { name: /Quotation QT-2026-00004/ }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("puts the badge back if the API refuses after the person has gone to the page", async () => {
    serve([notification({ id: ID })], { unreadCount: 1 });
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Server error" }),
    );
    render(<NotificationBell />);
    const user = await openBell();

    await user.click(await screen.findByRole("link", { name: /Quotation QT-2026-00004/ }));

    // The count is back at 1: the notification was never marked, so it must not look read.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1 unread notification" })).toBeInTheDocument();
    });
  });

  it("puts the notification back to unread, and says so, if the API refuses while the list is open", async () => {
    serve([notification({ id: ID, linkPath: "https://evil.example.com/portal" })], {
      unreadCount: 1,
    });
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Server error" }),
    );
    render(<NotificationBell />);
    const user = await openBell();

    await user.click(await screen.findByRole("button", { name: /Quotation QT-2026-00004/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't mark that notification as read",
    );
    expect(screen.getByText("Unread:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 unread notification" })).toBeInTheDocument();
  });

  it("does not ask the API again for a notification that is already read", async () => {
    serve([notification({ id: ID, readAt: minutesAgo(1) })], { unreadCount: 0 });
    render(<NotificationBell />);
    const user = await openBell();

    await user.click(await screen.findByRole("link", { name: /Quotation QT-2026-00004/ }));

    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("never links outside the app: an unsafe path becomes a button that only marks it read", async () => {
    serve([notification({ id: ID, linkPath: "https://evil.example.com/portal" })]);
    apiFetchMock.mockResolvedValue(notification({ id: ID, readAt: new Date().toISOString() }));
    render(<NotificationBell />);
    const user = await openBell();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Quotation QT-2026-00004/ }));

    expect(apiFetchMock).toHaveBeenCalledWith(`/notifications/${ID}/read`, { method: "PATCH" });
  });
});

describe("Mark all as read", () => {
  it("is disabled when nothing is unread", async () => {
    serve([notification({ readAt: minutesAgo(1) })], { unreadCount: 0 });
    render(<NotificationBell />);
    await openBell();

    expect(await screen.findByRole("button", { name: "Mark all as read" })).toBeDisabled();
  });

  it("marks everything read through the API and clears the badge", async () => {
    serve(
      [
        notification({ id: "11111111-1111-4111-8111-111111111111", title: "One" }),
        notification({ id: "22222222-2222-4222-8222-222222222222", title: "Two" }),
      ],
      { unreadCount: 2 },
    );
    apiFetchMock.mockResolvedValue({ updated: 2 });
    render(<NotificationBell />);
    const user = await openBell();

    await user.click(await screen.findByRole("button", { name: "Mark all as read" }));

    expect(apiFetchMock).toHaveBeenCalledWith("/notifications/me/read-all", { method: "POST" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    });
    expect(screen.queryByText("Unread:")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  });

  it("does not pretend it worked when the API refuses", async () => {
    serve([notification()], { unreadCount: 1 });
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Server error" }),
    );
    render(<NotificationBell />);
    const user = await openBell();

    await user.click(await screen.findByRole("button", { name: "Mark all as read" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't mark your notifications as read",
    );
    expect(screen.getByRole("button", { name: "1 unread notification" })).toBeInTheDocument();
    expect(screen.getByText("Unread:")).toBeInTheDocument();
  });

  it("blocks a second click while the first is still pending", async () => {
    serve([notification()], { unreadCount: 1 });
    let finish: (value: { updated: number }) => void = () => undefined;
    apiFetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<NotificationBell />);
    const user = await openBell();
    const button = await screen.findByRole("button", { name: "Mark all as read" });

    await user.click(button);
    await user.click(button);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ updated: 1 });
      await Promise.resolve();
    });
  });
});

describe("keyboard", () => {
  it("opens with Enter, reaches the rows and the button with Tab, and Escape returns focus to the bell", async () => {
    serve([notification()], { unreadCount: 1 });
    render(<NotificationBell />);
    const user = userEvent.setup();

    await screen.findByRole("button", { name: "1 unread notification" });
    await user.tab();
    expect(trigger()).toHaveFocus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    // Focus moves into the popover when it opens; Tab then reaches the rest of it.
    const reachable: string[] = [];
    const note = () => {
      if (dialog.contains(document.activeElement)) {
        reachable.push(document.activeElement?.textContent ?? "");
      }
    };
    note();
    for (let step = 0; step < 4; step += 1) {
      await user.tab();
      note();
    }
    expect(reachable.some((text) => text.includes("Mark all as read"))).toBe(true);
    expect(reachable.some((text) => text.includes("Quotation QT-2026-00004"))).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(trigger()).toHaveFocus();
  });
});
