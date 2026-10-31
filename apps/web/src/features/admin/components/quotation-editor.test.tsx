import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { adminQuotation, QUOTATION_ID, REQUEST_ID } from "../test-fixtures";
import { QuotationEditor } from "./quotation-editor";
import { TOTALS_PREVIEW_NOTE } from "./quotation-totals-card";

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
const TIME_ZONE = "America/New_York";

beforeEach(() => {
  vi.clearAllMocks();
});

function renderEditor(overrides: Parameters<typeof adminQuotation>[0] = {}) {
  const user = userEvent.setup();
  const quotation = adminQuotation(overrides);
  render(<QuotationEditor quotation={quotation} timeZone={TIME_ZONE} />);
  return { user, quotation };
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const row = (n: number) => screen.getByRole("group", { name: `Line ${n}` });

/** Replaces the text of a field. `paste` is quick on a form that watches every field. */
async function fill(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  text: string,
): Promise<void> {
  await user.clear(field);
  if (text !== "") {
    await user.click(field);
    await user.paste(text);
  }
}

describe("QuotationEditor: what it shows", () => {
  it("shows the draft's lines, discount, tax rate and details, with the header the page needs", () => {
    renderEditor();

    expect(
      screen.getByRole("heading", { level: 1, name: "Quotation QT-2026-00004" }),
    ).toBeVisible();
    expect(screen.getByText("Draft", { selector: "span" })).toBeVisible();
    expect(screen.getByRole("link", { name: "FF-2026-00012" })).toHaveAttribute(
      "href",
      `/app/requests/${REQUEST_ID}`,
    );
    expect(screen.getAllByRole("group", { name: /^Line \d+$/ })).toHaveLength(3);
    expect(within(row(3)).getByLabelText("Quantity")).toHaveValue("1.5");
    expect(screen.getByLabelText(/^Discount/)).toHaveValue("0.00");
    expect(screen.getByLabelText("Tax rate (%)")).toHaveValue("8.00");
    expect(screen.getByText(/Filled in from your business settings/)).toBeVisible();
    expect(screen.getByLabelText(/^Valid until/)).toHaveValue("2026-11-17");
    expect(screen.getByLabelText("Terms")).toHaveValue("Prices are valid until the date shown.");
  });

  it("labels the totals as a preview, with the shared calculation's figures", () => {
    renderEditor();

    expect(TOTALS_PREVIEW_NOTE).toBe("Preview — final totals are calculated when you save");
    expect(screen.getByText(TOTALS_PREVIEW_NOTE)).toBeVisible();
    const card = screen.getByRole("heading", { name: "Totals" }).closest("div")?.parentElement;
    const totals = within(card as HTMLElement);
    expect(totals.getByText("$252.00")).toBeVisible();
    expect(totals.getByText("Tax (8%)")).toBeVisible();
    expect(totals.getByText("$3.64")).toBeVisible();
    expect(totals.getByText("$255.64")).toBeVisible();
    expect(totals.queryByText("Discount")).not.toBeInTheDocument();
  });

  it("updates the totals live, discount included: 230.08 for a discount of 25.20", async () => {
    const { user } = renderEditor();

    await fill(user, screen.getByLabelText(/^Discount/), "25.20");

    const card = screen.getByRole("heading", { name: "Totals" }).closest("div")?.parentElement;
    const totals = within(card as HTMLElement);
    expect(totals.getByText("-$25.20")).toBeVisible();
    expect(totals.getByText("$3.28")).toBeVisible();
    expect(totals.getByText("$230.08")).toBeVisible();
  });

  it("shows no totals, and says why, while an amount cannot be added up", async () => {
    const { user } = renderEditor();

    await fill(user, within(row(2)).getByLabelText("Quantity"), "abc");

    expect(screen.getByText(/The totals appear once every quantity/)).toBeVisible();
    expect(screen.queryByText("$255.64")).not.toBeInTheDocument();
  });

  it("keeps Save draft, Preview and Send apart, with Send marked as leading to a confirmation", () => {
    renderEditor();

    expect(button("Save draft")).toBeDisabled(); // nothing to save yet
    expect(button("Preview")).toBeEnabled();
    expect(button("Send to customer…")).toBeEnabled();
    expect(screen.getByText("All changes are saved.")).toBeVisible();
    expect(screen.getByText(/Last saved/)).toBeVisible();
  });
});

describe("QuotationEditor: saving a draft is not sending it", () => {
  it("turns Preview and Send off while there are unsaved changes, and says to save first", async () => {
    const { user } = renderEditor();

    await fill(user, screen.getByLabelText("Note for the customer"), "Parts in stock.");

    expect(button("Save draft")).toBeEnabled();
    expect(button("Preview")).toBeDisabled();
    expect(button("Send to customer…")).toBeDisabled();
    expect(screen.getByText("You have unsaved changes.")).toBeVisible();
    expect(screen.getAllByText("Save your changes to preview or send.").length).toBeGreaterThan(0);
  });

  it("sends the lines and details with the saved version, and no total", async () => {
    apiFetchMock.mockResolvedValue(
      adminQuotation({ customerNote: "Parts in stock.", updatedAt: "2026-11-02T10:09:00.000Z" }),
    );
    const { user } = renderEditor();

    await fill(user, screen.getByLabelText("Note for the customer"), "Parts in stock.");
    await user.click(button("Save draft"));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const [path, options] = apiFetchMock.mock.calls[0] ?? [];
    expect(path).toBe(`/admin/quotations/${QUOTATION_ID}`);
    expect(options).toMatchObject({ method: "PATCH" });
    const body = (options as { body: Record<string, unknown> }).body;
    expect(body).toEqual({
      lines: [
        { description: "Diagnostic visit", quantity: "1", unitPrice: "79.00", taxable: false },
        { description: "Run capacitor", quantity: "1", unitPrice: "45.50", taxable: true },
        { description: "Labour", quantity: "1.5", unitPrice: "85.00", taxable: false },
      ],
      discountAmount: "0.00",
      taxRate: "8.00",
      validUntil: "2026-11-17",
      terms: "Prices are valid until the date shown.",
      customerNote: "Parts in stock.",
      expectedUpdatedAt: "2026-11-02T10:05:00.123Z",
    });
  });

  it("says the draft is saved only after the server has said so, and re-enables Preview and Send", async () => {
    let finish: (value: unknown) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Parts in stock.");

    await user.click(button("Save draft"));
    expect(button("Save draft")).toHaveAttribute("aria-busy", "true");
    expect(toastSuccess).not.toHaveBeenCalled();
    await user.click(button("Save draft"));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    finish(
      adminQuotation({ customerNote: "Parts in stock.", updatedAt: "2026-11-02T10:09:00.000Z" }),
    );

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Draft saved", {
        description: "The total is $255.64, worked out from the saved lines.",
      }),
    );
    await waitFor(() => expect(button("Preview")).toBeEnabled());
    expect(button("Send to customer…")).toBeEnabled();
    expect(screen.getByText("All changes are saved.")).toBeVisible();
    expect(refresh).toHaveBeenCalled();
  });

  it("sends the new version's time with the next save", async () => {
    apiFetchMock.mockResolvedValue(
      adminQuotation({ customerNote: "One.", updatedAt: "2026-11-02T10:09:00.000Z" }),
    );
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "One.");
    await user.click(button("Save draft"));
    await waitFor(() => expect(button("Preview")).toBeEnabled());

    apiFetchMock.mockResolvedValue(
      adminQuotation({ customerNote: "Two.", updatedAt: "2026-11-02T10:11:00.000Z" }),
    );
    await fill(user, screen.getByLabelText("Note for the customer"), "Two.");
    await user.click(button("Save draft"));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    const second = apiFetchMock.mock.calls[1]?.[1] as { body: { expectedUpdatedAt: string } };
    expect(second.body.expectedUpdatedAt).toBe("2026-11-02T10:09:00.000Z");
  });

  it("discards the changes on request", async () => {
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Parts in stock.");

    await user.click(button("Discard changes"));

    expect(screen.getByLabelText("Note for the customer")).toHaveValue("");
    expect(screen.getByText("All changes are saved.")).toBeVisible();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe("QuotationEditor: when the form is wrong", () => {
  it("stops a save with a bad quantity before it is sent, names the line and keeps what was typed", async () => {
    const { user } = renderEditor();

    await fill(user, within(row(2)).getByLabelText("Quantity"), "0");
    await user.click(button("Save draft"));

    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(await within(row(2)).findByText(/Enter a quantity from 0.01 to 9,999.99/)).toBeVisible();
    expect(within(row(2)).getByLabelText("Quantity")).toHaveAttribute("aria-invalid", "true");
    expect(within(row(2)).getByLabelText("Quantity")).toHaveValue("0");
    // The list of problems links to the field.
    expect(screen.getByRole("link", { name: /Line 2 quantity/ })).toBeVisible();
  });

  it("puts the server's field errors beside the row and field they belong to", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "The request contains invalid values.",
        fieldErrors: {
          "lines.1.unitPrice": "Enter a price from 0.00 to 999,999.99.",
          taxRate: "Enter a tax rate from 0 to 100.",
        },
      }),
    );
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Hello.");

    await user.click(button("Save draft"));

    expect(await within(row(2)).findByText("Enter a price from 0.00 to 999,999.99.")).toBeVisible();
    expect(within(row(2)).getByLabelText(/Unit price/)).toHaveAttribute("aria-invalid", "true");
    expect(within(row(1)).getByLabelText(/Unit price/)).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Tax rate (%)")).toHaveAccessibleDescription(
      /Enter a tax rate from 0 to 100/,
    );
    // What was typed is still there, and nothing was announced as saved.
    expect(screen.getByLabelText("Note for the customer")).toHaveValue("Hello.");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("explains a draft that someone else changed, keeps the edits, and offers the latest version", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError({
        status: 409,
        code: "STALE_STATE",
        message: "This quotation was updated by someone else.",
      }),
    );
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Mine.");

    await user.click(button("Save draft"));

    expect(await screen.findByRole("alert")).toHaveTextContent("was changed somewhere else");
    expect(screen.getByLabelText("Note for the customer")).toHaveValue("Mine.");

    apiFetchMock.mockResolvedValueOnce(
      adminQuotation({ customerNote: "Theirs.", updatedAt: "2026-11-02T10:20:00.000Z" }),
    );
    await user.click(button("Load the latest version"));

    await waitFor(() =>
      expect(screen.getByLabelText("Note for the customer")).toHaveValue("Theirs."),
    );
    expect(apiFetchMock).toHaveBeenLastCalledWith(`/admin/quotations/${QUOTATION_ID}`);
    expect(
      screen.queryByRole("button", { name: "Load the latest version" }),
    ).not.toBeInTheDocument();
  });

  it("shows any other failure and keeps the draft as typed", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Mine.");

    await user.click(button("Save draft"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.getByLabelText("Note for the customer")).toHaveValue("Mine.");
    expect(button("Save draft")).toBeEnabled();
  });
});

