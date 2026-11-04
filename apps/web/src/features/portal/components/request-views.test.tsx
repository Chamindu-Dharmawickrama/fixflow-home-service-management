import type {
  CustomerRequestDto,
  CustomerRequestListItemDto,
  ServiceRequestStatus,
} from "@fixflow/shared";
import { REQUEST_NEXT_STEPS, REQUEST_STATUS_LABELS } from "@fixflow/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { STATUS_META } from "@/lib/formatting";

import { RecentRequests } from "./recent-requests";
import { RequestConfirmation } from "./request-confirmation";
import {
  formatPreferredTime,
  NextStepCard,
  RequestDetailsCard,
  RequestHistoryCard,
  RequestNotesCard,
} from "./request-details";
import { RequestsTable } from "./requests-table";

const TZ = "America/New_York";

function item(overrides: Partial<CustomerRequestListItemDto> = {}): CustomerRequestListItemDto {
  return {
    id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    reference: "FF-2026-00012",
    status: "SUBMITTED",
    statusLabel: "Submitted",
    nextStep: REQUEST_NEXT_STEPS.SUBMITTED,
    serviceName: "AC Repair",
    preferredDate: "2026-11-10",
    preferredWindow: "MORNING",
    submittedAt: "2026-10-30T14:05:00.000Z",
    ...overrides,
  };
}

function request(overrides: Partial<CustomerRequestDto> = {}): CustomerRequestDto {
  return {
    ...item(),
    description: "The unit stopped cooling.\nIt rattles when it starts.",
    address: {
      line1: "214 Larkspur Lane",
      line2: "Unit 4",
      city: "Harbor City",
      region: "NY",
      postalCode: "10001",
      accessNotes: "Gate code 4821",
    },
    preferredStart: "2026-11-10T13:00:00.000Z",
    preferredEnd: "2026-11-10T17:00:00.000Z",
    cancellation: null,
    quotations: [],
    job: null,
    notes: [],
    timeline: [],
    ...overrides,
  };
}

describe("the status wording stays in step with the web app's status table", () => {
  it.each(Object.keys(REQUEST_STATUS_LABELS) as ServiceRequestStatus[])(
    "agrees with the badge for %s",
    (status) => {
      expect(STATUS_META.request[status].label).toBe(REQUEST_STATUS_LABELS[status]);
    },
  );
});

describe("RequestConfirmation (spec §7.1 step 6)", () => {
  it("shows the reference, the Submitted status and what happens next", () => {
    render(<RequestConfirmation reference="FF-2026-00012" />);

    const panel = screen.getByRole("region", { name: "Your request has been sent" });
    expect(within(panel).getByText("FF-2026-00012")).toBeVisible();
    expect(within(panel).getByText("Submitted")).toBeVisible();
    expect(within(panel).getByRole("heading", { name: "What happens next" })).toBeVisible();
    expect(within(panel).getAllByRole("listitem")).toHaveLength(3);
  });

  it("takes focus, so a screen reader announces that the request went through", () => {
    render(<RequestConfirmation reference="FF-2026-00012" />);

    expect(screen.getByRole("heading", { name: "Your request has been sent" })).toHaveFocus();
  });

  it("leads on to the list and to another request", () => {
    render(<RequestConfirmation reference="FF-2026-00012" />);

    expect(screen.getByRole("link", { name: "View all my requests" })).toHaveAttribute(
      "href",
      "/portal/requests",
    );
    expect(screen.getByRole("link", { name: "Request another service" })).toHaveAttribute(
      "href",
      "/request-service",
    );
  });

  it("does not claim that an email was sent (the server cannot promise that)", () => {
    render(<RequestConfirmation reference="FF-2026-00012" />);

    expect(document.body.textContent).not.toMatch(/e-?mail/i);
  });
});

