import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { adminQuotation, adminRequest, QUOTATION_ID, REQUEST_ID } from "../test-fixtures";
import { QuotationActions } from "./quotation-actions";
import { QuotationDocument } from "./quotation-document";
import {
  QuotationChainCard,
  QuotationDetailsCard,
  QuotationHistoryCard,
  QuotationStatusBanner,
} from "./quotation-readonly-cards";
import { RequestQuotationsCard } from "./request-quotations-card";

const refresh = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/components/ui/sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn(), info: toastInfo },
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const TZ = "America/New_York";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QuotationDocument", () => {
  const sent = adminQuotation({
    status: "SENT",
    statusLabel: "Sent",
    sentAt: "2026-11-03T15:00:00.000Z",
    discountAmount: "25.20",
    taxableBase: "40.95",
    taxAmount: "3.28",
    totalAmount: "230.08",
    customerNote: "Parts are in stock.",
  });

  it("prints who it is from and for, with the dates in the business time zone", () => {
    render(<QuotationDocument quotation={sent} timeZone={TZ} />);

    const document = screen.getByTestId("quotation-document");
    expect(within(document).getByRole("heading", { name: "QT-2026-00004" })).toBeVisible();
    expect(within(document).getByText("CoolBreeze Home Services")).toBeVisible();
    expect(within(document).getByText("48 Harbor Point Road")).toBeVisible();
    expect(within(document).getByText("(212) 555-0142")).toBeVisible();
    expect(within(document).getByText("Amara Okafor")).toBeVisible();
    expect(within(document).getByText("214 Larkspur Lane")).toBeVisible();
    expect(within(document).getByText(/Sent/)).toHaveTextContent("Sent Nov 3, 2026");
    expect(within(document).getByText(/Valid until/)).toHaveTextContent("Valid until Nov 17, 2026");
    expect(within(document).getByText("For request FF-2026-00012")).toBeVisible();
  });

  it("says a draft has not been sent", () => {
    render(<QuotationDocument quotation={adminQuotation()} timeZone={TZ} />);
    expect(screen.getByText("Not sent yet")).toBeVisible();
  });

  it("shows each line with its server total, and which lines carry tax", () => {
    render(<QuotationDocument quotation={sent} timeZone={TZ} />);

    const table = screen.getByRole("table", { name: "Lines of quotation QT-2026-00004" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4); // header + 3 lines
    expect(within(rows[1] as HTMLElement).getByText("Diagnostic visit")).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText("No tax")).toBeVisible();
    expect(within(rows[2] as HTMLElement).getByText("Taxed")).toBeVisible();
    expect(within(rows[3] as HTMLElement).getByText("$127.50")).toBeVisible();
  });

  it("shows the subtotal, the discount, the tax with its rate, and the total", () => {
    render(<QuotationDocument quotation={sent} timeZone={TZ} />);

    expect(screen.getByText("Subtotal")).toBeVisible();
    expect(screen.getByText("-$25.20")).toBeVisible();
    expect(screen.getByText("Tax (8%)")).toBeVisible();
    expect(screen.getByText("$3.28")).toBeVisible();
    expect(screen.getByText("$230.08")).toBeVisible();
  });

  it("shows the note and the terms, and leaves them out when there are none", () => {
    const { rerender } = render(<QuotationDocument quotation={sent} timeZone={TZ} />);
    expect(screen.getByText("Parts are in stock.")).toBeVisible();
    expect(screen.getByText("Prices are valid until the date shown.")).toBeVisible();

    rerender(
      <QuotationDocument
        quotation={adminQuotation({ customerNote: null, terms: null })}
        timeZone={TZ}
      />,
    );
    expect(screen.queryByRole("region", { name: "Terms" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Note" })).not.toBeInTheDocument();
  });

  it("never prints the access notes or anything internal, whatever it is given", () => {
    const withExtras = {
      ...sent,
      voided: {
        at: "2026-11-04T10:00:00.000Z",
        by: { name: "Morgan Reyes" },
        reason: "Internal reason",
      },
    };
    render(<QuotationDocument quotation={withExtras} timeZone={TZ} />);
    const text = screen.getByTestId("quotation-document").textContent ?? "";
    expect(text).not.toContain("Internal reason");
    expect(text).not.toContain("Morgan Reyes");
  });
});

describe("QuotationStatusBanner", () => {
  const banner = () => screen.getByTestId("quotation-banner");

  it("says when a sent quotation went out and until when it is valid", () => {
    render(
      <QuotationStatusBanner
        quotation={adminQuotation({ status: "SENT", sentAt: "2026-11-03T15:00:00.000Z" })}
        timeZone={TZ}
      />,
    );
    expect(banner()).toHaveTextContent("Sent Nov 3, 2026 · valid until Nov 17, 2026");
    expect(banner()).toHaveTextContent("cannot be edited");
  });

  it("says a quotation expired and where to go from there", () => {
    render(
      <QuotationStatusBanner
        quotation={adminQuotation({ status: "EXPIRED", expiredAt: "2026-11-18T05:00:00.000Z" })}
        timeZone={TZ}
      />,
    );
    expect(banner()).toHaveTextContent("Expired");
    expect(banner()).toHaveTextContent("prepare a new quotation");
  });

  it("shows the internal reason of a void, marked as internal", () => {
    render(
      <QuotationStatusBanner
        quotation={adminQuotation({
          status: "VOID",
          voided: {
            at: "2026-11-04T15:00:00.000Z",
            by: { name: "Morgan Reyes" },
            reason: "Priced the wrong unit.",
          },
        })}
        timeZone={TZ}
      />,
    );
    expect(banner()).toHaveTextContent("Voided Nov 4, 2026: Priced the wrong unit.");
    expect(banner()).toHaveTextContent("only your team sees it");
  });

  it("says who answered, and the customer's reason for declining", () => {
    const { rerender } = render(
      <QuotationStatusBanner
        quotation={adminQuotation({ status: "ACCEPTED", respondedAt: "2026-11-05T12:00:00.000Z" })}
        timeZone={TZ}
      />,
    );
    expect(banner()).toHaveTextContent("Accepted Nov 5, 2026");

    rerender(
      <QuotationStatusBanner
        quotation={adminQuotation({
          status: "DECLINED",
          respondedAt: "2026-11-05T12:00:00.000Z",
          declineReason: "Found a cheaper quote.",
        })}
        timeZone={TZ}
      />,
    );
    expect(banner()).toHaveTextContent("Declined Nov 5, 2026");
    expect(banner()).toHaveTextContent("“Found a cheaper quote.”");
  });

  it("shows nothing for a draft", () => {
    const { container } = render(
      <QuotationStatusBanner quotation={adminQuotation()} timeZone={TZ} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the replacement chain, the details and the history", () => {
  it("links the quotations either side, each with its status", () => {
    render(
      <QuotationChainCard
        quotation={adminQuotation({
          status: "SENT",
          replaces: {
            id: "q-old",
            reference: "QT-2026-00002",
            status: "VOID",
            statusLabel: "Void",
          },
          replacedBy: {
            id: "q-new",
            reference: "QT-2026-00006",
            status: "DRAFT",
            statusLabel: "Draft",
          },
        })}
      />,
    );

    expect(screen.getByRole("link", { name: "QT-2026-00002" })).toHaveAttribute(
      "href",
      "/app/quotations/q-old",
    );
    expect(screen.getByRole("link", { name: "QT-2026-00006" })).toHaveAttribute(
      "href",
      "/app/quotations/q-new",
    );
    expect(screen.getByText("Replaces")).toBeVisible();
    expect(screen.getByText("Replaced by")).toBeVisible();
  });

  it("is not on the page at all for a quotation that replaces and is replaced by nothing", () => {
    const { container } = render(<QuotationChainCard quotation={adminQuotation()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("tells the team who did what, and keeps the void reason marked internal", () => {
    render(
      <QuotationDetailsCard
        timeZone={TZ}
        quotation={adminQuotation({
          status: "VOID",
          sentAt: "2026-11-03T15:00:00.000Z",
          sentBy: { name: "Morgan Reyes" },
          voided: {
            at: "2026-11-04T15:00:00.000Z",
            by: { name: "Sam Patel" },
            reason: "Priced the wrong unit.",
          },
        })}
      />,
    );

    expect(screen.getByText("Started by")).toBeVisible();
    expect(screen.getByText("Sent by")).toBeVisible();
    // Morgan Reyes started it (the fixture's creator) and sent it.
    expect(screen.getAllByText(/Morgan Reyes/, { selector: "dd" })).toHaveLength(2);
    expect(screen.getByText(/Sam Patel/)).toBeVisible();
    expect(screen.getByText(/Reason \(internal\)/)).toBeVisible();
    expect(screen.getByText("FF-2026-00012")).toBeVisible();
  });

  it("lists the events of the quotation, with the ones the customer cannot see marked", () => {
    render(
      <QuotationHistoryCard
        timeZone={TZ}
        quotation={adminQuotation({
          timeline: [
            {
              id: "e1",
              action: "quotation.created",
              entityType: "QUOTATION",
              entityId: QUOTATION_ID,
              fromStatus: null,
              toStatus: "DRAFT",
              summary:
                "Morgan Reyes created draft quotation QT-2026-00004 for request FF-2026-00012.",
              publicSummary: null,
              customerVisible: false,
              metadata: {},
              actor: { name: "Morgan Reyes", role: "BUSINESS_ADMIN" },
              createdAt: "2026-11-02T10:00:00.000Z",
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole("list", { name: "Quotation history" })).toBeVisible();
    expect(screen.getByText(/created draft quotation QT-2026-00004/)).toBeVisible();
    expect(screen.getByText("Internal")).toBeVisible();
  });
});

describe("QuotationActions", () => {
  const sent = adminQuotation({ status: "SENT", availableActions: ["REPLACE", "VOID"] });

  it("offers Print always, Replace and Void as the server lists them, and nothing else", () => {
    const { rerender } = render(<QuotationActions quotation={sent} />);
    expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Replace with a new draft" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "More actions" })).toBeEnabled();

    rerender(
      <QuotationActions quotation={adminQuotation({ status: "EXPIRED", availableActions: [] })} />,
    );
    expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Replace with a new draft" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("does not offer Replace while the request already has a draft (the server leaves it out)", () => {
    render(<QuotationActions quotation={{ ...sent, availableActions: ["VOID"] }} />);
    expect(
      screen.queryByRole("button", { name: "Replace with a new draft" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toBeEnabled();
  });

  it("starts the replacement on the server and opens the new draft", async () => {
    apiFetchMock.mockResolvedValue({ id: "q-new" });
    const user = userEvent.setup();
    render(<QuotationActions quotation={sent} />);

    await user.click(screen.getByRole("button", { name: "Replace with a new draft" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/quotations/q-new"));
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/requests/${REQUEST_ID}/quotations`, {
      method: "POST",
      body: { replacesQuotationId: QUOTATION_ID },
    });
  });

  it("opens the draft that already exists instead of failing", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "DRAFT_EXISTS",
        message: "This request already has a draft quotation.",
        details: { quotationId: "q-existing" },
      }),
    );
    const user = userEvent.setup();
    render(<QuotationActions quotation={sent} />);

    await user.click(screen.getByRole("button", { name: "Replace with a new draft" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/quotations/q-existing"));
    expect(toastInfo).toHaveBeenCalled();
  });

  it("voids a sent quotation with a reason and an optional message for the customer", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<QuotationActions quotation={sent} />);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Void quotation" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Void QT-2026-00004?" });
    expect(dialog).toHaveAccessibleDescription(/is told it was withdrawn/);
    await user.type(within(dialog).getByLabelText(/Reason \(internal\)/), "Priced the wrong unit.");
    await user.type(
      within(dialog).getByLabelText("Message to the customer"),
      "A corrected quotation follows.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Void quotation" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/quotations/${QUOTATION_ID}/void`, {
      method: "POST",
      body: {
        reason: "Priced the wrong unit.",
        expectedStatus: "SENT",
        customerMessage: "A corrected quotation follows.",
      },
    });
  });

  it("explains a quotation that changed under the page, and reloads it", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 409, code: "STALE_STATE", message: "Updated by someone else." }),
    );
    const user = userEvent.setup();
    render(<QuotationActions quotation={sent} />);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Void quotation" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByLabelText(/Reason \(internal\)/), "Priced the wrong unit.");
    await user.click(within(dialog).getByRole("button", { name: "Void quotation" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Someone else changed this quotation",
    );
    expect(refresh).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("RequestQuotationsCard", () => {
  const summary = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    reference: `QT-2026-0000${id}`,
    status: "SENT" as const,
    statusLabel: "Sent",
    totalAmount: "255.64",
    currencyCode: "USD",
    validUntil: "2026-11-17",
    sentAt: "2026-11-03T15:00:00.000Z",
    createdAt: "2026-11-03T14:00:00.000Z",
    replacesReference: null,
    ...over,
  });

  it("lists every version with its status, total and dates, each linking to the quotation", () => {
    render(
      <RequestQuotationsCard
        timeZone={TZ}
        request={adminRequest({
          status: "QUOTED",
          quotations: [
            summary("2", {
              status: "DRAFT",
              sentAt: null,
              totalAmount: "300.00",
              replacesReference: "QT-2026-00001",
            }),
            summary("1", { status: "SENT" }),
          ],
        })}
      />,
    );

    const table = screen.getByRole("table", { name: "Quotations for this request" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    const draft = within(rows[1] as HTMLElement);
    expect(draft.getByRole("link", { name: /QT-2026-00002/ })).toHaveAttribute(
      "href",
      "/app/quotations/2",
    );
    expect(draft.getByText("Replaces QT-2026-00001")).toBeVisible();
    expect(draft.getByText("Draft", { selector: "span" })).toBeVisible();
    expect(draft.getByText("$300.00")).toBeVisible();
    const live = within(rows[2] as HTMLElement);
    expect(live.getByText("$255.64")).toBeVisible();
    expect(live.getByText("Nov 3, 2026")).toBeVisible();
    expect(live.getByText("Nov 17, 2026")).toBeVisible();
  });

  it("gives guidance, and no second Create button, when there are none", () => {
    const { rerender } = render(
      <RequestQuotationsCard
        timeZone={TZ}
        request={adminRequest({ status: "UNDER_REVIEW", quotations: [] })}
      />,
    );
    expect(screen.getByText(/Use “Create quotation” above to prepare one/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(
      <RequestQuotationsCard
        timeZone={TZ}
        request={adminRequest({ status: "SUBMITTED", quotations: [] })}
      />,
    );
    expect(screen.getByText(/Start the review, then you can prepare one/)).toBeVisible();

    rerender(
      <RequestQuotationsCard
        timeZone={TZ}
        request={adminRequest({ status: "CANCELLED", quotations: [] })}
      />,
    );
    expect(screen.getByText("No quotation was prepared for this request.")).toBeVisible();
  });
});
