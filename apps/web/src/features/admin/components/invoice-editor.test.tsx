import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { adminInvoice, INVOICE_ID, issuedInvoice, JOB_ID } from "../test-fixtures";
import { InvoiceEditor } from "./invoice-editor";

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

function renderEditor(overrides: Parameters<typeof adminInvoice>[0] = {}) {
  const user = userEvent.setup();
  const invoice = adminInvoice(overrides);
  render(<InvoiceEditor invoice={invoice} timeZone={TIME_ZONE} />);
  return { user, invoice };
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

describe("InvoiceEditor: what it shows", () => {
  it("shows the draft's lines, discount, tax rate and dates, with the header the page needs", () => {
    renderEditor();

    expect(screen.getByRole("heading", { level: 1, name: "Draft invoice" })).toBeVisible();
    expect(screen.getByText("Draft", { selector: "span" })).toBeVisible();
    // The header and the lines card both point at the job.
    for (const link of screen.getAllByRole("link", { name: "JOB-2026-00007" })) {
      expect(link).toHaveAttribute("href", `/app/jobs/${JOB_ID}`);
    }
    expect(screen.getAllByRole("group", { name: /^Line \d+$/ })).toHaveLength(3);
    expect(within(row(3)).getByLabelText("Quantity")).toHaveValue("1.5");
    expect(screen.getByLabelText(/^Discount/)).toHaveValue("0.00");
    expect(screen.getByLabelText("Tax rate (%)")).toHaveValue("8.00");
    expect(screen.getByLabelText("Issue date")).toHaveValue("");
    expect(screen.getByLabelText(/^Due date/)).toHaveValue("2026-03-16");
  });

  it("says the lines come from the accepted quotation and that extra parts are added as lines", () => {
    renderEditor();
    expect(screen.getByText(/Filled in from the accepted quotation QT-2026-00009/)).toBeVisible();
    expect(screen.getByText(/as more lines/)).toBeVisible();
  });

  it("labels the totals as a preview, with the shared calculation's figures", () => {
    renderEditor();
    const card = screen.getByRole("heading", { name: "Totals" }).closest("div")?.parentElement;
    const totals = within(card as HTMLElement);
    expect(totals.getByText("Preview — final totals are calculated when you save")).toBeVisible();
    expect(totals.getByText("$252.00")).toBeVisible();
    expect(totals.getByText("$3.64")).toBeVisible();
    expect(totals.getByText("$255.64")).toBeVisible();
  });

  it("updates the totals live when an extra parts line is typed in", async () => {
    const { user } = renderEditor();
    await user.click(button("Add line"));
    const added = screen.getByRole("group", { name: "Line 4" });
    await fill(user, within(added).getByLabelText(/Description/), "Contactor relay");
    await fill(user, within(added).getByLabelText("Quantity"), "2");
    await fill(user, within(added).getByLabelText(/Unit price/), "37.25");

    const card = screen.getByRole("heading", { name: "Totals" }).closest("div")?.parentElement;
    const totals = within(card as HTMLElement);
    // 252.00 + 74.50 = 326.50 subtotal; taxable 45.50 + 74.50 = 120.00 at 8 % = 9.60; total 336.10.
    expect(totals.getByText("$326.50")).toBeVisible();
    expect(totals.getByText("$9.60")).toBeVisible();
    expect(totals.getByText("$336.10")).toBeVisible();
  });

  it("keeps Save draft, Preview and Issue apart", () => {
    renderEditor();
    expect(button("Save draft")).toBeDisabled(); // nothing to save yet
    expect(button("Preview")).toBeEnabled();
    expect(button("Issue invoice…")).toBeEnabled();
    expect(screen.getByText("All changes are saved.")).toBeVisible();
  });
});

describe("InvoiceEditor: saving a draft is not issuing it", () => {
  it("turns Preview and Issue off while there are unsaved changes, and says to save first", async () => {
    const { user } = renderEditor();

    await fill(user, screen.getByLabelText("Note for the customer"), "Thank you.");

    expect(button("Save draft")).toBeEnabled();
    expect(button("Preview")).toBeDisabled();
    expect(button("Issue invoice…")).toBeDisabled();
    expect(screen.getAllByText("Save your changes to preview or issue.").length).toBeGreaterThan(0);
  });

  it("sends the lines and dates with the saved version, and no total", async () => {
    apiFetchMock.mockResolvedValue(adminInvoice({ customerNote: "Thank you." }));
    const { user } = renderEditor();

    await fill(user, screen.getByLabelText("Note for the customer"), "Thank you.");
    await user.click(button("Save draft"));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const [path, options] = apiFetchMock.mock.calls[0] ?? [];
    expect(path).toBe(`/admin/invoices/${INVOICE_ID}`);
    expect(options).toMatchObject({ method: "PATCH" });
    expect((options as { body: unknown }).body).toEqual({
      lines: [
        { description: "Diagnostic visit", quantity: "1", unitPrice: "79.00", taxable: false },
        { description: "Run capacitor", quantity: "1", unitPrice: "45.50", taxable: true },
        { description: "Labour", quantity: "1.5", unitPrice: "85.00", taxable: false },
      ],
      discountAmount: "0.00",
      taxRate: "8.00",
      issueDate: null,
      dueDate: "2026-03-16",
      customerNote: "Thank you.",
      expectedUpdatedAt: "2026-03-02T14:05:00.000Z",
    });
  });

  it("says the draft is saved only after the server has said so", async () => {
    let finish: (value: unknown) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Thank you.");

    await user.click(button("Save draft"));
    expect(button("Save draft")).toHaveAttribute("aria-busy", "true");
    expect(toastSuccess).not.toHaveBeenCalled();
    await user.click(button("Save draft"));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    finish(adminInvoice({ customerNote: "Thank you.", updatedAt: "2026-03-02T14:09:00.000Z" }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Draft saved", {
        description: "The total is $255.64, worked out from the saved lines.",
      }),
    );
    await waitFor(() => expect(button("Issue invoice…")).toBeEnabled());
    expect(refresh).toHaveBeenCalled();
  });
});

