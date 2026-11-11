import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { attentionItem, dashboardSummary } from "../test-fixtures";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { DashboardView } from "./dashboard-view";

function renderDashboard(summary = dashboardSummary()) {
  return render(<DashboardView summary={summary} userName="Morgan Reyes" />);
}

describe("DashboardView: the header", () => {
  it("greets the admin for the business's time of day and shows today's date", () => {
    renderDashboard();
    // 15:00 UTC is 10:00 in New York.
    expect(screen.getByRole("heading", { level: 1, name: "Good morning, Morgan" })).toBeVisible();
    expect(screen.getByText("Thursday, Mar 5, 2026")).toBeVisible();
  });

  it("says good evening when the business's clocks say so, whatever the browser's are", () => {
    renderDashboard(dashboardSummary({ generatedAt: "2026-03-05T23:30:00.000Z" }));
    expect(screen.getByRole("heading", { level: 1, name: "Good evening, Morgan" })).toBeVisible();
  });

  it("offers Today, 7 days and 30 days as links, marking the chosen one", () => {
    renderDashboard();
    const nav = screen.getByRole("navigation", { name: "Period for new requests" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Today", "7 days", "30 days"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/app/dashboard?range=today",
      "/app/dashboard",
      "/app/dashboard?range=30d",
    ]);
    expect(within(nav).getByRole("link", { name: "7 days" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(nav).getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });
});

describe("DashboardView: the five figures (FR-080)", () => {
  it("shows five cards, each a link to the list it counts", () => {
    renderDashboard();
    const figures = screen.getByRole("region", { name: "Key figures" });
    expect(within(figures).getAllByRole("listitem")).toHaveLength(5);

    const link = (name: string) => within(figures).getByRole("link", { name });
    expect(link("New requests")).toHaveAttribute(
      "href",
      "/app/requests?submittedFrom=2026-02-27&submittedTo=2026-03-05",
    );
    expect(link("Requests needing action")).toHaveAttribute(
      "href",
      "/app/requests?status=SUBMITTED,UNDER_REVIEW,ACCEPTED,DECLINED",
    );
    expect(link("Jobs today")).toHaveAttribute(
      "href",
      "/app/jobs?view=all&status=SCHEDULED,IN_PROGRESS&scheduledFrom=2026-03-05&scheduledTo=2026-03-12",
    );
    expect(link("Completed, awaiting invoice")).toHaveAttribute(
      "href",
      "/app/jobs?view=ready-to-invoice",
    );
    expect(link("Unpaid balance")).toHaveAttribute(
      "href",
      "/app/invoices?status=ISSUED,PARTIALLY_PAID,OVERDUE",
    );
  });

  it("shows the values from the data, with the money formatted in the business's currency", () => {
    renderDashboard();
    const figures = screen.getByRole("region", { name: "Key figures" });
    const text = figures.textContent;
    expect(text).toContain("7");
    expect(text).toContain("$690.00");
    expect(text).toContain("3");
    expect(text).toContain("2 more in the next 7 days");
  });

  it("labels the period-independent figures Current and the period-dependent one with the period", () => {
    renderDashboard();
    const figures = screen.getByRole("region", { name: "Key figures" });
    expect(within(figures).getByText("Last 7 days")).toBeVisible();
    expect(within(figures).getAllByText(/^Current/)).toHaveLength(4);
  });

  it("follows the range in the label of the new-requests figure", () => {
    renderDashboard(
      dashboardSummary({ period: { range: "today", from: "2026-03-05", to: "2026-03-05" } }),
    );
    expect(screen.getByText("Today", { selector: "p" })).toBeVisible();
  });

  it("links the overdue part of the balance to the overdue invoices", () => {
    renderDashboard();
    const overdue = screen.getByRole("link", { name: /2 overdue/ });
    expect(overdue).toHaveAttribute("href", "/app/invoices?status=OVERDUE");
    expect(overdue).toHaveTextContent("2 overdue ($180.00)");
  });

  it("says none are overdue when none are", () => {
    const summary = dashboardSummary();
    summary.kpis.unpaidBalance.overdueCount = 0;
    summary.kpis.unpaidBalance.overdueAmount = "0.00";
    renderDashboard(summary);
    expect(screen.getByText(/none overdue/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /overdue/ })).not.toBeInTheDocument();
  });

  it("shows the definition of each figure on request (FR-085)", async () => {
    renderDashboard();
    const user = userEvent.setup();
    for (const [label, definition] of [
      ["New requests", "Service requests submitted in the last 7 days."],
      ["Requests needing action", "Requests waiting on you right now."],
      ["Jobs today", "Scheduled or in-progress jobs that start today."],
      ["Completed, awaiting invoice", "Completed jobs that have no invoice yet."],
      ["Unpaid balance", "What customers still owe."],
    ] as const) {
      await user.click(screen.getByRole("button", { name: `About ${label}` }));
      expect(await screen.findByText(definition)).toBeVisible();
      await user.keyboard("{Escape}");
      expect(screen.queryByText(definition)).not.toBeInTheDocument();
    }
  });

  it("says in the definition whether the figure follows the period or is current", async () => {
    renderDashboard();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "About New requests" }));
    expect(await screen.findByText(/Follows the selected period: last 7 days/)).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "About Unpaid balance" }));
    expect(await screen.findByText(/Current: not affected by the selected period/)).toBeVisible();
  });
});

