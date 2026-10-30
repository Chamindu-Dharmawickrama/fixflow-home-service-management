import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { adminCustomer, CUSTOMER_ID } from "../test-fixtures";
import {
  CustomerAddressesCard,
  CustomerContactLinks,
  CustomerSummary,
} from "./customer-detail-cards";

describe("CustomerContactLinks", () => {
  it("links the email and the phone number so the customer can be reached", () => {
    render(<CustomerContactLinks email="amara.okafor@example.com" phone="(212) 555-0142" />);

    expect(screen.getByRole("link", { name: "Email amara.okafor@example.com" })).toHaveAttribute(
      "href",
      "mailto:amara.okafor@example.com",
    );
    expect(screen.getByRole("link", { name: "Call (212) 555-0142" })).toHaveAttribute(
      "href",
      "tel:(212) 555-0142",
    );
  });

  it("says so when there is no phone number, instead of an empty link", () => {
    render(<CustomerContactLinks email="amara.okafor@example.com" phone={null} />);

    expect(screen.getByText("No phone number given")).toBeVisible();
    expect(screen.queryByRole("link", { name: /Call/ })).not.toBeInTheDocument();
  });
});

describe("CustomerSummary", () => {
  const summary = adminCustomer().summary;

  it("shows the requests, the open jobs and the balance, each a link to the records behind it", () => {
    render(<CustomerSummary customerId={CUSTOMER_ID} summary={summary} />);

    const region = within(screen.getByRole("region", { name: "Summary" }));
    expect(region.getByRole("link", { name: "Requests" })).toHaveAttribute(
      "href",
      `/app/customers/${CUSTOMER_ID}?tab=requests`,
    );
    expect(region.getByRole("link", { name: "Open jobs" })).toHaveAttribute(
      "href",
      `/app/customers/${CUSTOMER_ID}?tab=jobs`,
    );
    expect(region.getByRole("link", { name: "Outstanding balance" })).toHaveAttribute(
      "href",
      `/app/customers/${CUSTOMER_ID}?tab=invoices`,
    );
  });

  it("counts truthfully, with the context of each figure", () => {
    render(<CustomerSummary customerId={CUSTOMER_ID} summary={summary} />);

    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("2 quotations")).toBeVisible();
    expect(screen.getByText("1")).toBeVisible();
    expect(screen.getByText("2 in total")).toBeVisible();
  });

  it("shows the balance as money with its currency, and says what it is owed on", () => {
    render(<CustomerSummary customerId={CUSTOMER_ID} summary={summary} />);

    expect(screen.getByText("$175.50")).toBeVisible();
    expect(screen.getByText("Still to be paid, across 1 invoice")).toBeVisible();
  });

  it("flags a balance that is owed in amber, in words as well, and leaves a clear one plain", () => {
    const { rerender } = render(<CustomerSummary customerId={CUSTOMER_ID} summary={summary} />);
    expect(screen.getByText("$175.50").closest("p")).toHaveClass("text-attention");
    // The colour is never the only signal: the card also says what the amount is.
    expect(screen.getByText(/Still to be paid/)).toBeVisible();

    rerender(
      <CustomerSummary
        customerId={CUSTOMER_ID}
        summary={{ ...summary, outstandingBalance: "0.00" }}
      />,
    );
    expect(screen.getByText("$0.00").closest("p")).not.toHaveClass("text-attention");
  });

  it("is calm about a customer who owes nothing", () => {
    render(
      <CustomerSummary
        customerId={CUSTOMER_ID}
        summary={{ ...summary, outstandingBalance: "0.00", invoiceCount: 0 }}
      />,
    );

    expect(screen.getByText("$0.00")).toBeVisible();
    expect(screen.getByText("0 invoices")).toBeVisible();
    expect(screen.queryByText(/Still to be paid/)).not.toBeInTheDocument();
  });

  it("uses the currency it is given", () => {
    render(
      <CustomerSummary
        customerId={CUSTOMER_ID}
        summary={{ ...summary, outstandingBalance: "1284.50", currencyCode: "EUR" }}
      />,
    );

    expect(screen.getByText("€1,284.50")).toBeVisible();
  });

  it("uses the singular for one of anything", () => {
    render(
      <CustomerSummary
        customerId={CUSTOMER_ID}
        summary={{ ...summary, quotationCount: 1, invoiceCount: 1 }}
      />,
    );

    expect(screen.getByText("1 quotation")).toBeVisible();
  });
});

describe("CustomerAddressesCard", () => {
  const addresses = adminCustomer().addresses;

  it("lists every address with its label, its lines and the default marked in words", () => {
    render(<CustomerAddressesCard addresses={addresses} />);

    expect(screen.getByRole("heading", { level: 2, name: "Service addresses" })).toBeVisible();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    const home = within(items[0] as HTMLElement);
    expect(home.getByRole("heading", { level: 3, name: "Home" })).toBeVisible();
    expect(home.getByText("Default")).toBeVisible();
    expect(home.getByText(/214 Larkspur Lane, Unit 4/)).toBeVisible();
    expect(home.getByText(/Harbor City, NY 10001/)).toBeVisible();

    const rental = within(items[1] as HTMLElement);
    expect(rental.getByRole("heading", { level: 3, name: "Rental" })).toBeVisible();
    expect(rental.queryByText("Default")).not.toBeInTheDocument();
    expect(rental.getByText(/9 Quay Street/)).toBeVisible();
    expect(rental.getByText(/Port Elm 20002/)).toBeVisible();
  });

  it("shows the access notes the team needs on site, with their line breaks, and only where given", () => {
    render(<CustomerAddressesCard addresses={addresses} />);

    const notes = screen.getByText(/Gate code 4821\./);
    expect(notes).toBeVisible();
    expect(notes).toHaveClass("whitespace-pre-line");
    expect(screen.getAllByText(/Access notes:/)).toHaveLength(1);
  });

  it("says so when no address is saved", () => {
    render(<CustomerAddressesCard addresses={[]} />);

    expect(screen.getByText(/No address saved yet/)).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
