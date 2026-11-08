import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import {
  adminInvoice,
  CUSTOMER_ID,
  INVOICE_ID,
  invoiceListItem,
  issuedInvoice,
  JOB_ID,
} from "../test-fixtures";
import { CreateInvoiceButton } from "./create-invoice-button";
import { InvoiceActions } from "./invoice-actions";
import { InvoiceDocument } from "./invoice-document";
import {
  InvoiceDetailsCard,
  InvoiceHistoryCard,
  InvoicePaymentsCard,
  InvoiceStatusBanner,
} from "./invoice-readonly-cards";
import { InvoiceStatusChips } from "./invoice-status-chips";
import { InvoicesEmpty } from "./invoices-empty";
import { InvoicesTable } from "./invoices-table";

const refresh = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/components/ui/sonner", () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
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

describe("InvoiceDocument", () => {
  it("draws the business, the customer, the number, both dates, the lines and every total", () => {
    render(
      <InvoiceDocument
        invoice={issuedInvoice({ issueDate: "2026-03-02", dueDate: "2026-03-16" })}
        timeZone={TIME_ZONE}
      />,
    );
    const document = screen.getByRole("article", { name: "INV-2026-00004" });
    const doc = within(document);

    expect(doc.getByText("CoolBreeze Home Services")).toBeVisible();
    expect(doc.getByText("48 Harbor Point Road")).toBeVisible();
    expect(doc.getByText("Amara Okafor")).toBeVisible();
    expect(doc.getByText("214 Larkspur Lane")).toBeVisible();
    expect(doc.getByText(/Issued/)).toHaveTextContent("Mar 2, 2026");
    expect(doc.getByText(/Due/)).toHaveTextContent("Mar 16, 2026");
    expect(doc.getByText("For job JOB-2026-00007")).toBeVisible();
    expect(doc.getAllByText("Run capacitor").length).toBeGreaterThan(0);
    for (const total of ["$252.00", "$3.64", "$255.64"]) {
      expect(doc.getAllByText(total).length).toBeGreaterThan(0);
    }
  });

  it("shows the amount paid and the balance due, and a payment as an amount taken off", () => {
    render(
      <InvoiceDocument
        invoice={issuedInvoice({
          status: "PARTIALLY_PAID",
          amountPaid: "100.00",
          balanceDue: "155.64",
        })}
        timeZone={TIME_ZONE}
      />,
    );
    const document = within(screen.getByTestId("invoice-document"));
    expect(document.getByText("Amount paid")).toBeVisible();
    expect(document.getByText("-$100.00")).toBeVisible();
    expect(document.getByText("Balance due")).toBeVisible();
    expect(document.getByText("$155.64")).toBeVisible();
  });

  it("shows a balance due equal to the total, and no minus sign, when nothing is paid", () => {
    render(<InvoiceDocument invoice={issuedInvoice()} timeZone={TIME_ZONE} />);
    const document = within(screen.getByTestId("invoice-document"));
    const paid = document.getByText("Amount paid").closest("div") as HTMLElement;
    expect(paid).toHaveTextContent("$0.00");
    expect(paid).not.toHaveTextContent("-");
    const due = document.getByText("Balance due").closest("div") as HTMLElement;
    expect(due).toHaveTextContent("$255.64");
  });

  it("prints the payment instructions, the customer's note and the footer", () => {
    render(
      <InvoiceDocument
        invoice={issuedInvoice({ customerNote: "Thank you for your patience." })}
        timeZone={TIME_ZONE}
      />,
    );
    const document = within(screen.getByTestId("invoice-document"));
    expect(document.getByRole("heading", { name: "How to pay" })).toBeVisible();
    expect(document.getByText(/Pay by bank transfer/)).toBeVisible();
    expect(document.getByText("Please quote INV-2026-00004 with your payment.")).toBeVisible();
    expect(document.getByText("Thank you for your patience.")).toBeVisible();
    expect(document.getByText("Thank you for choosing CoolBreeze Home Services.")).toBeVisible();
  });

  it("leaves out the sections that are empty", () => {
    render(
      <InvoiceDocument
        invoice={issuedInvoice({ paymentInstructions: null, footer: null, customerNote: null })}
        timeZone={TIME_ZONE}
      />,
    );
    const document = within(screen.getByTestId("invoice-document"));
    expect(document.queryByRole("heading", { name: "How to pay" })).not.toBeInTheDocument();
    expect(document.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(document.queryByText(/Note from/)).not.toBeInTheDocument();
  });

  it("marks a draft as not issued and has no number yet", () => {
    render(<InvoiceDocument invoice={adminInvoice()} timeZone={TIME_ZONE} />);
    expect(screen.getByTestId("invoice-draft-mark")).toHaveTextContent("Draft: not issued yet");
    expect(screen.getByRole("heading", { name: "Not numbered yet" })).toBeVisible();
    expect(screen.getByText("Issue date: the day it is issued")).toBeVisible();
  });

  it("marks a voided invoice and says how late an overdue one is", () => {
    const { rerender } = render(
      <InvoiceDocument
        invoice={issuedInvoice({ status: "VOID", statusLabel: "Void" })}
        timeZone={TIME_ZONE}
      />,
    );
    expect(screen.getByTestId("invoice-void-mark")).toHaveTextContent("Void");
    rerender(
      <InvoiceDocument
        invoice={issuedInvoice({ status: "OVERDUE", statusLabel: "Overdue", daysOverdue: 4 })}
        timeZone={TIME_ZONE}
      />,
    );
    expect(screen.getByText("Overdue by 4 days")).toBeVisible();
  });

  it("is a single column of block content, with nothing that would clip on paper", () => {
    render(<InvoiceDocument invoice={issuedInvoice()} timeZone={TIME_ZONE} />);
    const article = screen.getByTestId("invoice-document");
    expect(article.className).toContain("print:border-0");
    expect(article.className).toContain("print:p-0");
    // No fixed pixel width or height anywhere in the document, so A4 and Letter both fit.
    expect(article.innerHTML).not.toMatch(/\bw-\[\d+px\]|\bh-\[\d+px\]|min-w-\[\d+px\]/);
  });
});

describe("InvoiceStatusBanner", () => {
  const banner = (invoice: ReturnType<typeof issuedInvoice>) => {
    render(<InvoiceStatusBanner invoice={invoice} timeZone={TIME_ZONE} />);
  };

  it("says an issued invoice is locked and where to correct it", () => {
    banner(issuedInvoice({ dueDate: "2026-03-16" }));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Issued Mar 2, 2026 · due Mar 16, 2026");
    expect(status).toHaveTextContent("void this invoice and start a new one");
  });

  it("says Overdue by N days", () => {
    banner(issuedInvoice({ status: "OVERDUE", daysOverdue: 4 }));
    expect(screen.getByRole("status")).toHaveTextContent("Overdue by 4 days");
  });

  it("gives a voided invoice's reason and labels it internal", () => {
    banner(
      issuedInvoice({
        status: "VOID",
        voided: {
          at: "2026-03-03T15:00:00.000Z",
          by: { name: "Morgan Reyes" },
          reason: "Labour hours entered twice.",
        },
      }),
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Voided Mar 3, 2026: Labour hours entered twice.");
    expect(status).toHaveTextContent("The reason is internal");
    expect(status).toHaveTextContent("The job can be invoiced again");
  });

  it("draws nothing for a draft", () => {
    banner(adminInvoice());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("InvoicePaymentsCard: issued is kept apart from received", () => {
  it("says no payment is recorded and that recording comes in the next step, with no button", () => {
    render(<InvoicePaymentsCard invoice={issuedInvoice()} timeZone={TIME_ZONE} />);
    const card = within(screen.getByTestId("invoice-payments"));
    expect(card.getByRole("heading", { name: "Payments received" })).toBeVisible();
    expect(card.getByText(/No payments have been recorded/)).toBeVisible();
    expect(card.getByText(/Payments are recorded in the next step/)).toBeVisible();
    expect(card.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists the payments that exist, a voided one struck through with its reason", () => {
    render(
      <InvoicePaymentsCard
        invoice={issuedInvoice({
          payments: [
            {
              id: "p1",
              amount: "100.00",
              paymentDate: "2026-03-05",
              method: "BANK_TRANSFER",
              reference: null,
              notes: null,
              recordedBy: { name: "Morgan Reyes" },
              createdAt: "2026-03-05T15:00:00.000Z",
              voided: null,
            },
            {
              id: "p2",
              amount: "20.00",
              paymentDate: "2026-03-06",
              method: "CASH",
              reference: null,
              notes: null,
              recordedBy: { name: "Morgan Reyes" },
              createdAt: "2026-03-06T15:00:00.000Z",
              voided: {
                at: "2026-03-06T16:00:00.000Z",
                by: { name: "Morgan Reyes" },
                reason: "Wrong invoice.",
              },
            },
          ],
        })}
        timeZone={TIME_ZONE}
      />,
    );
    const card = within(screen.getByTestId("invoice-payments"));
    expect(card.getByText("$100.00")).toBeVisible();
    expect(card.getByText("$20.00")).toHaveClass("line-through");
    expect(card.getByText("Voided: Wrong invoice.")).toBeVisible();
    expect(card.queryByText(/No payments have been recorded/)).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailsCard and InvoiceHistoryCard", () => {
  it("names who did what and links to the job, the request and the quotation", () => {
    render(<InvoiceDetailsCard invoice={issuedInvoice()} timeZone={TIME_ZONE} />);
    expect(screen.getByText(/Started by/)).toBeVisible();
    expect(screen.getByText(/Issued by/)).toBeVisible();
    expect(screen.getByRole("link", { name: "JOB-2026-00007" })).toHaveAttribute(
      "href",
      `/app/jobs/${JOB_ID}`,
    );
    expect(screen.getByRole("link", { name: "FF-2026-00012" })).toBeVisible();
    expect(screen.getByRole("link", { name: "QT-2026-00009" })).toBeVisible();
  });

  it("labels the void reason as internal", () => {
    render(
      <InvoiceDetailsCard
        invoice={issuedInvoice({
          status: "VOID",
          voided: { at: "2026-03-03T15:00:00.000Z", by: null, reason: "Entered twice." },
        })}
        timeZone={TIME_ZONE}
      />,
    );
    expect(screen.getByText("Voided by")).toBeVisible();
    expect(screen.getByText(/Reason \(internal\)/)).toHaveTextContent("Entered twice.");
  });

  it("shows an empty history kindly", () => {
    render(<InvoiceHistoryCard invoice={issuedInvoice()} timeZone={TIME_ZONE} />);
    expect(screen.getByText("Nothing has happened yet.")).toBeVisible();
  });
});

describe("InvoiceActions", () => {
  it("offers Print and Void when the server lists Void", () => {
    render(<InvoiceActions invoice={issuedInvoice()} />);
    expect(screen.getByRole("button", { name: "Print" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Void invoice…" })).toBeVisible();
  });

  it("offers no Void when the server does not list it", () => {
    render(<InvoiceActions invoice={issuedInvoice({ availableActions: [] })} />);
    expect(screen.getByRole("button", { name: "Print" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /void/i })).not.toBeInTheDocument();
  });

  it("asks for a reason, voids with the status shown, says it is done and reloads", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<InvoiceActions invoice={issuedInvoice()} />);

    await user.click(screen.getByRole("button", { name: "Void invoice…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Void INV-2026-00004?" });
    expect(dialog).toHaveAccessibleDescription(/Amara Okafor is told the invoice was voided/);
    expect(dialog).toHaveAccessibleDescription(
      /an invoice with payments recorded cannot be voided/,
    );
    const confirm = within(dialog).getByRole("button", { name: "Void invoice" });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByLabelText(/Reason/));
    await user.paste("Labour hours entered twice.");
    await user.click(confirm);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/invoices/${INVOICE_ID}/void`, {
      method: "POST",
      body: { reason: "Labour hours entered twice.", expectedStatus: "ISSUED" },
    });
    expect(toastSuccess).toHaveBeenCalledWith("INV-2026-00004 was voided", expect.anything());
  });

  it("shows the server's refusal when payments exist, keeps the dialog open and reloads the page", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "INVOICE_HAS_PAYMENTS",
        message: "This invoice has payments recorded against it, so it can't be voided.",
      }),
    );
    const user = userEvent.setup();
    render(<InvoiceActions invoice={issuedInvoice()} />);
    await user.click(screen.getByRole("button", { name: "Void invoice…" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByLabelText(/Reason/));
    await user.paste("Mistake in the lines.");
    await user.click(within(dialog).getByRole("button", { name: "Void invoice" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("has payments recorded");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("InvoicesTable", () => {
  const renderTable = (invoices = [invoiceListItem()]) =>
    render(
      <InvoicesTable
        invoices={invoices}
        timeZone={TIME_ZONE}
        sort={{ field: "createdAt", order: "desc" }}
        getSortHref={(field) => `/app/invoices?sort=${field}`}
      />,
    );

  it("shows number, customer, job, dates, total, balance and status, with the number as the link", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Invoices" });
    const row = within(table).getAllByRole("row")[1] as HTMLElement;

    expect(within(row).getByRole("link", { name: "INV-2026-00004" })).toHaveAttribute(
      "href",
      `/app/invoices/${INVOICE_ID}`,
    );
    expect(within(row).getByText("Amara Okafor")).toBeVisible();
    expect(within(row).getByText("JOB-2026-00007")).toBeVisible();
    expect(within(row).getByText("Mar 2, 2026")).toBeVisible();
    expect(within(row).getByText("Mar 16, 2026")).toBeVisible();
    expect(within(row).getAllByText("$255.64")).toHaveLength(2); // total and balance
    expect(within(row).getByText("Issued")).toBeVisible();
  });

  it("calls a draft 'Draft' instead of leaving the number blank, and shows no balance", () => {
    renderTable([
      invoiceListItem({
        invoiceNumber: null,
        status: "DRAFT",
        statusLabel: "Draft",
        issueDate: null,
      }),
    ]);
    const table = screen.getByRole("table", { name: "Invoices" });
    const row = within(table).getAllByRole("row")[1] as HTMLElement;
    expect(within(row).getByRole("link", { name: "Draft" })).toBeVisible();
    expect(within(row).getByText("Not issued")).toBeVisible();
    expect(within(row).getAllByText("$255.64")).toHaveLength(1); // the total only
    expect(within(row).getByLabelText("Not applicable")).toBeVisible();
  });

  it("shows the days overdue beside an overdue status", () => {
    renderTable([invoiceListItem({ status: "OVERDUE", statusLabel: "Overdue", daysOverdue: 4 })]);
    const table = screen.getByRole("table", { name: "Invoices" });
    expect(within(table).getByText("Overdue")).toBeVisible();
    expect(within(table).getByText("Overdue by 4 days")).toBeVisible();
  });

  it("makes the issue date, due date, total and status sortable, with the link to flip each", () => {
    renderTable();
    for (const name of ["Issued", "Due", "Total", "Status"]) {
      const header = screen.getByRole("columnheader", { name: new RegExp(name) });
      expect(within(header).getByRole("link")).toHaveAttribute(
        "href",
        expect.stringContaining("sort="),
      );
    }
  });
});

describe("InvoiceStatusChips", () => {
  const counts = { all: 9, DRAFT: 1, ISSUED: 3, PARTIALLY_PAID: 1, PAID: 2, OVERDUE: 2, VOID: 0 };

  it("has All and one chip for each status, each with its count in its name", () => {
    render(<InvoiceStatusChips selected={undefined} counts={counts} params={{}} />);
    const nav = screen.getByRole("navigation", { name: "Filter invoices by status" });
    const names = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual([
      "All 9",
      "Draft 1",
      "Issued 3",
      "Partially paid 1",
      "Overdue 2",
      "Paid 2",
      "Void 0",
    ]);
  });

  it("marks the current chip and links each chip to its status, keeping the search", () => {
    render(<InvoiceStatusChips selected="OVERDUE" counts={counts} params={{ q: "okafor" }} />);
    expect(screen.getByRole("link", { name: "Overdue 2" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Overdue 2" })).toHaveAttribute(
      "href",
      "/app/invoices?q=okafor&status=OVERDUE",
    );
    expect(screen.getByRole("link", { name: "All 9" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "All 9" })).toHaveAttribute(
      "href",
      "/app/invoices?q=okafor",
    );
  });
});

describe("InvoicesEmpty", () => {
  const base = {
    filtered: false,
    status: undefined,
    pastLastPage: false,
    firstPageHref: "/first",
    clearFiltersHref: "/clear",
  };

  it("tells a business with no invoices where they come from", () => {
    render(<InvoicesEmpty {...base} />);
    expect(screen.getByRole("heading", { name: "No invoices yet" })).toBeVisible();
    expect(screen.getByRole("link", { name: "See jobs ready to invoice" })).toHaveAttribute(
      "href",
      "/app/jobs?view=ready-to-invoice",
    );
  });

  it("explains a search that found nothing, a page past the end, and an empty status", () => {
    const { rerender } = render(<InvoicesEmpty {...base} filtered />);
    expect(screen.getByRole("heading", { name: "No invoices match" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Clear search and filters" })).toHaveAttribute(
      "href",
      "/clear",
    );
    rerender(<InvoicesEmpty {...base} pastLastPage />);
    expect(screen.getByRole("link", { name: "Go to the first page" })).toHaveAttribute(
      "href",
      "/first",
    );
    rerender(<InvoicesEmpty {...base} status="OVERDUE" />);
    expect(screen.getByRole("heading", { name: "Nothing is overdue" })).toBeVisible();
  });
});

describe("CreateInvoiceButton", () => {
  it("asks the server to make the invoice from the completed job, then opens it", async () => {
    apiFetchMock.mockResolvedValue({ id: INVOICE_ID });
    const user = userEvent.setup();
    render(<CreateInvoiceButton jobId={JOB_ID} />);

    await user.click(screen.getByRole("button", { name: "Create invoice" }));

    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/work-orders/${JOB_ID}/invoice`, {
      method: "POST",
      body: {},
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/invoices/${INVOICE_ID}`));
  });

  it("is named for its job when it sits in a list", () => {
    render(<CreateInvoiceButton jobId={JOB_ID} jobReference="JOB-2026-00007" />);
    expect(screen.getByRole("button", { name: "Create invoice for JOB-2026-00007" })).toBeVisible();
  });

  it("is blocked while the invoice is being made, so a second press makes no second request", async () => {
    let finish: (value: { id: string }) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<CreateInvoiceButton jobId={JOB_ID} />);
    const button = screen.getByRole("button", { name: "Create invoice" });
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    finish({ id: INVOICE_ID });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it("goes to the invoice that already exists when the server says there is one", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "INVOICE_EXISTS",
        message: "This job already has an invoice.",
        details: { invoiceId: CUSTOMER_ID },
      }),
    );
    const user = userEvent.setup();
    render(<CreateInvoiceButton jobId={JOB_ID} />);

    await user.click(screen.getByRole("button", { name: "Create invoice" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/invoices/${CUSTOMER_ID}`));
    expect(toastInfo).toHaveBeenCalledWith("This job already has an invoice", expect.anything());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows any other failure as a message, reloads a job that moved on, and can be pressed again", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "INVALID_STATE_TRANSITION",
        message: "An invoice can only be created for a completed job.",
      }),
    );
    const user = userEvent.setup();
    render(<CreateInvoiceButton jobId={JOB_ID} />);

    await user.click(screen.getByRole("button", { name: "Create invoice" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith("We couldn't create the invoice", {
      description: "An invoice can only be created for a completed job.",
    });
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create invoice" })).toBeEnabled();
  });
});
