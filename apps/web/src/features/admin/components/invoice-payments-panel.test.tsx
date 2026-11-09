import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { INVOICE_ID, invoiceWithPayments, issuedInvoice, paymentRecord } from "../test-fixtures";
import { InvoicePaymentsPanel } from "./invoice-payments-panel";

const refresh = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/components/ui/sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const TIME_ZONE = "America/New_York";
const FIRST = "6f1b1d55-0a9b-4a2c-9a52-0f2f5a3d9c11";
const SECOND = "7a2c2e66-1bac-4b3d-8b63-1a3a6b4e0d22";

beforeEach(() => {
  vi.clearAllMocks();
  // Only the clock is faked: it is 22:00 on 2 March in New York, already 3 March in UTC.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-03T03:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function panel(invoice = issuedInvoice()) {
  return render(<InvoicePaymentsPanel invoice={invoice} timeZone={TIME_ZONE} />);
}

const region = () => within(screen.getByTestId("invoice-payments"));
/** The table only: below the large breakpoint the same rows are also drawn as cards, so a query on the whole panel finds each twice. */
const table = () => within(region().getByRole("table"));

describe("InvoicePaymentsPanel: what is owed, what is recorded, what is left", () => {
  it("shows Total, Paid and Balance due and offers to record a payment, with an empty state that guides", () => {
    panel();
    const summary = within(screen.getByTestId("payment-summary"));
    expect(summary.getByText("Total").nextSibling).toHaveTextContent("$255.64");
    expect(summary.getByText("Paid").nextSibling).toHaveTextContent("$0.00");
    expect(summary.getByText("Balance due").nextSibling).toHaveTextContent("$255.64");
    expect(region().getByRole("heading", { name: "Payments received" })).toBeVisible();
    expect(region().getByRole("button", { name: "Record payment" })).toBeVisible();
    expect(screen.getByTestId("payments-empty")).toHaveTextContent(
      "No payments recorded yet. When Amara Okafor pays you outside FixFlow, record it here so the balance stays right.",
    );
    expect(region().queryByRole("table")).not.toBeInTheDocument();
  });

  it("says FixFlow does not collect payments, and never says it processed one", () => {
    panel();
    expect(region().getByText(/FixFlow does not collect or check payments/)).toBeVisible();
    expect(screen.getByTestId("invoice-payments").textContent).not.toMatch(/process|charged/i);
  });

  it("lists every payment with its date, method, reference, amount, recorder and status", () => {
    panel(
      invoiceWithPayments([
        paymentRecord({
          id: FIRST,
          amount: "100.00",
          paymentDate: "2026-03-05",
          method: "CHEQUE",
          methodLabel: "Cheque",
          reference: "No. 004512",
          notes: "Left with the neighbour",
        }),
      ]),
    );
    const table = region().getByRole("table", { name: "Payments recorded against this invoice" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      "Date received",
      "Method",
      "Reference",
      "Amount",
      "Recorded by",
      "Status",
      "Actions",
    ]);
    const row = within(within(table).getAllByRole("row")[1] as HTMLElement);
    expect(row.getByText("Mar 5, 2026")).toBeVisible();
    expect(row.getByText("Cheque")).toBeVisible();
    expect(row.getByText("No. 004512")).toBeVisible();
    expect(row.getByText("Note: Left with the neighbour")).toBeVisible();
    expect(row.getByText("$100.00")).toBeVisible();
    expect(row.getByText("Morgan Reyes")).toBeVisible();
    expect(row.getByText("Recorded")).toBeVisible();
    expect(screen.queryByTestId("payments-empty")).not.toBeInTheDocument();
  });

  it("keeps a voided payment visible, struck through, with a Voided badge and its reason, and offers no void for it", () => {
    panel(
      invoiceWithPayments([
        paymentRecord({ id: FIRST, amount: "100.00" }),
        paymentRecord({
          id: SECOND,
          amount: "20.00",
          paymentDate: "2026-03-06",
          voided: {
            at: "2026-03-06T16:00:00.000Z",
            by: { name: "Morgan Reyes" },
            reason: "Wrong invoice.",
          },
        }),
      ]),
    );
    const rows = within(region().getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    const voided = within(rows[2] as HTMLElement);
    expect(voided.getByText("Voided")).toBeVisible();
    expect(voided.getByText(/Reason: Wrong invoice\./)).toBeVisible();
    expect(voided.getByText("$20.00")).toHaveClass("line-through");
    expect(voided.queryByRole("button")).not.toBeInTheDocument();
    // The summary counts only the payment that stands.
    expect(
      within(screen.getByTestId("payment-summary")).getByText("Paid").nextSibling,
    ).toHaveTextContent("$100.00");
    expect(
      within(rows[1] as HTMLElement).getByRole("button", {
        name: "Void the $100.00 payment received on Mar 5, 2026",
      }),
    ).toBeVisible();
  });

  it("a paid invoice says so, offers no Record payment, and still lets a payment be voided", () => {
    panel(invoiceWithPayments([paymentRecord({ id: FIRST, amount: "255.64" })]));
    expect(screen.getByText("Paid in full")).toBeVisible();
    expect(region().queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
    expect(table().getByRole("button", { name: /^Void the \$255\.64 payment/ })).toBeVisible();
  });

  it("a voided invoice shows its history but no buttons", () => {
    panel(
      issuedInvoice({
        status: "VOID",
        statusLabel: "Void",
        availableActions: [],
        payments: [
          paymentRecord({
            id: FIRST,
            voided: {
              at: "2026-03-06T16:00:00.000Z",
              by: { name: "Morgan Reyes" },
              reason: "Recorded on the wrong invoice.",
            },
          }),
        ],
      }),
    );
    expect(region().queryByRole("button")).not.toBeInTheDocument();
    expect(table().getByText(/Recorded on the wrong invoice\./)).toBeVisible();
  });

  it("a voided invoice with no payments says none were recorded and offers nothing", () => {
    panel(issuedInvoice({ status: "VOID", statusLabel: "Void", availableActions: [] }));
    expect(screen.getByTestId("payments-empty")).toHaveTextContent(
      "No payments were recorded against this invoice.",
    );
    expect(region().queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Record payment dialog", () => {
  async function open() {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    panel();
    await user.click(region().getByRole("button", { name: "Record payment" }));
    const dialog = await screen.findByRole("dialog", { name: "Record payment" });
    return { user, dialog };
  }

  it("explains itself, starts at the balance and the business's today, and warns about card details", async () => {
    const { dialog } = await open();
    expect(dialog).toHaveAccessibleDescription(
      /Record only payments you've actually received outside FixFlow\./,
    );
    expect(dialog).toHaveAccessibleDescription(/Balance due \$255\.64/);
    expect(within(dialog).getByLabelText(/Amount received/)).toHaveValue("255.64");
    // 03:00 UTC on 3 March is still 2 March in New York.
    expect(within(dialog).getByLabelText(/Date received/)).toHaveValue("2026-03-02");
    expect(within(dialog).getByLabelText(/Date received/)).toHaveAttribute("max", "2026-03-02");
    expect(within(dialog).getByLabelText(/How it was received/)).toHaveValue("");
    expect(
      within(dialog).getAllByText(/Don't enter card numbers or bank login details\./),
    ).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "Record payment" })).toBeEnabled();
  });

  it("offers the five methods", async () => {
    const { dialog } = await open();
    const options = within(within(dialog).getByLabelText(/How it was received/)).getAllByRole(
      "option",
    );
    expect(options.map((option) => option.textContent)).toEqual([
      "Choose a method",
      "Cash",
      "Bank transfer",
      "Card terminal",
      "Cheque",
      "Other",
    ]);
  });

  it("shows what is wrong beside each field and sends nothing", async () => {
    const { user, dialog } = await open();
    fireEvent.change(within(dialog).getByLabelText(/Amount received/), { target: { value: "0" } });
    fireEvent.change(within(dialog).getByLabelText(/Date received/), {
      target: { value: "2026-03-03" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));

    expect(await within(dialog).findByText("The amount must be more than zero.")).toBeVisible();
    expect(within(dialog).getByText("The payment date can't be in the future.")).toBeVisible();
    expect(within(dialog).getByText("Choose how the payment was received.")).toBeVisible();
    expect(within(dialog).getByLabelText(/Amount received/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(within(dialog).getByLabelText(/Amount received/)).toHaveFocus();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("refuses more than the balance before sending, in the server's words", async () => {
    const { user, dialog } = await open();
    fireEvent.change(within(dialog).getByLabelText(/Amount received/), {
      target: { value: "255.65" },
    });
    await user.selectOptions(within(dialog).getByLabelText(/How it was received/), "Cash");
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect(
      await within(dialog).findByText("This payment exceeds the remaining balance of $255.64"),
    ).toBeVisible();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("records a part payment: sends the typed amount as text, says Payment recorded, closes and reloads", async () => {
    apiFetchMock.mockResolvedValue({});
    const { user, dialog } = await open();
    fireEvent.change(within(dialog).getByLabelText(/Amount received/), {
      target: { value: "100" },
    });
    await user.selectOptions(within(dialog).getByLabelText(/How it was received/), "Cheque");
    fireEvent.change(within(dialog).getByLabelText(/Reference/), {
      target: { value: "No. 004512" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Notes/), { target: { value: "  " } });
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/invoices/${INVOICE_ID}/payments`, {
      method: "POST",
      body: {
        amount: "100",
        paymentDate: "2026-03-02",
        method: "CHEQUE",
        reference: "No. 004512",
        notes: null,
      },
    });
    expect(toastSuccess).toHaveBeenCalledWith("Payment recorded", expect.anything());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Focus goes back to the button that opened it.
    expect(region().getByRole("button", { name: "Record payment" })).toHaveFocus();
  });

  it("blocks a second click while the first is on its way: one request, a busy button, a locked form", async () => {
    let finish: (value: unknown) => void = () => undefined;
    apiFetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user, dialog } = await open();
    await user.selectOptions(within(dialog).getByLabelText(/How it was received/), "Cash");
    const submit = within(dialog).getByRole("button", { name: "Record payment" });
    await user.click(submit);
    await user.click(submit);
    fireEvent.submit(submit.closest("form") as HTMLFormElement);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByLabelText(/Amount received/)).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(toastSuccess).not.toHaveBeenCalled();
    finish({});
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("shows the server's 422 beside the amount with the balance that is left, keeps everything typed and reloads the page", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "PAYMENT_EXCEEDS_BALANCE",
        message: "This payment exceeds the remaining balance of $55.64",
        fieldErrors: { amount: "This payment exceeds the remaining balance of $55.64" },
        details: { remainingBalance: "55.64", currencyCode: "USD" },
      }),
    );
    const { user, dialog } = await open();
    fireEvent.change(within(dialog).getByLabelText(/Amount received/), {
      target: { value: "200" },
    });
    await user.selectOptions(within(dialog).getByLabelText(/How it was received/), "Bank transfer");
    fireEvent.change(within(dialog).getByLabelText(/Reference/), { target: { value: "TX-9" } });
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));

    expect(
      await within(dialog).findByText("This payment exceeds the remaining balance of $55.64"),
    ).toBeVisible();
    expect(within(dialog).getByLabelText(/Amount received/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await waitFor(() => expect(within(dialog).getByLabelText(/Amount received/)).toHaveFocus());
    // Nothing typed is lost, and the form is usable again.
    expect(within(dialog).getByLabelText(/Amount received/)).toHaveValue("200");
    expect(within(dialog).getByLabelText(/Reference/)).toHaveValue("TX-9");
    expect(within(dialog).getByRole("button", { name: "Record payment" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(refresh).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("tells the person when the invoice can no longer take a payment, keeps the dialog and reloads", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "INVOICE_NOT_PAYABLE",
        message: "This invoice is already paid in full, so there is nothing left to record.",
      }),
    );
    const { user, dialog } = await open();
    await user.selectOptions(within(dialog).getByLabelText(/How it was received/), "Cash");
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("already paid in full");
    expect(refresh).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("shows a server problem with the form kept so it can be tried again", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const { user, dialog } = await open();
    await user.selectOptions(within(dialog).getByLabelText(/How it was received/), "Cash");
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect(await within(dialog).findByRole("alert")).toBeVisible();
    expect(within(dialog).getByLabelText(/How it was received/)).toHaveValue("CASH");
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("Void payment dialog", () => {
  const partlyPaid = () =>
    invoiceWithPayments([
      paymentRecord({ id: FIRST, amount: "100.00", paymentDate: "2026-03-05" }),
      paymentRecord({ id: SECOND, amount: "50.00", paymentDate: "2026-03-06" }),
    ]);

  async function open() {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    panel(partlyPaid());
    await user.click(
      table().getByRole("button", { name: "Void the $100.00 payment received on Mar 5, 2026" }),
    );
    const dialog = await screen.findByRole("alertdialog", { name: "Void the $100.00 payment?" });
    return { user, dialog };
  }

  it("states the consequence in amounts, requires a reason and keeps the payment", async () => {
    const { dialog } = await open();
    expect(dialog).toHaveAccessibleDescription(
      /The invoice balance will increase by \$100\.00, to \$205\.64\./,
    );
    expect(dialog).toHaveAccessibleDescription(/Amara Okafor is told/);
    expect(dialog).toHaveAccessibleDescription(/marked Voided/);
    expect(within(dialog).getByRole("button", { name: "Void payment" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Keep payment" })).toBeVisible();
  });

  it("voids with the reason, says Payment voided and reloads", async () => {
    apiFetchMock.mockResolvedValue({});
    const { user, dialog } = await open();
    await user.click(within(dialog).getByLabelText(/Reason/));
    await user.paste("Typed against the wrong invoice.");
    await user.click(within(dialog).getByRole("button", { name: "Void payment" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/admin/invoices/${INVOICE_ID}/payments/${FIRST}/void`,
      { method: "POST", body: { reason: "Typed against the wrong invoice." } },
    );
    expect(toastSuccess).toHaveBeenCalledWith("Payment voided", expect.anything());
  });

  it("shows the server's refusal and reloads when the payment had already been voided", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "PAYMENT_ALREADY_VOIDED",
        message: "This payment was already voided.",
      }),
    );
    const { user, dialog } = await open();
    await user.click(within(dialog).getByLabelText(/Reason/));
    await user.paste("Typed against the wrong invoice.");
    await user.click(within(dialog).getByRole("button", { name: "Void payment" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("changed by someone else");
    expect(refresh).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
