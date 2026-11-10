import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InvoiceDocument } from "@/features/admin/components/invoice-document";

import {
  customerInvoice,
  customerInvoiceListItem,
  customerJob,
  partlyPaidCustomerInvoice,
  PORTAL_INVOICE_ID,
  PORTAL_TIME_ZONE,
} from "../test-fixtures";
import { InvoiceBanner } from "./invoice-banner";
import { InvoiceCard, InvoiceList } from "./invoice-cards";
import { JobLinksCard } from "./job-details";
import { OutstandingInvoices } from "./outstanding-invoices";

describe("InvoiceCard", () => {
  it("shows the number as the link, the status as text, the service, the dates, the total and the balance", () => {
    render(
      <ul>
        <InvoiceCard invoice={customerInvoiceListItem()} timeZone={PORTAL_TIME_ZONE} />
      </ul>,
    );
    const card = screen.getByTestId("portal-invoice-card");
    const link = within(card).getByRole("link", { name: /INV-2026-00004/ });
    expect(link).toHaveAttribute("href", `/portal/invoices/${PORTAL_INVOICE_ID}`);
    expect(link).toHaveAccessibleName(/for AC Repair/);
    // The status is a badge with text (not colour alone), beside the "Issued" label of the date.
    expect(within(card).getByText("Issued", { selector: "dt" })).toBeVisible();
    expect(within(card).getAllByText("Issued")).toHaveLength(2);
    expect(within(card).getByText("AC Repair")).toBeVisible();
    expect(card).toHaveTextContent("Balance due $255.64 by Mar 16, 2026");
    expect(within(card).getByText("Mar 2, 2026")).toBeVisible();
    expect(within(card).getAllByText("Mar 16, 2026").length).toBeGreaterThan(0);
    expect(within(card).getByText("$255.64")).toBeVisible();
  });

  it("says how late an overdue invoice is, in words as well as colour", () => {
    render(
      <ul>
        <InvoiceCard
          invoice={customerInvoiceListItem({
            status: "OVERDUE",
            statusLabel: "Overdue",
            daysOverdue: 4,
          })}
          timeZone={PORTAL_TIME_ZONE}
        />
      </ul>,
    );
    const card = screen.getByTestId("portal-invoice-card");
    expect(card).toHaveTextContent("Overdue: $255.64 was due Mar 16, 2026");
    expect(card).toHaveTextContent("Overdue by 4 days");
  });

  it("says a paid invoice is paid, and has no balance to pay", () => {
    render(
      <ul>
        <InvoiceCard
          invoice={customerInvoiceListItem({
            status: "PAID",
            statusLabel: "Paid",
            amountPaid: "255.64",
            balanceDue: "0.00",
          })}
          timeZone={PORTAL_TIME_ZONE}
        />
      </ul>,
    );
    const card = screen.getByTestId("portal-invoice-card");
    expect(card).toHaveTextContent("Paid in full");
    expect(card).not.toHaveTextContent("Balance due");
  });
});

