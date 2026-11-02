import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { customerQuotation, PORTAL_QUOTATION_ID, PORTAL_REQUEST_ID } from "../test-fixtures";
import { QuotationDecision, type QuotationDecisionProps } from "./quotation-decision";

const refresh = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/components/ui/sonner", () => ({
  toast: { success: vi.fn(), error: toastError, info: vi.fn() },
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const ACCEPT_PATH = `/quotations/${PORTAL_QUOTATION_ID}/accept`;
const DECLINE_PATH = `/quotations/${PORTAL_QUOTATION_ID}/decline`;

function renderDecision(overrides: Partial<QuotationDecisionProps["quotation"]> = {}) {
  const user = userEvent.setup();
  const { id, reference, status, serviceName, totalAmount, currencyCode, requestId } =
    customerQuotation(overrides);
  render(
    <QuotationDecision
      quotation={{ id, reference, status, serviceName, totalAmount, currencyCode, requestId }}
      businessName="CoolBreeze Home Services"
    />,
  );
  return user;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

async function openAccept(user: ReturnType<typeof userEvent.setup>) {
  await user.click(button("Accept quotation"));
  return screen.findByRole("alertdialog", { name: "Accept QT-2026-00004?" });
}

async function openDecline(user: ReturnType<typeof userEvent.setup>) {
  await user.click(button("Decline"));
  return screen.findByRole("alertdialog", { name: "Decline QT-2026-00004?" });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockResolvedValue(customerQuotation({ status: "ACCEPTED" }));
});

