import { render, screen, within } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Avatar, initialsOf } from "./avatar";
import { Breadcrumbs } from "./breadcrumbs";
import { DateTimeText } from "./date-time-text";
import { DocumentLines, DocumentTotals } from "./document";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { MoneyText } from "./money-text";
import { PageHeader } from "./page-header";
import { PermissionDenied } from "./permission-denied";
import { ReferenceText } from "./reference-text";
import { CardSkeleton, DetailSkeleton, TableSkeleton } from "./skeleton";
import { StatCard } from "./stat-card";
import { Timeline } from "./timeline";

describe("MoneyText", () => {
  it("formats an exact decimal string with its explicit currency", () => {
    render(<MoneyText amount="1284.50" currencyCode="USD" />);
    expect(screen.getByText("$1,284.50")).toBeVisible();
    expect(screen.getByText("$1,284.50").className).toContain("tabular-nums");
  });

  it("refuses a malformed amount instead of showing a wrong one", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<MoneyText amount="12,50" currencyCode="USD" />)).toThrow(RangeError);
    quiet.mockRestore();
  });
});

describe("DateTimeText", () => {
  it("renders a <time> in the business time zone, with the zone in its tooltip", () => {
    render(<DateTimeText value="2026-10-28T02:30:00Z" timeZone="America/New_York" />);
    const time = screen.getByText("Oct 27, 2026, 10:30 PM");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "2026-10-28T02:30:00Z");
    expect(time).toHaveAttribute("title", "Oct 27, 2026, 10:30 PM EDT");
  });

  it("can show just the date or just the time", () => {
    const { rerender } = render(
      <DateTimeText value="2026-10-28T15:30:00Z" timeZone="America/New_York" display="date" />,
    );
    expect(screen.getByText("Oct 28, 2026")).toBeVisible();
    rerender(
      <DateTimeText value="2026-10-28T15:30:00Z" timeZone="America/New_York" display="time" />,
    );
    expect(screen.getByText("11:30 AM")).toBeVisible();
  });

  it("shows a date-only value as written", () => {
    render(<DateTimeText value="2026-11-11" timeZone="Pacific/Kiritimati" />);
    const time = screen.getByText("Nov 11, 2026");
    expect(time).toHaveAttribute("datetime", "2026-11-11");
    expect(time).not.toHaveAttribute("title");
  });
});

describe("ReferenceText", () => {
  it("normalises and never wraps", () => {
    render(<ReferenceText reference=" ff-2026-00125 " />);
    const reference = screen.getByText("FF-2026-00125");
    expect(reference.className).toContain("whitespace-nowrap");
  });
});

describe("Avatar", () => {
  it("derives initials from the name", () => {
    expect(initialsOf("Morgan Reyes")).toBe("MR");
    expect(initialsOf("Priya")).toBe("P");
    expect(initialsOf("  jordan   lee  ")).toBe("JL");
    expect(initialsOf("Mary Jane Watson")).toBe("MW");
    expect(initialsOf("")).toBe("");
  });

  it("is an image named after the person", () => {
    render(<Avatar name="Morgan Reyes" />);
    const avatar = screen.getByRole("img", { name: "Morgan Reyes" });
    expect(avatar).toHaveTextContent("MR");
  });
});