describe("QuotationEditor: sending", () => {
  it("asks first, says it cannot be edited afterwards and until when, and sends nothing on Not yet", async () => {
    const { user } = renderEditor();

    await user.click(button("Send to customer…"));

    const dialog = await screen.findByRole("alertdialog", {
      name: "Send QT-2026-00004 to Amara Okafor?",
    });
    expect(dialog).toHaveAccessibleDescription(
      /After sending, this quotation can't be edited\. The customer will be able to accept or decline it until Nov 17, 2026\./,
    );
    await user.click(within(dialog).getByRole("button", { name: "Not yet" }));
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("sends with the status the screen showed, then confirms and reloads into the read-only view", async () => {
    apiFetchMock.mockResolvedValue(adminQuotation({ status: "SENT" }));
    const { user } = renderEditor();

    await user.click(button("Send to customer…"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Send to customer" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/quotations/${QUOTATION_ID}/send`, {
      method: "POST",
      body: { expectedStatus: "DRAFT" },
    });
    expect(toastSuccess).toHaveBeenCalledWith("QT-2026-00004 was sent", {
      description: "Amara Okafor was notified in their portal.",
    });
  });

  it("will not offer to send a quotation whose total is zero, and says what to do", () => {
    renderEditor({
      lines: [
        {
          id: "line-1",
          position: 1,
          description: "AC Repair",
          quantity: "1.00",
          unitPrice: "0.00",
          taxable: true,
          lineTotal: "0.00",
        },
      ],
      subtotal: "0.00",
      taxableBase: "0.00",
      taxAmount: "0.00",
      totalAmount: "0.00",
    });

    expect(button("Send to customer…")).toBeDisabled();
    expect(
      screen.getByText("Add a price: a quotation needs a total above zero before it is sent."),
    ).toBeVisible();
    expect(button("Preview")).toBeEnabled();
  });

  it("puts the server's reasons beside the fields and closes the dialog when sending is refused", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "The request contains invalid values.",
        fieldErrors: {
          validUntil:
            "Choose a valid-until date of today or later, so the customer has time to answer.",
        },
      }),
    );
    const { user } = renderEditor();

    await user.click(button("Send to customer…"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Send to customer" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^Valid until/)).toHaveAccessibleDescription(/today or later/);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the reason when sending fails for another reason", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const { user } = renderEditor();

    await user.click(button("Send to customer…"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Send to customer" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("QuotationEditor: preview", () => {
  it("shows the customer's view of the saved draft and says nothing has been sent", async () => {
    apiFetchMock.mockResolvedValue({
      ...adminQuotation(),
      requestId: REQUEST_ID,
      preview: true,
    });
    const { user } = renderEditor();

    await user.click(button("Preview"));

    const dialog = await screen.findByRole("dialog", { name: "Preview for the customer" });
    const [path, options] = apiFetchMock.mock.calls[0] ?? [];
    expect(path).toBe(`/quotations/${QUOTATION_ID}?preview=1`);
    expect((options as { signal: unknown }).signal).toBeInstanceOf(AbortSignal);
    expect(await within(dialog).findByTestId("quotation-document")).toBeVisible();
    expect(dialog).toHaveAccessibleDescription(/It has not been sent/);
    expect(within(dialog).getByText("CoolBreeze Home Services")).toBeVisible();
    expect(within(dialog).getByText("$255.64")).toBeVisible();
  });

  it("offers to try again when the preview cannot be loaded", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const { user } = renderEditor();

    await user.click(button("Preview"));
    const dialog = await screen.findByRole("dialog", { name: "Preview for the customer" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong.");

    apiFetchMock.mockResolvedValueOnce({
      ...adminQuotation(),
      requestId: REQUEST_ID,
      preview: true,
    });
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByTestId("quotation-document")).toBeVisible();
  });
});

describe("QuotationEditor: voiding a draft", () => {
  async function openVoidDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(button("More actions"));
    await user.click(await screen.findByRole("menuitem", { name: "Void quotation" }));
    return screen.findByRole("alertdialog", { name: "Void QT-2026-00004?" });
  }

  it("needs a reason, says what happens, and sends nothing else for a draft", async () => {
    apiFetchMock.mockResolvedValue(adminQuotation({ status: "VOID" }));
    const { user } = renderEditor();

    const dialog = await openVoidDialog(user);
    expect(dialog).toHaveAccessibleDescription(/never saw it, so they are not told/);
    expect(within(dialog).queryByLabelText("Message to the customer")).not.toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Void quotation" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason \(internal\)/), "Start again, please.");
    await user.click(confirm);

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/requests/${REQUEST_ID}`));
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/quotations/${QUOTATION_ID}/void`, {
      method: "POST",
      body: { reason: "Start again, please.", expectedStatus: "DRAFT" },
    });
    expect(toastSuccess).toHaveBeenCalledWith("QT-2026-00004 was voided", expect.anything());
  });
});

describe("QuotationEditor: leaving with unsaved changes", () => {
  it("asks before following a link, and stays on the draft when told to", async () => {
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Mine.");

    await user.click(screen.getByRole("link", { name: "FF-2026-00012" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    expect(push).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Note for the customer")).toHaveValue("Mine.");
    expect(push).not.toHaveBeenCalled();
  });

  it("leaves when the person says to", async () => {
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Mine.");
    await user.click(screen.getByRole("link", { name: "FF-2026-00012" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    await user.click(within(dialog).getByRole("button", { name: "Leave without saving" }));

    expect(push).toHaveBeenCalledWith(`/app/requests/${REQUEST_ID}`);
  });

  it("lets a link through when nothing is unsaved", async () => {
    // jsdom cannot navigate: cancel the click once the page's own handlers have seen it.
    const cancel = (event: Event) => {
      event.preventDefault();
    };
    document.addEventListener("click", cancel);
    try {
      const { user } = renderEditor();
      await user.click(screen.getByRole("link", { name: "FF-2026-00012" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    } finally {
      document.removeEventListener("click", cancel);
    }
  });
});
