import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  customerQuotation,
  PORTAL_NOW,
  PORTAL_QUOTATION_ID,
  PORTAL_REQUEST_ID,
  PORTAL_TIME_ZONE,
} from "../test-fixtures";
import { QuotationBanner } from "./quotation-banner";

function banner(
  overrides: Parameters<typeof customerQuotation>[0] = {},
  now: Date = PORTAL_NOW,
): HTMLElement {
  render(
    <QuotationBanner
      quotation={customerQuotation(overrides)}
      timeZone={PORTAL_TIME_ZONE}
      now={now}
    />,
  );
  return screen.getByTestId("quotation-banner");
}

describe("QuotationBanner: a quotation awaiting an answer", () => {
  it("says until when it is valid and how many days are left", () => {
    const element = banner();

    expect(element).toHaveTextContent("Valid until Nov 17, 2026 — 5 days left");
    expect(element).toHaveTextContent("Nothing is scheduled until you accept");
    expect(element).toHaveAttribute("role", "status");
  });

  it("counts the days on the business calendar", () => {
    expect(banner({ validUntil: "2026-11-13" })).toHaveTextContent("— 1 day left");
  });

  it("is calm with time to spare and nudges when it is running out", () => {
    expect(banner()).toHaveAttribute("data-tone", "info");
  });

  it("nudges on the last day, which is still open", () => {
    const element = banner({ validUntil: "2026-11-12" });

    expect(element).toHaveAttribute("data-tone", "attention");
    expect(element).toHaveTextContent("last day to answer");
  });
});

describe("QuotationBanner: a quotation that was answered", () => {
  it("tells the customer they accepted it, and when", () => {
    const element = banner({ status: "ACCEPTED", respondedAt: "2026-11-05T16:30:00.000Z" });

    expect(element).toHaveTextContent("You accepted this quotation on Nov 5, 2026");
    expect(element).toHaveTextContent("We'll contact you to schedule the work");
    expect(element).toHaveAttribute("data-tone", "success");
  });

  it("tells the customer they declined it, and how to change their mind", () => {
    const element = banner({ status: "DECLINED", respondedAt: "2026-11-05T16:30:00.000Z" });

    expect(element).toHaveTextContent("You declined this quotation on Nov 5, 2026");
    expect(element).toHaveTextContent("No work will be scheduled");
    expect(within(element).getByRole("link", { name: "(212) 555-0142" })).toHaveAttribute(
      "href",
      "tel:2125550142",
    );
    expect(within(element).getByRole("link", { name: "hello@coolbreeze.test" })).toHaveAttribute(
      "href",
      "mailto:hello@coolbreeze.test",
    );
  });

  it("reads the day of the answer on the business calendar, not UTC", () => {
    // 02:00 UTC on 6 November is the evening of the 5th in New York.
    const element = banner({ status: "ACCEPTED", respondedAt: "2026-11-06T02:00:00.000Z" });

    expect(element).toHaveTextContent("on Nov 5, 2026");
  });
});

describe("QuotationBanner: a quotation that can no longer be answered", () => {
  it("says it expired, and how to get an updated quote", () => {
    const element = banner({ status: "EXPIRED", validUntil: "2026-11-10" });

    expect(element).toHaveTextContent(
      "This quotation has expired — contact us for an updated quote",
    );
    expect(element).toHaveTextContent("It was valid until Nov 10, 2026");
    expect(within(element).getByRole("link", { name: "hello@coolbreeze.test" })).toBeVisible();
  });

  it("says it was withdrawn and sends the customer to their request", () => {
    const element = banner({ status: "VOID" });

    expect(element).toHaveTextContent("This quotation was withdrawn");
    expect(element).toHaveTextContent("It can no longer be accepted");
    expect(within(element).getByRole("link", { name: "Check your request" })).toHaveAttribute(
      "href",
      `/portal/requests/${PORTAL_REQUEST_ID}`,
    );
  });

  it("points a withdrawn quotation to the one that replaced it", () => {
    const element = banner({
      status: "VOID",
      replacedBy: { id: "5a1b2c3d-0000-4000-8000-000000000002", reference: "QT-2026-00005" },
    });

    expect(element).toHaveTextContent("We've sent you a new quotation to replace it");
    expect(within(element).getByRole("link", { name: "Review QT-2026-00005" })).toHaveAttribute(
      "href",
      "/portal/quotations/5a1b2c3d-0000-4000-8000-000000000002",
    );
    expect(within(element).queryByRole("link", { name: "Check your request" })).toBeNull();
  });

  it("never says anything about why the business withdrew it", () => {
    const element = banner({ status: "VOID" });

    expect(element.textContent).not.toMatch(/internal|margin|reason/i);
  });

  it("draws nothing for a draft", () => {
    render(
      <QuotationBanner
        quotation={customerQuotation({ id: PORTAL_QUOTATION_ID, status: "DRAFT", preview: true })}
        timeZone={PORTAL_TIME_ZONE}
        now={PORTAL_NOW}
      />,
    );

    expect(screen.queryByTestId("quotation-banner")).toBeNull();
  });
});