describe("DashboardView: needs attention (FR-081)", () => {
  it("lists each item with its kind in words, its title, how long it has waited and a direct action", () => {
    renderDashboard();
    const queue = screen.getByRole("region", { name: "Needs attention" });
    const items = within(queue).getAllByRole("listitem");
    expect(items).toHaveLength(3);

    expect(items[0]).toHaveTextContent("Overdue invoice");
    expect(items[0]).toHaveTextContent("INV-2026-00007 · Priya Shah");
    expect(items[0]).toHaveTextContent("overdue by 6 days");
    expect(items[0]).toHaveTextContent("$100.00 due");

    expect(items[1]).toHaveTextContent("New request");
    expect(items[1]).toHaveTextContent("AC Repair · submitted 2 h ago");

    const action = within(items[2] as HTMLElement).getByRole("link", { name: /Schedule/ });
    expect(action).toHaveAttribute(
      "href",
      "/app/jobs/b4a1f5c2-3d6e-4c7a-9b8d-2e1f0a9b8c7d?schedule=1",
    );
  });

  it("gives every action button a name that says which item it is for", () => {
    renderDashboard();
    expect(
      screen.getByRole("link", { name: "Review request: FF-2026-00012 · Alex Morgan" }),
    ).toHaveAttribute("href", "/app/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
    expect(
      screen.getByRole("link", { name: "Open invoice: INV-2026-00007 · Priya Shah" }),
    ).toBeVisible();
  });

  it("says how many are not shown when the queue is cut", () => {
    const summary = dashboardSummary();
    summary.needsAttention.totalItems = 18;
    renderDashboard(summary);
    expect(screen.getByText("The 3 most urgent of 18 things that need you.")).toBeVisible();
  });

  it("says how many there are when all are shown", () => {
    renderDashboard();
    expect(screen.getByText("3 things need you, most urgent first.")).toBeVisible();
  });

  it("is worded as good news when nothing needs attention", () => {
    const summary = dashboardSummary();
    summary.needsAttention = { ...summary.needsAttention, items: [], totalItems: 0 };
    renderDashboard(summary);
    expect(screen.getByText("Nothing is waiting on you right now.")).toBeVisible();
    expect(screen.getByText(/You're all caught up/)).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Needs attention" })).queryAllByRole("listitem"),
    ).toHaveLength(0);
  });

  it("keeps a very long unbroken customer name inside the card", () => {
    const summary = dashboardSummary();
    summary.needsAttention.items = [attentionItem({ title: `FF-2026-00012 · ${"A".repeat(120)}` })];
    renderDashboard(summary);
    const title = screen.getByText(/A{120}/);
    expect(title.className).toContain("[overflow-wrap:anywhere]");
  });
});

describe("DashboardView: the schedule and the activity (FR-082, FR-083)", () => {
  it("lists the next visits with their time, job, customer, service and technician", () => {
    renderDashboard();
    const schedule = screen.getByRole("region", { name: "Upcoming schedule" });
    const rows = within(schedule).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    // 20:00 UTC is 15:00 in New York, and the day is today.
    expect(rows[0]).toHaveTextContent("Today");
    expect(rows[0]).toHaveTextContent("3:00 – 4:00 PM");
    expect(rows[0]).toHaveTextContent("Alex Morgan · AC Repair · Jordan Lee");
    expect(within(rows[0] as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "/app/jobs/b4a1f5c2-3d6e-4c7a-9b8d-2e1f0a9b8c7d",
    );
    // The next day shows its date, and a visit with no technician names none.
    expect(rows[1]).toHaveTextContent("Mar 6, 2026");
    expect(rows[1]).toHaveTextContent("Priya Shah · Gutter Cleaning");
    expect(rows[1]).not.toHaveTextContent("Jordan");
  });

  it("links to the calendar and to all jobs", () => {
    renderDashboard();
    const schedule = screen.getByRole("region", { name: "Upcoming schedule" });
    expect(within(schedule).getByRole("link", { name: "Open the calendar" })).toHaveAttribute(
      "href",
      "/app/calendar",
    );
    expect(within(schedule).getByRole("link", { name: "All jobs" })).toHaveAttribute(
      "href",
      "/app/jobs",
    );
  });

  it("says no visits are booked when there are none", () => {
    renderDashboard(dashboardSummary({ upcomingSchedule: [] }));
    expect(screen.getByText(/No visits are booked/)).toBeVisible();
  });

  it("shows the recent events newest first, each linking to its record where it has one", () => {
    renderDashboard();
    const activity = screen.getByRole("region", { name: "Recent activity" });
    const events = within(activity).getAllByRole("listitem");
    expect(events).toHaveLength(2);
    expect(
      within(events[0] as HTMLElement).getByRole("link", {
        name: "Alex Morgan sent request FF-2026-00012",
      }),
    ).toHaveAttribute("href", "/app/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
    expect(events[0]).toHaveTextContent("Alex Morgan");
    // An event with no page is plain text, and one the system made says so.
    expect(within(events[1] as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
    expect(events[1]).toHaveTextContent("Quotation QT-2026-00003 expired");
    expect(events[1]).toHaveTextContent("System");
  });

  it("says nothing has happened when there is no activity", () => {
    renderDashboard(dashboardSummary({ recentActivity: [] }));
    expect(screen.getByText(/Nothing has happened yet/)).toBeVisible();
  });
});

describe("DashboardView: a business with no requests yet", () => {
  it("shows guidance and a link to the services page instead of empty panels", () => {
    renderDashboard(dashboardSummary({ isFresh: true }));
    expect(screen.getByRole("heading", { name: "No requests yet" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open your services page" })).toHaveAttribute(
      "href",
      "/services",
    );
    expect(screen.queryByRole("region", { name: "Needs attention" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Upcoming schedule" })).not.toBeInTheDocument();
    // The figures are still there: all honest zeros.
    expect(screen.getByRole("region", { name: "Key figures" })).toBeVisible();
  });
});

describe("DashboardSkeleton", () => {
  it("is announced once as loading, and holds the shape of the page", () => {
    render(<DashboardSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the dashboard");
  });
});
