import type { AdminRequestDto } from "@fixflow/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { adminRequest, REQUEST_ID } from "../test-fixtures";
import {
  AdminRequestDetailsCard,
  AdminRequestHistoryCard,
  RequestCancellationCard,
  RequestCustomerCard,
} from "./request-detail-cards";

const TZ = "America/New_York";

function card(heading: string): HTMLElement {
  return screen.getByRole("heading", { level: 2, name: heading }).closest("div")
    ?.parentElement as HTMLElement;
}

describe("AdminRequestDetailsCard", () => {
  it("shows what the customer sent: service, problem as typed, address, access notes, time", () => {
    render(
      <AdminRequestDetailsCard
        request={adminRequest({ updatedAt: "2026-10-31T15:00:00.000Z" })}
        timeZone={TZ}
      />,
    );

    const details = within(card("Request details"));
    expect(details.getByText("AC Repair")).toBeVisible();
    expect(details.getByText(/The unit stopped cooling\./)).toHaveClass("whitespace-pre-line");
    expect(details.getByText("214 Larkspur Lane")).toBeVisible();
    expect(details.getByText("Unit 4")).toBeVisible();
    expect(details.getByText("Harbor City, NY 10001")).toBeVisible();
    expect(details.getByText(/Gate code 4821/)).toBeVisible();
    expect(details.getByText(/Morning · Nov 10, 2026, 8:00 AM – 12:00 PM EST/)).toBeVisible();
    expect(details.getByText("Oct 30, 2026, 10:05 AM")).toBeVisible();
    expect(details.getByText("Oct 31, 2026, 11:00 AM")).toBeVisible();
  });

  it("reminds the team that the time is a preference to confirm", () => {
    render(<AdminRequestDetailsCard request={adminRequest()} timeZone={TZ} />);

    expect(screen.getByText(/A preference, not a booking/)).toBeVisible();
  });

  it("leaves out access notes that were not given", () => {
    const request = adminRequest();
    render(
      <AdminRequestDetailsCard
        request={{ ...request, address: { ...request.address, accessNotes: null } }}
        timeZone={TZ}
      />,
    );

    expect(screen.queryByText(/Access notes/)).not.toBeInTheDocument();
  });
});

