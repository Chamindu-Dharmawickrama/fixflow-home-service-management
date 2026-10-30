import { PricingMode, type PublicServiceDto } from "@fixflow/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ServiceDetail } from "./service-detail";

function makeService(overrides: Partial<PublicServiceDto> = {}): PublicServiceDto {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "AC Routine Maintenance",
    slug: "ac-routine-maintenance",
    category: "Air conditioning",
    shortDescription: "A yearly service that keeps your air conditioner efficient.",
    fullDescription: "First paragraph about the service.\n\nSecond paragraph with more detail.",
    inclusions: ["Filter and coil cleaning", "Refrigerant level check"],
    estimatedDurationMinutes: 90,
    pricingMode: PricingMode.FIXED,
    startingPrice: "129.00",
    currencyCode: "USD",
    imageKey: "air-conditioning",
    imageUrl: null,
    ...overrides,
  };
}

const OTHERS = [
  makeService({
    id: "2",
    name: "AC Diagnostic Visit",
    slug: "ac-diagnostic-visit",
    shortDescription: "A technician finds out why your air conditioner is warm.",
  }),
  makeService({
    id: "3",
    name: "Home Deep Cleaning",
    slug: "home-deep-cleaning",
    category: "Cleaning",
    shortDescription: "A top-to-bottom clean of kitchens and bathrooms.",
    pricingMode: PricingMode.QUOTE_REQUIRED,
    startingPrice: null,
  }),
];

function setup(service: PublicServiceDto, others: readonly PublicServiceDto[] = OTHERS) {
  render(
    <ServiceDetail slug={service.slug} result={{ status: "ok", data: [service, ...others] }} />,
  );
}

describe("ServiceDetail", () => {
  it("shows the name as the one h1, the short description and the category", () => {
    setup(makeService());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AC Routine Maintenance");
    expect(
      screen.getByText("A yearly service that keeps your air conditioner efficient."),
    ).toBeVisible();
    const banner = screen.getByRole("heading", { level: 1 }).closest("section");
    expect(within(banner as HTMLElement).getByText("Air conditioning")).toBeVisible();
  });

  it("has breadcrumbs back to the list and the home page, ending at the current service", () => {
    setup(makeService());

    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(crumbs.getByRole("link", { name: "Services" })).toHaveAttribute("href", "/services");
    expect(crumbs.getByText("AC Routine Maintenance")).toHaveAttribute("aria-current", "page");
  });

  it("splits the full description into paragraphs and lists what is included", () => {
    setup(makeService());

    expect(screen.getByText("First paragraph about the service.")).toBeVisible();
    expect(screen.getByText("Second paragraph with more detail.")).toBeVisible();
    const included = screen.getByRole("heading", { name: "What's included" }).parentElement;
    expect(within(included as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
  });

  it("omits the inclusions heading when the service lists none", () => {
    setup(makeService({ inclusions: [] }));

    expect(screen.queryByRole("heading", { name: "What's included" })).not.toBeInTheDocument();
  });

  it("states the starting price of a fixed-price service and that the quotation settles it", () => {
    setup(makeService());

    expect(
      screen.getByText("Starting from $129.00 — final price confirmed in your written quotation"),
    ).toBeVisible();
  });

  it("says a quoted service is priced after review", () => {
    setup(makeService({ pricingMode: PricingMode.QUOTE_REQUIRED, startingPrice: null }));

    expect(screen.getByText("Priced after we review your request")).toBeVisible();
    expect(screen.queryByText(/Starting from/)).not.toBeInTheDocument();
  });

  it("shows the usual duration only when there is an estimate", () => {
    const { unmount } = render(
      <ServiceDetail
        slug="ac-routine-maintenance"
        result={{ status: "ok", data: [makeService(), ...OTHERS] }}
      />,
    );
    expect(screen.getAllByText(/Usually takes/).length).toBeGreaterThan(0);
    unmount();

    setup(makeService({ estimatedDurationMinutes: null }), []);
    expect(screen.queryByText(/Usually takes/)).not.toBeInTheDocument();
  });

  it("offers a Request this service link to the request form with this service chosen", () => {
    setup(makeService());

    expect(screen.getByRole("link", { name: "Request this service" })).toHaveAttribute(
      "href",
      "/request-service?service=ac-routine-maintenance",
    );
  });

  it("suggests other services, the same category first, never the one being viewed", () => {
    setup(makeService());

    const related = within(screen.getByRole("region", { name: "Other services you may need" }));
    const names = related
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(names).toEqual(["AC Diagnostic Visit", "Home Deep Cleaning"]);
    expect(related.queryByText("AC Routine Maintenance")).not.toBeInTheDocument();
  });

  it("has no related section when it is the only service", () => {
    setup(makeService(), []);

    expect(
      screen.queryByRole("region", { name: "Other services you may need" }),
    ).not.toBeInTheDocument();
  });

  it("says it cannot show the service, with a retry to the same page, when the API is unreachable", () => {
    render(<ServiceDetail slug="ac-routine-maintenance" result={{ status: "unavailable" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("We can't show this service right now");
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/services/ac-routine-maintenance",
    );
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