describe("Breadcrumbs", () => {
  it("links the trail and marks the current page", () => {
    render(
      <Breadcrumbs
        items={[{ label: "Requests", href: "/app/requests" }, { label: "FF-2026-00125" }]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByRole("link", { name: "Requests" })).toHaveAttribute(
      "href",
      "/app/requests",
    );
    expect(within(nav).getByText("FF-2026-00125")).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("link", { name: "FF-2026-00125" })).toBeNull();
  });

  it("never links the last item even if it has an href", () => {
    render(
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Here", href: "/here" },
        ]}
      />,
    );
    expect(screen.queryByRole("link", { name: "Here" })).toBeNull();
  });

  it("renders nothing for an empty trail", () => {
    const { container } = render(<Breadcrumbs items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PageHeader", () => {
  it("has one h1 and places status, meta, description and actions", () => {
    render(
      <PageHeader
        title="AC Diagnostic Visit"
        breadcrumbs={[{ label: "Requests", href: "/app/requests" }, { label: "FF-2026-00125" }]}
        status={<span>Under review</span>}
        meta={<span>FF-2026-00125</span>}
        description="The upstairs unit blows warm air."
        actions={<button type="button">Create quotation</button>}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AC Diagnostic Visit");
    expect(screen.getByText("Under review")).toBeVisible();
    expect(screen.getByText("The upstairs unit blows warm air.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create quotation" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  });
});

describe("state components", () => {
  it("EmptyState explains and offers the next step", () => {
    render(
      <EmptyState
        icon={Inbox}
        title="You're all caught up"
        description="New requests appear here."
        action={<a href="/app/requests">View all requests</a>}
      />,
    );
    expect(screen.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
    expect(screen.getByText("New requests appear here.")).toBeVisible();
    expect(screen.getByRole("link", { name: "View all requests" })).toBeVisible();
  });

  it("ErrorState is an alert with a retry and a support reference", () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        message="We couldn't load your invoices."
        onRetry={onRetry}
        requestId="req-123"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("We couldn't load your invoices.");
    expect(alert).toHaveTextContent("req-123");
    screen.getByRole("button", { name: "Try again" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("ErrorState can retry by link for server-rendered pages", () => {
    render(<ErrorState message="Something failed." retryHref="/app/invoices?page=2" />);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/app/invoices?page=2",
    );
  });

  it("ErrorState without retry or reference shows neither", () => {
    render(<ErrorState message="Something failed." />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Reference for support/)).toBeNull();
  });

  it("PermissionDenied says why and where to go", () => {
    render(<PermissionDenied action={<a href="/portal">Go to your portal</a>} />);
    expect(
      screen.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to your portal" })).toBeVisible();
  });
});

describe("skeletons", () => {
  it.each([
    ["TableSkeleton", <TableSkeleton key="t" label="Loading requests" />, "Loading requests"],
    ["CardSkeleton", <CardSkeleton key="c" label="Loading quotation" />, "Loading quotation"],
    ["DetailSkeleton", <DetailSkeleton key="d" label="Loading request" />, "Loading request"],
  ])("%s announces what is loading and hides its placeholder blocks", (_name, element, label) => {
    const { container } = render(element);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent(label);
    const blocks = container.querySelectorAll("[aria-hidden='true']");
    expect(blocks.length).toBeGreaterThan(3);
  });

  it("TableSkeleton draws the requested number of rows", () => {
    const { container } = render(<TableSkeleton rows={3} columns={2} />);
    // header row + 3 body rows, each with 2 blocks
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(8);
  });
});

describe("Timeline", () => {
  it("lists events in the order given, with business-time stamps and actors", () => {
    render(
      <Timeline
        label="Request history"
        timeZone="America/New_York"
        events={[
          {
            id: "2",
            title: "Quotation sent",
            timestamp: "2026-10-28T14:12:00Z",
            actor: "Alex Morgan",
          },
          { id: "1", title: "Request submitted", timestamp: "2026-10-27T16:05:00Z" },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Request history" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Quotation sent");
    expect(items[0]).toHaveTextContent("Oct 28, 2026, 10:12 AM");
    expect(items[0]).toHaveTextContent("Alex Morgan");
    expect(items[1]).toHaveTextContent("Oct 27, 2026, 12:05 PM");
  });
});

describe("StatCard", () => {
  it("shows label, value and context, and links the label when given an href", () => {
    render(
      <StatCard
        label="New requests"
        value="7"
        context="2 waiting more than a day"
        href="/app/requests"
      />,
    );
    expect(screen.getByRole("link", { name: "New requests" })).toHaveAttribute(
      "href",
      "/app/requests",
    );
    expect(screen.getByText("7")).toBeVisible();
    expect(screen.getByText("2 waiting more than a day")).toBeVisible();
  });

  it("is not a link without an href", () => {
    render(<StatCard label="Jobs this week" value="12" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("document components", () => {
  const lines = [
    {
      id: "l1",
      description: "Diagnostic visit",
      quantity: "1",
      unitPrice: "89.00",
      lineTotal: "89.00",
    },
    {
      id: "l2",
      description: "Refrigerant top-up",
      quantity: "1.5",
      unitPrice: "64.00",
      lineTotal: "96.00",
    },
  ];

  it("DocumentLines shows server-calculated amounts without doing any arithmetic", () => {
    render(<DocumentLines lines={lines} currencyCode="USD" caption="Quotation lines" />);
    const table = screen.getByRole("table", { name: "Quotation lines", hidden: true });
    expect(within(table).getByText("Refrigerant top-up")).toBeInTheDocument();
    expect(within(table).getAllByText("$96.00")).not.toHaveLength(0);
    expect(within(table).getByText("1.5")).toBeInTheDocument();
  });

  it("DocumentTotals lists each row and emphasises the total", () => {
    render(
      <DocumentTotals
        currencyCode="USD"
        rows={[
          { label: "Subtotal", amount: "333.50" },
          { label: "Tax (8.00%)", amount: "26.68" },
          { label: "Total", amount: "360.18", strong: true },
        ]}
      />,
    );
    const list = screen.getByText("Subtotal").closest("dl") as HTMLElement;
    const terms = within(list)
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(terms).toEqual(["Subtotal", "Tax (8.00%)", "Total"]);
    expect(within(list).getByText("$360.18")).toBeVisible();
    expect(screen.getByText("Total").parentElement?.className).toContain("font-semibold");
  });
});