describe("formatPreferredTime: the window on the business's clock", () => {
  it("reads in winter time (EST) in New York", () => {
    expect(formatPreferredTime(request(), TZ)).toBe(
      "Morning · Nov 10, 2026, 8:00 AM – 12:00 PM EST",
    );
  });

  it("reads in summer time (EDT) in New York", () => {
    expect(
      formatPreferredTime(
        request({
          preferredWindow: "AFTERNOON",
          preferredStart: "2027-07-15T16:00:00.000Z",
          preferredEnd: "2027-07-15T20:00:00.000Z",
        }),
        TZ,
      ),
    ).toBe("Afternoon · Jul 15, 2027, 12:00 – 4:00 PM EDT");
  });

  it("shows the calendar day of the business, not of UTC, for an evening window", () => {
    // 21:00-00:00 UTC is 16:00-19:00 in New York, still the same local day.
    expect(
      formatPreferredTime(
        request({
          preferredWindow: "EVENING",
          preferredStart: "2026-12-15T21:00:00.000Z",
          preferredEnd: "2026-12-16T00:00:00.000Z",
        }),
        TZ,
      ),
    ).toBe("Evening · Dec 15, 2026, 4:00 – 7:00 PM EST");
  });

  it("uses the business's zone, so the same instants read differently elsewhere", () => {
    expect(formatPreferredTime(request(), "America/Los_Angeles")).toBe(
      "Morning · Nov 10, 2026, 5:00 – 9:00 AM PST",
    );
  });

  it("is right on the day the clocks go forward (2026-03-08: EDT from 03:00)", () => {
    expect(
      formatPreferredTime(
        request({
          preferredStart: "2026-03-08T12:00:00.000Z",
          preferredEnd: "2026-03-08T16:00:00.000Z",
        }),
        TZ,
      ),
    ).toBe("Morning · Mar 8, 2026, 8:00 AM – 12:00 PM EDT");
  });
});

