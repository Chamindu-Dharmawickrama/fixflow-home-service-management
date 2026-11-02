import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PORTAL_NOW,
  PORTAL_TIME_ZONE,
  quotationListItem,
  quotationSummary,
} from "../test-fixtures";
import { AwaitingDecision } from "./awaiting-decision";
import { RequestQuotationsCard } from "./request-quotations-card";

const REPLACEMENT_ID = "5a1b2c3d-0000-4000-8000-000000000002";

function renderCard(quotations: Parameters<typeof RequestQuotationsCard>[0]["quotations"]) {
  return render(
    <RequestQuotationsCard quotations={quotations} timeZone={PORTAL_TIME_ZONE} now={PORTAL_NOW} />,
  );
}

describe("RequestQuotationsCard", () => {
  it("draws nothing when the customer has not been sent a quotation", () => {
    const { container } = renderCard([]);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the quotation awaiting an answer: status, total, validity and the way to open it", () => {
    renderCard([quotationSummary()]);

    const card = screen.getByRole("region", { name: "Quotation" });
    expect(within(card).getAllByText("QT-2026-00004").length).toBeGreaterThan(0);
    expect(within(card).getByText("Sent")).toBeVisible();
    expect(within(card).getByText("$255.64")).toBeVisible();
    expect(within(card).getAllByText("Nov 17, 2026").length).toBeGreaterThan(0);
    expect(card).toHaveTextContent("Waiting for your answer — 5 days left.");
    const link = within(card).getByRole("link", { name: /Review quotation/ });
    expect(link).toHaveAttribute("href", "/portal/quotations/6f1c7a0e-5d0b-4f55-9d52-0d8d1c3b8a11");
    expect(link).toHaveAccessibleName(/^Review quotation\s+QT-2026-00004$/);
  });

  it.each([
    ["ACCEPTED", "You accepted it on Nov 5, 2026. We'll contact you to schedule the work."],
    ["DECLINED", "You declined it on Nov 5, 2026. No work will be scheduled from it."],
  ] as const)("tells the customer what they did when it is %s", (status, sentence) => {
    renderCard([quotationSummary({ status, respondedAt: "2026-11-05T16:30:00.000Z" })]);

    expect(screen.getByTestId("current-quotation")).toHaveTextContent(sentence);
  });

  it("says an expired quotation expired and how to get a new one", () => {
    renderCard([quotationSummary({ status: "EXPIRED", validUntil: "2026-11-10" })]);

    expect(screen.getByTestId("current-quotation")).toHaveTextContent(
      "It expired after Nov 10, 2026. Contact us for an updated quote.",
    );
  });

  it("says a withdrawn quotation was withdrawn", () => {
    renderCard([quotationSummary({ status: "VOID" })]);

    expect(screen.getByTestId("current-quotation")).toHaveTextContent(
      "We withdrew it. It can no longer be accepted.",
    );
  });

  it("leads with the current quotation and lists the earlier ones, each pointing to its replacement", () => {
    renderCard([
      quotationSummary({ id: REPLACEMENT_ID, reference: "QT-2026-00005", totalAmount: "300.00" }),
      quotationSummary({
        reference: "QT-2026-00004",
        status: "VOID",
        replacedBy: { id: REPLACEMENT_ID, reference: "QT-2026-00005" },
      }),
    ]);

    const card = screen.getByRole("region", { name: "Current quotation" });
    const current = within(card).getByTestId("current-quotation");
    expect(current).toHaveTextContent("QT-2026-00005");
    expect(current).toHaveTextContent("$300.00");
    const earlier = within(card).getByRole("list");
    expect(within(earlier).getByRole("link", { name: "QT-2026-00004" })).toHaveAttribute(
      "href",
      "/portal/quotations/6f1c7a0e-5d0b-4f55-9d52-0d8d1c3b8a11",
    );
    expect(within(earlier).getByText("Void")).toBeVisible();
    expect(within(earlier).getByRole("link", { name: "QT-2026-00005" })).toHaveAttribute(
      "href",
      `/portal/quotations/${REPLACEMENT_ID}`,
    );
  });

  it("shows no list of earlier versions when there is only one", () => {
    renderCard([quotationSummary()]);

    expect(screen.queryByRole("heading", { name: "Earlier versions" })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

function renderAwaiting(quotations: Parameters<typeof AwaitingDecision>[0]["quotations"]) {
  return render(
    <AwaitingDecision quotations={quotations} timeZone={PORTAL_TIME_ZONE} now={PORTAL_NOW} />,
  );
}

describe("AwaitingDecision", () => {
  it("draws nothing when no quotation is waiting for an answer", () => {
    const { container } = renderAwaiting([]);

    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing for a quotation that is not waiting, whatever it was given", () => {
    const { container } = renderAwaiting([quotationListItem({ status: "EXPIRED" })]);

    expect(container).toBeEmptyDOMElement();
  });

  it("lists each quotation with its total and how long is left, and links to it", () => {
    renderAwaiting([
      quotationListItem(),
      quotationListItem({
        id: REPLACEMENT_ID,
        reference: "QT-2026-00009",
        serviceName: "Gutter Cleaning",
        totalAmount: "89.50",
        validUntil: "2026-11-20",
      }),
    ]);

    const section = screen.getByRole("region", { name: "Awaiting your decision" });
    expect(section).toHaveTextContent("We sent you 2 quotations");
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("QT-2026-00004");
    expect(items[0]).toHaveTextContent("AC Repair");
    expect(items[0]).toHaveTextContent("Total $255.64. Valid until Nov 17, 2026 — 5 days left.");
    expect(items[1]).toHaveTextContent("Gutter Cleaning");
    expect(items[1]).toHaveTextContent("$89.50");
    expect(items[1]).toHaveTextContent("8 days left");
    expect(
      within(section).getByRole("link", { name: /^Review quotation\s+QT-2026-00009$/ }),
    ).toHaveAttribute("href", `/portal/quotations/${REPLACEMENT_ID}`);
  });

  it("speaks of a single quotation in the singular", () => {
    renderAwaiting([quotationListItem()]);

    expect(screen.getByRole("region", { name: "Awaiting your decision" })).toHaveTextContent(
      "We sent you a quotation.",
    );
  });

  it("nudges a quotation that is running out", () => {
    renderAwaiting([quotationListItem({ validUntil: "2026-11-12" })]);

    expect(screen.getByText("— last day to answer")).toHaveClass("text-attention");
  });
});
