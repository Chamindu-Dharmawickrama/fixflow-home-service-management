import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  adminCustomer,
  CUSTOMER_ID,
  historyInvoice,
  historyJob,
  historyQuotation,
  historyRequest,
  historyResponse,
  REQUEST_ID,
} from "../test-fixtures";
import {
  type CustomerHistoryPage,
  CustomerHistoryPanel,
  CustomerHistoryTabs,
} from "./customer-history";

const TZ = "America/New_York";
const NAME = "Amara Okafor";

function panel(page: CustomerHistoryPage, params: Record<string, string> = {}) {
  return render(
    <CustomerHistoryPanel
      customerId={CUSTOMER_ID}
      customerName={NAME}
      tab={page.tab}
      page={page}
      timeZone={TZ}
      params={{ tab: page.tab, ...params }}
    />,
  );
}

const tableRow = (name: string, index = 1) =>
  within(screen.getByRole("table", { name })).getAllByRole("row")[index] as HTMLElement;

describe("CustomerHistoryTabs", () => {
  const summary = adminCustomer().summary;

  it("has the four tabs in the order of the journey, each with its count", () => {
    render(
      <CustomerHistoryTabs customerId={CUSTOMER_ID} summary={summary} tab="requests" params={{}} />,
    );

    const links = within(screen.getByRole("navigation", { name: "Customer history" })).getAllByRole(
      "link",
    );
    expect(links.map((link) => link.textContent)).toEqual([
      "Requests 3",
      "Quotations 2",
      "Jobs 2",
      "Invoices 1",
    ]);
  });

  it("marks the open tab, and every tab leads to its own address on its first page", () => {
    render(
      <CustomerHistoryTabs
        customerId={CUSTOMER_ID}
        summary={summary}
        tab="jobs"
        params={{ tab: "jobs", page: "3" }}
      />,
    );

    expect(screen.getByRole("link", { name: /^Jobs/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^Requests/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /^Invoices/ })).toHaveAttribute(
      "href",
      `/app/customers/${CUSTOMER_ID}?tab=invoices`,
    );
  });
});