describe("QuotationDecision: when it is offered", () => {
  it("offers Accept and Decline, with the total, for a quotation awaiting an answer", () => {
    renderDecision();

    const bar = screen.getByTestId("quotation-decision");
    expect(within(bar).getByRole("heading", { name: "Your decision" })).toBeVisible();
    expect(bar).toHaveTextContent("Total $255.64");
    expect(bar).toHaveTextContent("Nothing is scheduled until you accept");
    expect(button("Accept quotation")).toBeEnabled();
    expect(button("Decline")).toBeEnabled();
  });

  it.each(["ACCEPTED", "DECLINED", "EXPIRED", "VOID"] as const)(
    "offers nothing once the quotation is %s",
    (status) => {
      renderDecision({ status });

      expect(screen.queryByRole("button", { name: "Accept quotation" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
      expect(screen.queryByTestId("quotation-decision")).toBeNull();
    },
  );

  it("sends nothing until the customer has confirmed", async () => {
    const user = renderDecision();

    const dialog = await openAccept(user);
    await user.click(within(dialog).getByRole("button", { name: "Go back" }));

    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("quotation-confirmation")).toBeNull();
  });
});

describe("QuotationDecision: accepting", () => {
  it("says the total, what happens next, and that it is not a contract signature", async () => {
    const user = renderDecision();

    const dialog = await openAccept(user);

    expect(dialog).toHaveTextContent("a total of $255.64");
    expect(dialog).toHaveTextContent("we'll contact you to schedule the work");
    expect(dialog).toHaveTextContent(
      "This records your acceptance; it is not a contract signature.",
    );
  });

  it("sends the answer, then confirms it, takes focus there and reloads the page", async () => {
    const user = renderDecision();
    const dialog = await openAccept(user);

    await user.click(within(dialog).getByRole("button", { name: "Accept quotation" }));

    await waitFor(() => {
      expect(screen.getByTestId("quotation-confirmation")).toBeVisible();
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(ACCEPT_PATH, { method: "POST", body: {} });
    const confirmation = screen.getByTestId("quotation-confirmation");
    expect(confirmation).toHaveTextContent("Thank you — your acceptance is recorded");
    expect(confirmation).toHaveTextContent(
      "We've let CoolBreeze Home Services know. We'll contact you to schedule the work.",
    );
    expect(
      within(confirmation).getByRole("link", { name: "Back to your request" }),
    ).toHaveAttribute("href", `/portal/requests/${PORTAL_REQUEST_ID}`);
    expect(confirmation).toHaveFocus();
    expect(refresh).toHaveBeenCalledTimes(1);
    // The bar is gone: the answer cannot be given twice from this page.
    expect(screen.queryByRole("button", { name: "Accept quotation" })).toBeNull();
    expect(screen.queryByTestId("quotation-decision")).toBeNull();
  });

  it("sends one answer however many times the button is pressed while it is pending", async () => {
    let finish: (value: ReturnType<typeof customerQuotation>) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = renderDecision();
    const dialog = await openAccept(user);
    const confirm = within(dialog).getByRole("button", { name: "Accept quotation" });

    await user.click(confirm);
    await user.click(confirm);
    await user.click(confirm);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("button", { name: "Go back" })).toBeDisabled();
    finish(customerQuotation({ status: "ACCEPTED" }));
    await waitFor(() => {
      expect(screen.getByTestId("quotation-confirmation")).toBeVisible();
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("QuotationDecision: declining", () => {
  it("asks, without insisting, why", async () => {
    const user = renderDecision();

    const dialog = await openDecline(user);

    const why = within(dialog).getByLabelText(/Help us improve — why are you declining\?/);
    expect(why).toBeVisible();
    expect(why).not.toBeRequired();
    expect(dialog).toHaveTextContent("Optional. CoolBreeze Home Services reads this.");
    expect(dialog).toHaveTextContent("No work will be scheduled from this quotation");
    // The confirm button is never held back by the optional box.
    expect(within(dialog).getByRole("button", { name: "Decline quotation" })).toBeEnabled();
  });

  it("sends the reason the customer typed, trimmed", async () => {
    const user = renderDecision();
    const dialog = await openDecline(user);

    await user.click(within(dialog).getByLabelText(/why are you declining/));
    await user.paste("  Found a cheaper option.  ");
    await user.click(within(dialog).getByRole("button", { name: "Decline quotation" }));

    await waitFor(() => {
      expect(screen.getByTestId("quotation-confirmation")).toBeVisible();
    });
    expect(apiFetchMock).toHaveBeenCalledWith(DECLINE_PATH, {
      method: "POST",
      body: { reason: "Found a cheaper option." },
    });
    expect(screen.getByTestId("quotation-confirmation")).toHaveTextContent(
      "Your answer is recorded",
    );
    expect(screen.getByTestId("quotation-confirmation")).toHaveTextContent(
      "No work will be scheduled from this quotation",
    );
  });

  it("declines without a reason when none is given", async () => {
    const user = renderDecision();
    const dialog = await openDecline(user);

    await user.click(within(dialog).getByRole("button", { name: "Decline quotation" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(DECLINE_PATH, { method: "POST", body: {} });
    });
  });

  it("limits the reason to 500 characters", async () => {
    const user = renderDecision();
    const dialog = await openDecline(user);

    expect(within(dialog).getByLabelText(/why are you declining/)).toHaveAttribute(
      "maxlength",
      "500",
    );
  });
});

describe("QuotationDecision: when the server says no", () => {
  const unavailable = new ApiError({
    status: 409,
    code: "QUOTATION_NOT_AVAILABLE",
    message:
      "This quotation was valid until Nov 17, 2026 and has expired. Contact us and we'll send an updated quotation.",
  });

  it("shows the server's own words, reloads the page so it shows the truth, and records no answer", async () => {
    apiFetchMock.mockRejectedValue(unavailable);
    const user = renderDecision();
    const dialog = await openAccept(user);

    await user.click(within(dialog).getByRole("button", { name: "Accept quotation" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This quotation was valid until Nov 17, 2026 and has expired.",
    );
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("This quotation was valid until Nov 17, 2026"),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("quotation-confirmation")).toBeNull();
  });

  it("reloads the page for a quotation that is no longer there, too", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 404, code: "NOT_FOUND", message: "We couldn't find that." }),
    );
    const user = renderDecision();
    const dialog = await openDecline(user);

    await user.click(within(dialog).getByRole("button", { name: "Decline quotation" }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the dialog and the typed reason after a failure that may pass, and lets the customer retry", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError({ status: 0, code: "NETWORK_ERROR", message: "We couldn't reach the server." }),
    );
    const user = renderDecision();
    const dialog = await openDecline(user);
    await user.click(within(dialog).getByLabelText(/why are you declining/));
    await user.paste("Too expensive.");

    await user.click(within(dialog).getByRole("button", { name: "Decline quotation" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server.",
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(/why are you declining/)).toHaveValue("Too expensive.");
    expect(screen.queryByTestId("quotation-confirmation")).toBeNull();

    apiFetchMock.mockResolvedValueOnce(customerQuotation({ status: "DECLINED" }));
    await user.click(within(dialog).getByRole("button", { name: "Decline quotation" }));

    await waitFor(() => {
      expect(screen.getByTestId("quotation-confirmation")).toBeVisible();
    });
    expect(apiFetchMock).toHaveBeenLastCalledWith(DECLINE_PATH, {
      method: "POST",
      body: { reason: "Too expensive." },
    });
  });

  it("says how long to wait when the customer has been answering too fast", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 429,
        code: "RATE_LIMITED",
        message: "Too many requests.",
        retryAfterSeconds: 1800,
      }),
    );
    const user = renderDecision();
    const dialog = await openAccept(user);

    await user.click(within(dialog).getByRole("button", { name: "Accept quotation" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("30 minutes");
    expect(refresh).not.toHaveBeenCalled();
  });
});