describe("RequestCustomerCard", () => {
  it("shows the name and links the email and the phone number so the customer can be reached", () => {
    render(<RequestCustomerCard request={adminRequest()} timeZone={TZ} />);

    expect(screen.getByText("Amara Okafor")).toBeVisible();
    expect(screen.getByRole("link", { name: "amara.okafor@example.com" })).toHaveAttribute(
      "href",
      "mailto:amara.okafor@example.com",
    );
    expect(screen.getByRole("link", { name: "(212) 555-0142" })).toHaveAttribute(
      "href",
      "tel:(212) 555-0142",
    );
  });

  it("leads to the customer's own page, with the whole history (T13)", () => {
    render(<RequestCustomerCard request={adminRequest()} timeZone={TZ} />);

    expect(screen.getByRole("link", { name: "View full customer history" })).toHaveAttribute(
      "href",
      "/app/customers/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    );
  });

  it("says so when there is no phone number, instead of an empty link", () => {
    const request = adminRequest();
    render(
      <RequestCustomerCard
        request={{ ...request, customer: { ...request.customer, phone: null } }}
        timeZone={TZ}
      />,
    );

    expect(screen.getByText("No phone number given.")).toBeVisible();
    expect(screen.queryByRole("link", { name: /555/ })).not.toBeInTheDocument();
  });

  it("calls a first request a first request, and counts jobs and invoices truthfully", () => {
    render(<RequestCustomerCard request={adminRequest()} timeZone={TZ} />);

    expect(screen.getByText(/This is their first request\./)).toBeVisible();
    expect(screen.getByText(/0 jobs, 0 invoices\./)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Earlier requests" })).not.toBeInTheDocument();
  });

  it("lists earlier requests, each a link to its own page with its status and date", () => {
    const request: AdminRequestDto = adminRequest();
    render(
      <RequestCustomerCard
        request={{
          ...request,
          customer: {
            ...request.customer,
            totalRequests: 3,
            workOrderCount: 1,
            invoiceCount: 1,
            previousRequests: [
              {
                id: "1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22",
                reference: "FF-2026-00004",
                serviceName: "Plumbing",
                status: "CONVERTED_TO_JOB",
                statusLabel: "Converted to job",
                submittedAt: "2026-09-02T13:00:00.000Z",
              },
              {
                id: "2d8e3a2a-8b3c-4d2a-9b3f-4f1f5c9e1c33",
                reference: "FF-2026-00002",
                serviceName: "AC Repair",
                status: "CANCELLED",
                statusLabel: "Cancelled",
                submittedAt: "2026-08-14T13:00:00.000Z",
              },
            ],
          },
        }}
        timeZone={TZ}
      />,
    );

    expect(screen.getByText(/2 other requests from this customer\./)).toBeVisible();
    expect(screen.getByText(/1 job, 1 invoice\./)).toBeVisible();
    const list = screen.getByRole("heading", { name: "Earlier requests" }).nextElementSibling;
    const items = within(list as HTMLElement).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "/app/requests/1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22",
    );
    expect(within(items[0] as HTMLElement).getByRole("link")).toHaveAccessibleName(
      "FF-2026-00004 for Plumbing",
    );
    expect(within(items[0] as HTMLElement).getByText("Converted to job")).toBeVisible();
    expect(within(items[0] as HTMLElement).getByText("Sep 2, 2026")).toBeVisible();
    expect(within(items[1] as HTMLElement).getByText("Cancelled")).toBeVisible();
  });

  it("does not link to the page it is on", () => {
    render(<RequestCustomerCard request={adminRequest()} timeZone={TZ} />);

    expect(screen.queryByRole("link", { name: new RegExp(REQUEST_ID) })).not.toBeInTheDocument();
  });
});

describe("RequestCancellationCard", () => {
  const base = {
    cancelledAt: "2026-10-31T15:00:00.000Z",
    cancelledBy: { name: "Dana Whitfield" },
    reason: "Outside our service area",
    customerMessage: "Sorry, we can't reach your street.",
  };

  it("shows when, by whom and why, with the reason marked internal, and what the customer was told", () => {
    render(<RequestCancellationCard cancellation={base} timeZone={TZ} />);

    const cancellation = within(card("Cancellation"));
    expect(cancellation.getByText(/Oct 31, 2026, 11:00 AM/)).toBeVisible();
    expect(cancellation.getByText(/by Dana Whitfield/)).toBeVisible();
    expect(cancellation.getByText("Reason (internal)")).toBeVisible();
    expect(cancellation.getByText("Outside our service area")).toBeVisible();
    expect(cancellation.getByText("Sorry, we can't reach your street.")).toBeVisible();
  });

  it("says the customer saw the standard wording when no message was written", () => {
    render(
      <RequestCancellationCard cancellation={{ ...base, customerMessage: null }} timeZone={TZ} />,
    );

    expect(
      screen.getByText(/None written\. The customer saw the standard wording\./),
    ).toBeVisible();
  });

  it("copes with a cancellation whose author is unknown", () => {
    render(<RequestCancellationCard cancellation={{ ...base, cancelledBy: null }} timeZone={TZ} />);

    expect(screen.queryByText(/ by /)).not.toBeInTheDocument();
    expect(screen.getByText("Outside our service area")).toBeVisible();
  });
});

describe("AdminRequestHistoryCard", () => {
  it("says so when nothing has happened", () => {
    render(<AdminRequestHistoryCard request={adminRequest()} timeZone={TZ} />);

    expect(screen.getByText("Nothing has happened yet.")).toBeVisible();
  });

  it("shows the staff wording and who acted, marking what the customer cannot see", () => {
    render(
      <AdminRequestHistoryCard
        request={adminRequest({
          timeline: [
            {
              id: "e1",
              action: "request.note_added",
              entityType: "SERVICE_REQUEST",
              entityId: REQUEST_ID,
              fromStatus: null,
              toStatus: null,
              summary: "Internal note added by Dana Whitfield",
              publicSummary: null,
              customerVisible: false,
              metadata: {},
              actor: { name: "Dana Whitfield", role: "BUSINESS_ADMIN" },
              createdAt: "2026-10-31T15:00:00.000Z",
            },
          ],
        })}
        timeZone={TZ}
      />,
    );

    const history = screen.getByRole("list", { name: "Request history" });
    expect(within(history).getByText("Internal note added by Dana Whitfield")).toBeVisible();
    expect(within(history).getByText("Internal")).toBeVisible();
  });
});