describe("CustomerHistoryPanel: requests", () => {
  it("shows each request with its status, service and times, the reference the link to it", () => {
    panel({ tab: "requests", response: historyResponse([historyRequest()]) });

    expect(
      within(screen.getByRole("table", { name: "Requests" }))
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Reference", "Service", "Status", "Preferred time", "Submitted"]);

    const row = within(tableRow("Requests"));
    expect(row.getByRole("link", { name: /FF-2026-00012/ })).toHaveAttribute(
      "href",
      `/app/requests/${REQUEST_ID}`,
    );
    expect(row.getByText("AC Repair")).toBeVisible();
    expect(row.getByText("Under review")).toBeVisible();
    expect(row.getByText("Nov 10, 2026")).toBeVisible();
    expect(row.getByText("Morning")).toBeVisible();
    expect(row.getByText("Oct 30, 2026")).toBeVisible();
  });
});

describe("CustomerHistoryPanel: quotations", () => {
  it("shows the status, the money and the dates, and the request it belongs to as a link", () => {
    panel({ tab: "quotations", response: historyResponse([historyQuotation()]) });

    const row = within(tableRow("Quotations"));
    expect(row.getByText("QT-2026-00004")).toBeVisible();
    expect(row.getByText("Sent", { selector: "span" })).toBeVisible();
    expect(row.getByText("$108.00")).toBeVisible();
    expect(row.getByText("Dec 1, 2026")).toBeVisible();
    expect(row.getByText("Oct 31, 2026")).toBeVisible();
    expect(row.getByRole("link", { name: /FF-2026-00012/ })).toHaveAttribute(
      "href",
      `/app/requests/${REQUEST_ID}`,
    );
  });

  it("does not link the quotation itself: it has no page yet", () => {
    panel({ tab: "quotations", response: historyResponse([historyQuotation()]) });

    const links = within(tableRow("Quotations")).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", `/app/requests/${REQUEST_ID}`);
  });

  it("says a draft was not sent", () => {
    panel({
      tab: "quotations",
      response: historyResponse([historyQuotation({ status: "DRAFT", sentAt: null })]),
    });

    expect(within(tableRow("Quotations")).getByText("Not sent")).toBeVisible();
  });
});

describe("CustomerHistoryPanel: jobs", () => {
  it("shows the status and when it is booked, and says so when it is not", () => {
    panel({
      tab: "jobs",
      response: historyResponse([
        historyJob(),
        historyJob({
          id: "j-2",
          reference: "JOB-2026-00003",
          status: "PENDING_SCHEDULING",
          scheduledStart: null,
        }),
      ]),
    });

    const booked = within(tableRow("Jobs", 1));
    expect(booked.getByText("JOB-2026-00002")).toBeVisible();
    expect(booked.getByText("Scheduled", { selector: "span" })).toBeVisible();
    expect(booked.getByText("Nov 12, 2026, 9:00 AM")).toBeVisible();

    const waiting = within(tableRow("Jobs", 2));
    expect(waiting.getByText("Not scheduled yet")).toBeVisible();
    expect(waiting.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows when a job was completed", () => {
    panel({
      tab: "jobs",
      response: historyResponse([
        historyJob({ status: "COMPLETED", completedAt: "2026-11-12T20:00:00.000Z" }),
      ]),
    });

    expect(within(tableRow("Jobs")).getByText("Nov 12, 2026")).toBeVisible();
  });
});

describe("CustomerHistoryPanel: invoices", () => {
  it("shows the total, what was paid and what is owed, as money in the invoice's currency", () => {
    panel({ tab: "invoices", response: historyResponse([historyInvoice()]) });

    const row = within(tableRow("Invoices"));
    expect(row.getByText("INV-2026-00007")).toBeVisible();
    expect(row.getByText("$216.00")).toBeVisible();
    expect(row.getByText("$40.50")).toBeVisible();
    expect(row.getByText("$175.50")).toBeVisible();
    expect(row.getByText("Nov 14, 2026")).toBeVisible();
  });

  it("calls an invoice that has no number yet a draft", () => {
    panel({
      tab: "invoices",
      response: historyResponse([
        historyInvoice({
          status: "DRAFT",
          invoiceNumber: null,
          dueDate: null,
          issuedAt: null,
          amountPaid: "0.00",
          balanceDue: "0.00",
        }),
      ]),
    });

    const row = within(tableRow("Invoices"));
    expect(row.getByText("Draft", { selector: "span.text-ink-secondary" })).toBeVisible();
    expect(row.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("CustomerHistoryPanel: empty tabs", () => {
  it.each([
    ["requests", "No requests yet", /hasn't sent a service request/],
    ["quotations", "No quotations yet", /quotations you prepare for Amara Okafor/],
    ["jobs", "No jobs yet", /A job starts when Amara Okafor accepts a quotation/],
    ["invoices", "No invoices yet", /invoices for Amara Okafor's completed jobs/],
  ] as const)("guides the %s tab", (tab, title, description) => {
    panel({ tab, response: historyResponse([]) });

    expect(screen.getByRole("heading", { level: 3, name: title })).toBeVisible();
    expect(screen.getByText(description)).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });

  it("offers no button to a feature that does not exist yet", () => {
    panel({ tab: "quotations", response: historyResponse([]) });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("CustomerHistoryPanel: pages", () => {
  it("pages the open tab, keeping the tab in the address", () => {
    const rows = Array.from({ length: 10 }, (_unused, index) =>
      historyRequest({ id: `r-${index}`, reference: `FF-2026-0010${index}` }),
    );
    panel(
      {
        tab: "requests",
        response: {
          data: rows,
          pagination: { page: 2, pageSize: 10, totalItems: 25, totalPages: 3 },
        },
      },
      { page: "2" },
    );

    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 11–20 of 25 requests");
    const pagination = within(screen.getByRole("navigation", { name: "Pagination" }));
    expect(pagination.getByRole("link", { name: "Go to next page" })).toHaveAttribute(
      "href",
      `/app/customers/${CUSTOMER_ID}?tab=requests&page=3`,
    );
    expect(pagination.getByRole("link", { name: "Go to previous page" })).toHaveAttribute(
      "href",
      `/app/customers/${CUSTOMER_ID}?tab=requests`,
    );
  });

  it("names what it is counting", () => {
    panel({ tab: "invoices", response: historyResponse([historyInvoice()]) });

    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1–1 of 1 invoices");
  });
});