describe("InvoiceEditor: when the form is wrong", () => {
  it("stops a save with a due date before the issue date, naming the field", async () => {
    const { user } = renderEditor();

    await fill(user, screen.getByLabelText("Issue date"), "2026-03-20");
    await user.click(button("Save draft"));

    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(
      await screen.findAllByText("The due date can't be before the issue date."),
    ).not.toHaveLength(0);
    expect(screen.getByLabelText(/^Due date/)).toHaveAttribute("aria-invalid", "true");
  });

  it("puts the server's field errors beside the row and field they belong to", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "The request contains invalid values.",
        fieldErrors: { "lines.1.unitPrice": "Enter a price from 0.00 to 999,999.99." },
      }),
    );
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Hello.");

    await user.click(button("Save draft"));

    expect(await within(row(2)).findByText("Enter a price from 0.00 to 999,999.99.")).toBeVisible();
    expect(screen.getByLabelText("Note for the customer")).toHaveValue("Hello.");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("explains a draft that someone else changed and offers the latest version", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError({ status: 409, code: "STALE_STATE", message: "Updated by someone else." }),
    );
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Mine.");
    await user.click(button("Save draft"));
    expect(await screen.findByRole("alert")).toHaveTextContent("was changed somewhere else");

    apiFetchMock.mockResolvedValueOnce(
      adminInvoice({ customerNote: "Theirs.", updatedAt: "2026-03-02T14:20:00.000Z" }),
    );
    await user.click(button("Load the latest version"));

    await waitFor(() =>
      expect(screen.getByLabelText("Note for the customer")).toHaveValue("Theirs."),
    );
    expect(apiFetchMock).toHaveBeenLastCalledWith(`/admin/invoices/${INVOICE_ID}`);
  });

  it("reloads the page when the invoice was issued meanwhile (not editable)", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "INVOICE_NOT_EDITABLE",
        message: "An issued invoice can't be edited.",
      }),
    );
    const { user } = renderEditor();
    await fill(user, screen.getByLabelText("Note for the customer"), "Late.");
    await user.click(button("Save draft"));

    expect(await screen.findByRole("alert")).toHaveTextContent("can no longer be edited");
    expect(refresh).toHaveBeenCalled();
  });
});

describe("InvoiceEditor: issuing", () => {
  it("asks first, says it locks the contents and that corrections need a void, and sends nothing on Not yet", async () => {
    const { user } = renderEditor();

    await user.click(button("Issue invoice…"));

    const dialog = await screen.findByRole("alertdialog", {
      name: "Issue the invoice to Amara Okafor?",
    });
    expect(dialog).toHaveAccessibleDescription(
      /This assigns invoice number INV-… and locks its contents\. Corrections after issuing require voiding\./,
    );
    await user.click(within(dialog).getByRole("button", { name: "Not yet" }));
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("issues with the status the screen showed, then says so and reloads", async () => {
    apiFetchMock.mockResolvedValue(issuedInvoice());
    const { user } = renderEditor();
    await user.click(button("Issue invoice…"));
    const dialog = await screen.findByRole("alertdialog");

    await user.click(within(dialog).getByRole("button", { name: "Issue invoice" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/invoices/${INVOICE_ID}/issue`, {
      method: "POST",
      body: { expectedStatus: "DRAFT" },
    });
    expect(toastSuccess).toHaveBeenCalledWith("Invoice INV-2026-00004 was issued", {
      description: "Amara Okafor was notified in their portal and by email.",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("closes the dialog and shows the server's reason beside the field when the draft cannot be issued", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "The request contains invalid values.",
        fieldErrors: {
          dueDate: "The due date can't be before the issue date.",
          totalAmount: "The total must be more than zero before the invoice can be issued.",
        },
      }),
    );
    const { user } = renderEditor();
    await user.click(button("Issue invoice…"));
    const dialog = await screen.findByRole("alertdialog");

    await user.click(within(dialog).getByRole("button", { name: "Issue invoice" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent).join(" ")).toContain(
      "The total must be more than zero",
    );
    expect(screen.getByLabelText(/^Due date/)).toHaveAttribute("aria-invalid", "true");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("will not issue a saved draft whose total is zero, and says why", () => {
    renderEditor({
      lines: [
        {
          id: "line-1",
          position: 1,
          description: "Goodwill visit",
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
      balanceDue: "0.00",
    });

    expect(button("Issue invoice…")).toBeDisabled();
    expect(button("Issue invoice…")).toHaveAccessibleDescription(/needs a total above zero/);
    expect(button("Preview")).toBeEnabled();
  });
});

describe("InvoiceEditor: voiding the draft", () => {
  it("asks for a reason, voids with the draft status and goes back to the job", async () => {
    apiFetchMock.mockResolvedValue({});
    const { user } = renderEditor();

    await user.click(button("More actions"));
    await user.click(await screen.findByRole("menuitem", { name: "Void invoice" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Void the draft invoice?" });
    expect(dialog).toHaveAccessibleDescription(/never saw it, so they are not told/);
    const confirm = within(dialog).getByRole("button", { name: "Void invoice" });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByLabelText(/Reason/));
    await user.paste("Created for the wrong job.");
    await user.click(confirm);

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/jobs/${JOB_ID}`));
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/invoices/${INVOICE_ID}/void`, {
      method: "POST",
      body: { reason: "Created for the wrong job.", expectedStatus: "DRAFT" },
    });
  });
});