describe("InvoiceList", () => {
  it("is a named list with one card per invoice", () => {
    render(
      <InvoiceList
        label="Your invoices"
        timeZone={PORTAL_TIME_ZONE}
        invoices={[
          customerInvoiceListItem({ id: "a", invoiceNumber: "INV-2026-00001" }),
          customerInvoiceListItem({ id: "b", invoiceNumber: "INV-2026-00002" }),
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Your invoices" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("InvoiceBanner", () => {
  it("leads with the balance and when it is due", () => {
    render(<InvoiceBanner invoice={customerInvoice()} />);
    const banner = screen.getByTestId("portal-invoice-banner");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent("Balance due $255.64 by Mar 16, 2026");
  });

  it("says what has been received on a part-paid invoice", () => {
    render(<InvoiceBanner invoice={partlyPaidCustomerInvoice()} />);
    const banner = screen.getByTestId("portal-invoice-banner");
    expect(banner).toHaveTextContent("Balance due $155.64 by Mar 16, 2026");
    expect(banner).toHaveTextContent("$100.00 of $255.64 has been received.");
  });

  it("says Overdue, how many days, and what has been paid", () => {
    render(
      <InvoiceBanner
        invoice={partlyPaidCustomerInvoice({
          status: "OVERDUE",
          statusLabel: "Overdue",
          daysOverdue: 5,
        })}
      />,
    );
    const banner = screen.getByTestId("portal-invoice-banner");
    expect(banner).toHaveTextContent("Overdue: $155.64 was due Mar 16, 2026");
    expect(banner).toHaveTextContent("Overdue by 5 days.");
    expect(banner).toHaveTextContent("$100.00 of $255.64 has been received.");
  });

  it("asks an overdue invoice with nothing paid to be paid", () => {
    render(
      <InvoiceBanner
        invoice={customerInvoice({ status: "OVERDUE", statusLabel: "Overdue", daysOverdue: 1 })}
      />,
    );
    const banner = screen.getByTestId("portal-invoice-banner");
    expect(banner).toHaveTextContent("Overdue by 1 day.");
    expect(banner).toHaveTextContent("Please pay as soon as you can.");
  });

  it("thanks the customer for a paid invoice, with the day it was paid", () => {
    render(
      <InvoiceBanner
        invoice={customerInvoice({
          status: "PAID",
          statusLabel: "Paid",
          amountPaid: "255.64",
          balanceDue: "0.00",
          paidOn: "2026-03-03",
        })}
      />,
    );
    const banner = screen.getByTestId("portal-invoice-banner");
    expect(banner).toHaveTextContent("Paid in full on Mar 3, 2026");
    expect(banner).toHaveTextContent("Nothing is owed on this invoice.");
  });

  it("says a withdrawn invoice was withdrawn, and gives no reason", () => {
    render(
      <InvoiceBanner
        invoice={customerInvoice({
          status: "VOID",
          statusLabel: "Void",
          voidedAt: "2026-03-05T15:00:00.000Z",
        })}
      />,
    );
    const banner = screen.getByTestId("portal-invoice-banner");
    expect(banner).toHaveTextContent("The business withdrew this invoice on Mar 5, 2026.");
    expect(banner).toHaveTextContent("Nothing is owed on it.");
    expect(banner).not.toHaveTextContent(/reason/i);
  });

  it("is not printed: the document is", () => {
    render(<InvoiceBanner invoice={customerInvoice()} />);
    expect(screen.getByTestId("portal-invoice-banner").className).toContain("print:hidden");
  });
});

describe("InvoiceDocument as the customer's page draws it", () => {
  function renderDocument(invoice = partlyPaidCustomerInvoice()) {
    render(
      <InvoiceDocument invoice={invoice} timeZone={PORTAL_TIME_ZONE} payments={invoice.payments} />,
    );
    return screen.getByTestId("invoice-document");
  }

  it("lists the payments received: day, method and amount", () => {
    const document = renderDocument();
    const section = within(document).getByTestId("invoice-document-payments");
    expect(within(section).getByRole("heading", { name: "Payments received" })).toBeVisible();
    const list = within(section).getByRole("list", { name: "Payments received" });
    const [row] = within(list).getAllByRole("listitem");
    expect(row).toHaveTextContent("Mar 5, 2026");
    expect(row).toHaveTextContent("Bank transfer");
    expect(row).toHaveTextContent("$100.00");
  });

  it("says no payment has been recorded when there is none", () => {
    const document = renderDocument(customerInvoice());
    expect(within(document).getByTestId("invoice-document-payments")).toHaveTextContent(
      "No payments have been recorded yet.",
    );
  });

  it("has the payment instructions and says FixFlow does not process payments", () => {
    const document = renderDocument();
    const how = within(document).getByRole("region", { name: "How to pay" });
    expect(how).toHaveTextContent("Pay by bank transfer, quoting the invoice number");
    expect(how).toHaveTextContent("Please quote INV-2026-00004 with your payment.");
    expect(how).toHaveTextContent(
      "Payments are made directly to CoolBreeze Home Services; FixFlow doesn't process payments.",
    );
  });

  it("has the amount paid and the balance due in its totals", () => {
    const document = renderDocument();
    expect(document).toHaveTextContent("Amount paid");
    expect(document).toHaveTextContent("-$100.00");
    expect(document).toHaveTextContent("Balance due");
    expect(document).toHaveTextContent("$155.64");
  });

  it("gives a withdrawn invoice no payment instructions", () => {
    const document = renderDocument(
      customerInvoice({
        status: "VOID",
        statusLabel: "Void",
        voidedAt: "2026-03-05T15:00:00.000Z",
      }),
    );
    expect(within(document).queryByRole("region", { name: "How to pay" })).not.toBeInTheDocument();
    expect(within(document).getByTestId("invoice-void-mark")).toBeVisible();
  });

  it("draws no payments section where none were handed over (the business's own page)", () => {
    render(<InvoiceDocument invoice={customerInvoice()} timeZone={PORTAL_TIME_ZONE} />);
    expect(screen.queryByTestId("invoice-document-payments")).not.toBeInTheDocument();
  });
});

describe("OutstandingInvoices", () => {
  it("draws nothing when nothing is owed", () => {
    const { container } = render(
      <OutstandingInvoices invoices={[]} totalItems={0} timeZone={PORTAL_TIME_ZONE} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is a region named Outstanding invoices, with each invoice and a way to all of them", () => {
    render(
      <OutstandingInvoices
        invoices={[
          customerInvoiceListItem({ id: "a", invoiceNumber: "INV-2026-00001" }),
          customerInvoiceListItem({
            id: "b",
            invoiceNumber: "INV-2026-00002",
            status: "OVERDUE",
            daysOverdue: 2,
          }),
        ]}
        totalItems={5}
        timeZone={PORTAL_TIME_ZONE}
      />,
    );
    const region = screen.getByRole("region", { name: "Outstanding invoices" });
    expect(region).toHaveTextContent("You have 5 invoices that still have a balance to pay.");
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(within(region).getByRole("link", { name: "View all invoices" })).toHaveAttribute(
      "href",
      "/portal/invoices",
    );
  });

  it("says it in the singular for one invoice", () => {
    render(
      <OutstandingInvoices
        invoices={[customerInvoiceListItem()]}
        totalItems={1}
        timeZone={PORTAL_TIME_ZONE}
      />,
    );
    expect(screen.getByRole("region", { name: "Outstanding invoices" })).toHaveTextContent(
      "You have an invoice that still has a balance to pay.",
    );
  });
});

describe("JobLinksCard's invoice link (T22)", () => {
  it("links the invoice with its number and status once one is issued", () => {
    render(
      <JobLinksCard
        job={customerJob({
          invoice: {
            id: PORTAL_INVOICE_ID,
            invoiceNumber: "INV-2026-00004",
            status: "PARTIALLY_PAID",
            statusLabel: "Partially paid",
          },
        })}
      />,
    );
    const link = screen.getByRole("link", { name: /INV-2026-00004/ });
    expect(link).toHaveAttribute("href", `/portal/invoices/${PORTAL_INVOICE_ID}`);
    expect(screen.getByText("Partially paid")).toBeVisible();
  });

  it("has no invoice entry before then", () => {
    render(<JobLinksCard job={customerJob({ invoice: null })} />);
    expect(screen.queryByText("Invoice")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /INV-/ })).not.toBeInTheDocument();
  });
});
