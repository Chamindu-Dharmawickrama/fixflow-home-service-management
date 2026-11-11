import type { CustomerOverviewDto } from "@fixflow/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  customerInvoiceListItem,
  customerJobListItem,
  PORTAL_NOW,
  PORTAL_TIME_ZONE,
  quotationListItem,
} from "../test-fixtures";
import { PortalOverview } from "./portal-overview";

const PROFILE = {
  name: "Alex Morgan",
  email: "alex.morgan@example.test",
  phone: null,
  addresses: [],
};

const EMPTY: CustomerOverviewDto = {
  actionRequired: {
    quotations: { items: [], totalItems: 0 },
    invoices: { items: [], totalItems: 0 },
  },
  upcomingVisits: { items: [], totalItems: 0 },
  recentRequests: { items: [], totalItems: 0 },
  counts: { actionRequired: 0, upcomingVisits: 0, requests: 0 },
};

const REQUEST = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  reference: "FF-2026-00012",
  status: "SUBMITTED",
  statusLabel: "Submitted",
  nextStep: "We'll review your request.",
  serviceName: "AC Repair",
  preferredDate: "2026-03-10",
  preferredWindow: "MORNING",
  submittedAt: "2026-03-02T15:00:00.000Z",
} as const;

function renderOverview(overview: CustomerOverviewDto) {
  return render(
    <PortalOverview
      name="Alex Morgan"
      overview={overview}
      profile={PROFILE}
      timeZone={PORTAL_TIME_ZONE}
      now={PORTAL_NOW}
    />,
  );
}

const BUSY: CustomerOverviewDto = {
  actionRequired: {
    quotations: { items: [quotationListItem()], totalItems: 1 },
    invoices: { items: [customerInvoiceListItem()], totalItems: 1 },
  },
  upcomingVisits: { items: [customerJobListItem()], totalItems: 1 },
  recentRequests: { items: [REQUEST], totalItems: 1 },
  counts: { actionRequired: 2, upcomingVisits: 1, requests: 1 },
};

describe("PortalOverview", () => {
  it("leads with a prominent way to request a service", () => {
    renderOverview(BUSY);
    expect(screen.getByRole("heading", { level: 1, name: "Hello, Alex Morgan" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Request a service" })[0]).toHaveAttribute(
      "href",
      "/request-service",
    );
  });

  it("puts what needs the customer first, under one Action required heading", () => {
    renderOverview(BUSY);
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings.slice(0, 4)).toEqual([
      "Hello, Alex Morgan",
      "Action required",
      "Awaiting your decision",
      "Outstanding invoices",
    ]);
    const section = screen.getByRole("region", { name: "Action required" });
    expect(within(section).getByRole("link", { name: /Review quotation/ })).toBeVisible();
    // The cards under the heading are third-level: they belong to it.
    expect(
      within(section).getByRole("heading", { level: 3, name: "Awaiting your decision" }),
    ).toBeVisible();
  });

  it("follows with the upcoming visits and the recent requests", () => {
    renderOverview(BUSY);
    expect(screen.getByRole("region", { name: "Upcoming visits" })).toBeVisible();
    const recent = screen.getByRole("region", { name: "Your requests" });
    expect(within(recent).getByText("FF-2026-00012")).toBeVisible();
  });

  it("draws no Action required section when nothing needs the customer", () => {
    renderOverview({
      ...BUSY,
      actionRequired: {
        quotations: { items: [], totalItems: 0 },
        invoices: { items: [], totalItems: 0 },
      },
      counts: { actionRequired: 0, upcomingVisits: 1, requests: 1 },
    });
    expect(screen.queryByRole("heading", { name: "Action required" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Upcoming visits" })).toBeVisible();
  });

  it("welcomes a new customer and offers the first step instead of empty lists", () => {
    renderOverview(EMPTY);
    expect(screen.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Request a service" })).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Upcoming visits" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your requests" })).not.toBeInTheDocument();
    // Their profile is still there.
    expect(screen.getByRole("heading", { name: "Your profile" })).toBeVisible();
  });

  it("does not welcome a customer who has sent a request, even with nothing to do yet", () => {
    renderOverview({
      ...EMPTY,
      recentRequests: { items: [REQUEST], totalItems: 1 },
      counts: { actionRequired: 0, upcomingVisits: 0, requests: 1 },
    });
    expect(screen.queryByRole("heading", { name: /Welcome/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Upcoming visits" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Your requests" })).toBeVisible();
  });
});