describe("the request's cards", () => {
  it("What happens next: the sentence for the status, and the preference note while it is open", () => {
    const { rerender } = render(<NextStepCard request={request()} />);

    expect(screen.getByText(REQUEST_NEXT_STEPS.SUBMITTED)).toBeVisible();
    expect(screen.getByText(/preference/)).toBeVisible();

    rerender(
      <NextStepCard
        request={request({
          status: "CANCELLED",
          statusLabel: "Cancelled",
          nextStep: REQUEST_NEXT_STEPS.CANCELLED,
        })}
      />,
    );

    expect(screen.getByText(REQUEST_NEXT_STEPS.CANCELLED)).toBeVisible();
    expect(screen.queryByText(/preference/)).not.toBeInTheDocument();
  });

  describe("What happens next, for a cancelled request", () => {
    const cancelled = {
      status: "CANCELLED" as const,
      statusLabel: "Cancelled",
      nextStep: REQUEST_NEXT_STEPS.CANCELLED,
    };

    it("shows the message the business chose to send", () => {
      render(
        <NextStepCard
          request={request({
            ...cancelled,
            cancellation: {
              cancelledAt: "2026-10-31T15:00:00.000Z",
              message: "We can't reach your street this month.\nSorry about that.",
            },
          })}
        />,
      );

      const message = screen.getByText(/We can't reach your street this month\./);
      expect(message).toBeVisible();
      expect(message).toHaveClass("whitespace-pre-line");
      expect(screen.getByText("Message from us")).toBeVisible();
    });

    it("shows no message box when the business sent none", () => {
      render(
        <NextStepCard
          request={request({
            ...cancelled,
            cancellation: { cancelledAt: "2026-10-31T15:00:00.000Z", message: null },
          })}
        />,
      );

      expect(screen.getByText(REQUEST_NEXT_STEPS.CANCELLED)).toBeVisible();
      expect(screen.queryByText("Message from us")).not.toBeInTheDocument();
    });

    it("shows no message box for a request that was not cancelled", () => {
      render(<NextStepCard request={request()} />);

      expect(screen.queryByText("Message from us")).not.toBeInTheDocument();
    });
  });

  it("Request details: service, problem as typed, address with access notes, time and sent date", () => {
    render(<RequestDetailsCard request={request()} timeZone={TZ} />);

    const details = screen.getByRole("heading", { name: "Request details" }).closest("div")
      ?.parentElement as HTMLElement;
    expect(within(details).getByText("AC Repair")).toBeVisible();
    expect(within(details).getByText(/The unit stopped cooling\./)).toBeVisible();
    expect(within(details).getByText("214 Larkspur Lane")).toBeVisible();
    expect(within(details).getByText("Unit 4")).toBeVisible();
    expect(within(details).getByText("Harbor City, NY 10001")).toBeVisible();
    expect(within(details).getByText(/Gate code 4821/)).toBeVisible();
    expect(
      within(details).getByText(/Morning · Nov 10, 2026, 8:00 AM – 12:00 PM EST/),
    ).toBeVisible();
    expect(within(details).getByText("Oct 30, 2026, 10:05 AM")).toBeVisible();
  });

  it("Request details: leaves out access notes that were not given", () => {
    render(
      <RequestDetailsCard
        request={request({ address: { ...request().address, accessNotes: null } })}
        timeZone={TZ}
      />,
    );

    expect(screen.queryByText(/Access notes/)).not.toBeInTheDocument();
  });

  it("Messages: says there are none, and where they will appear", () => {
    render(<RequestNotesCard request={request()} timeZone={TZ} />);

    expect(screen.getByText(/No messages yet/)).toBeVisible();
  });

  it("Messages: lists what the business shared, with who wrote it and when", () => {
    render(
      <RequestNotesCard
        request={request({
          notes: [
            {
              id: "n1",
              body: "We will bring a replacement capacitor.",
              author: "CoolBreeze Home Services",
              createdAt: "2026-10-31T15:00:00.000Z",
            },
          ],
        })}
        timeZone={TZ}
      />,
    );

    expect(screen.getByText("We will bring a replacement capacitor.")).toBeVisible();
    expect(screen.getByText(/CoolBreeze Home Services ·/)).toBeVisible();
  });

  it("History: the customer's timeline, in the order given", () => {
    render(
      <RequestHistoryCard
        request={request({
          timeline: [
            {
              id: "e1",
              publicSummary: "You submitted your request.",
              toStatus: "SUBMITTED",
              actor: "You",
              createdAt: "2026-10-30T14:05:00.000Z",
            },
          ],
        })}
        timeZone={TZ}
      />,
    );

    const history = screen.getByRole("list", { name: "Request history" });
    expect(within(history).getByText("You submitted your request.")).toBeVisible();
  });

  it("History: says so when nothing has happened", () => {
    render(<RequestHistoryCard request={request()} timeZone={TZ} />);

    expect(screen.getByText("Nothing has happened yet.")).toBeVisible();
  });
});

describe("RecentRequests (the overview)", () => {
  it("lists the latest requests, each a link to its own page, with status and next step", () => {
    render(
      <RecentRequests
        requests={[
          item(),
          item({
            id: "1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22",
            reference: "FF-2026-00011",
            serviceName: "Home Deep Cleaning",
            status: "QUOTED",
            nextStep: REQUEST_NEXT_STEPS.QUOTED,
          }),
        ]}
        totalItems={5}
        timeZone={TZ}
      />,
    );

    const region = screen.getByRole("region", { name: "Your requests" });
    const links = within(region).getAllByRole("link", { name: /FF-2026-/ });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/portal/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
      "/portal/requests/1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22",
    ]);
    expect(links[0]).toHaveAccessibleName("FF-2026-00012 for AC Repair");
    expect(within(region).getByText("Quoted")).toBeVisible();
    expect(within(region).getByText(REQUEST_NEXT_STEPS.QUOTED, { exact: false })).toBeVisible();
    expect(within(region).getByRole("link", { name: "View all requests (5)" })).toHaveAttribute(
      "href",
      "/portal/requests",
    );
    // The overview's header already has the button; the card does not repeat it beside a list.
    expect(within(region).queryByRole("link", { name: "Request a service" })).toBeNull();
  });

  it("invites the first request when there are none, with no list link", () => {
    render(<RecentRequests requests={[]} totalItems={0} timeZone={TZ} />);

    const region = screen.getByRole("region", { name: "Your requests" });
    expect(within(region).getByText(/You haven't sent a request yet/)).toBeVisible();
    expect(within(region).getByRole("link", { name: "Request a service" })).toHaveAttribute(
      "href",
      "/request-service",
    );
    expect(within(region).queryByRole("link", { name: /View all requests/ })).toBeNull();
  });
});

describe("RequestsTable", () => {
  it("shows reference, service, status, sent date and next step, and opens a request by its id", () => {
    render(<RequestsTable requests={[item()]} timeZone={TZ} />);

    const table = screen.getByRole("table", { name: "Your service requests" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Reference", "Service", "Status", "Submitted", "What happens next"]);
    const row = within(table).getAllByRole("row")[1] as HTMLElement;
    expect(within(row).getByRole("link", { name: "FF-2026-00012" })).toHaveAttribute(
      "href",
      "/portal/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    );
    expect(within(row).getByText("AC Repair")).toBeVisible();
    expect(within(row).getByText("Submitted")).toBeVisible();
    expect(within(row).getByText("Oct 30, 2026")).toBeVisible();
    expect(within(row).getByText(REQUEST_NEXT_STEPS.SUBMITTED)).toBeVisible();
  });

  it("shows the sent date on the business's calendar, not UTC's", () => {
    // 03:30 UTC on 31 October is 23:30 on 30 October in New York.
    render(
      <RequestsTable
        requests={[item({ submittedAt: "2026-10-31T03:30:00.000Z" })]}
        timeZone={TZ}
      />,
    );

    expect(screen.getAllByText("Oct 30, 2026").length).toBeGreaterThan(0);
  });
});
