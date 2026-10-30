import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AssetPicker } from "./asset-picker";
import { BusinessLogo } from "./business-logo";
import { ServiceCard, type ServiceCardData } from "./service-card";
import { ServiceImage } from "./service-image";
import { SourceChoice } from "./source-choice";

const SERVICE: ServiceCardData = {
  name: "AC Routine Maintenance",
  category: "Air conditioning",
  shortDescription: "A yearly service that keeps your air conditioner efficient.",
  pricingMode: "FIXED",
  startingPrice: "129.00",
  currencyCode: "USD",
  estimatedDurationMinutes: 90,
  imageKey: "air-conditioning",
  imageUrl: null,
};

describe("ServiceCard", () => {
  it("shows the category, name, description, starting price and usual time", () => {
    render(<ServiceCard service={SERVICE} />);

    expect(
      screen.getByRole("heading", { level: 3, name: "AC Routine Maintenance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Air conditioning")).toBeInTheDocument();
    expect(
      screen.getByText("A yearly service that keeps your air conditioner efficient."),
    ).toBeInTheDocument();
    expect(screen.getByText("From $129.00")).toBeInTheDocument();
    expect(screen.getByText("1 hr 30 min")).toBeInTheDocument();
    expect(screen.getByText("Usually takes", { exact: false })).toHaveClass("sr-only");
  });

  it("asks for a quote when pricing is by quotation, and leaves out an unknown duration", () => {
    render(
      <ServiceCard
        service={{
          ...SERVICE,
          pricingMode: "QUOTE_REQUIRED",
          startingPrice: null,
          estimatedDurationMinutes: null,
        }}
      />,
    );

    expect(screen.getByText("Request a quote")).toBeInTheDocument();
    expect(screen.queryByText(/Usually takes/)).not.toBeInTheDocument();
  });

  it("is not a link in a preview, and one real link when given an address", () => {
    const { rerender } = render(<ServiceCard service={SERVICE} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    rerender(<ServiceCard service={SERVICE} href="/services/ac-routine-maintenance" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/services/ac-routine-maintenance");
    expect(links[0]).toHaveTextContent("AC Routine Maintenance");
  });

  it("uses the heading level the page outline needs", () => {
    render(<ServiceCard service={SERVICE} headingLevel="h2" />);

    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });
});

describe("ServiceImage", () => {
  it("shows a bundled picture as a photograph from this app, decorative and hidden from screen readers", () => {
    const { container } = render(<ServiceImage imageKey="cleaning" imageUrl={null} />);

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("alt", "");
    // Served by this app's own image optimiser from its own file, never from another site.
    expect(decodeURIComponent(image?.getAttribute("src") ?? "")).toContain(
      "/images/services/cleaning.jpg",
    );
    expect(image?.getAttribute("src")).not.toMatch(/^https?:/);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("tells the browser how wide the picture is shown, so it does not fetch more than it needs", () => {
    const { container } = render(
      <ServiceImage imageKey="cleaning" imageUrl={null} sizes="(min-width: 1024px) 800px, 100vw" />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "sizes",
      "(min-width: 1024px) 800px, 100vw",
    );
  });

  it("prefers the bundled photograph to a web address", () => {
    const { container } = render(
      <ServiceImage imageKey="cleaning" imageUrl="https://cdn.example.test/a.jpg" />,
    );

    const sources = [...container.querySelectorAll("img")].map((image) =>
      decodeURIComponent(image.getAttribute("src") ?? ""),
    );
    expect(sources.some((source) => source.includes("cdn.example.test"))).toBe(false);
    expect(sources.some((source) => source.includes("/images/services/cleaning.jpg"))).toBe(true);
  });

  it("shows a web address as a decorative, lazily loaded image that sends no referrer", () => {
    const { container } = render(
      <ServiceImage imageKey={null} imageUrl="https://cdn.example.test/a.jpg" />,
    );

    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "https://cdn.example.test/a.jpg");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("falls back to an illustration when the web address does not load, never a broken image", () => {
    const { container } = render(
      <ServiceImage imageKey={null} imageUrl="https://cdn.example.test/missing.jpg" />,
    );

    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    expect(container.querySelector("img")).toBeNull();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("tries a new address after one failed", () => {
    const { container, rerender } = render(
      <ServiceImage imageKey={null} imageUrl="https://cdn.example.test/missing.jpg" />,
    );
    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    rerender(<ServiceImage imageKey={null} imageUrl="https://cdn.example.test/other.jpg" />);

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example.test/other.jpg",
    );
  });

  it("shows an illustration for no picture, and for a key it does not know", () => {
    const none = render(<ServiceImage imageKey={null} imageUrl={null} />);
    expect(none.container.querySelector("img")).toBeNull();
    expect(none.container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    none.unmount();

    const unknown = render(<ServiceImage imageKey="gone-from-this-build" imageUrl={null} />);
    expect(unknown.container.querySelector("img")).toBeNull();
    expect(unknown.container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("BusinessLogo", () => {
  it("always writes the business name out, beside a decorative mark", () => {
    const { container } = render(
      <BusinessLogo businessName="CoolBreeze Home Services" logoKey="breeze" logoUrl={null} />,
    );

    expect(screen.getByText("CoolBreeze Home Services")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("shows a web address as an image with no alt text, then a neutral mark if it fails", () => {
    const { container } = render(
      <BusinessLogo
        businessName="CoolBreeze Home Services"
        logoKey={null}
        logoUrl="https://cdn.example.test/logo.svg"
      />,
    );
    const image = container.querySelector("img") as HTMLImageElement;
    expect(image).toHaveAttribute("alt", "");

    fireEvent.error(image);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("CoolBreeze Home Services")).toBeInTheDocument();
  });

  it("shows a neutral mark when there is no logo", () => {
    const { container } = render(
      <BusinessLogo businessName="CoolBreeze Home Services" logoKey={null} logoUrl={null} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

const OPTIONS = [
  {
    key: "breeze",
    label: "Breeze",
    asset: { icon: (() => null) as never, tone: "accent" as const },
  },
  {
    key: "wrench",
    label: "Wrench",
    asset: { icon: (() => null) as never, tone: "brand" as const },
  },
  {
    key: "house",
    label: "House",
    asset: { icon: (() => null) as never, tone: "success" as const },
  },
];

describe("AssetPicker", () => {
  function Harness({ initial = "" }: { initial?: string }) {
    const [value, setValue] = useState(initial);
    return (
      <fieldset>
        <legend>Choose a logo</legend>
        <AssetPicker
          name="logo"
          id="field-logo"
          options={OPTIONS}
          value={value}
          onChange={setValue}
        />
        <p data-testid="value">{value || "none"}</p>
      </fieldset>
    );
  }

  it("is a group of native radios named by their legend, with the chosen one checked", () => {
    render(<Harness initial="wrench" />);

    const group = screen.getByRole("group", { name: "Choose a logo" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Wrench" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Breeze" })).not.toBeChecked();
  });

  it("changes the choice by click and by the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("radio", { name: "Breeze" }));
    expect(screen.getByTestId("value")).toHaveTextContent("breeze");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId("value")).toHaveTextContent("wrench");
  });

  it("puts the id on the first radio, so an error summary can focus the group", () => {
    render(<Harness />);

    expect(screen.getByRole("radio", { name: "Breeze" })).toHaveAttribute("id", "field-logo");
    expect(screen.getByRole("radio", { name: "Wrench" })).not.toHaveAttribute("id");
  });

  it("cannot be changed while disabled", async () => {
    const onChange = vi.fn();
    render(<AssetPicker name="logo" options={OPTIONS} value="" onChange={onChange} disabled />);

    await userEvent.click(screen.getByRole("radio", { name: "Breeze" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Breeze" })).toBeDisabled();
  });
});

describe("SourceChoice", () => {
  const CHOICES = [
    { value: "none", label: "No logo", description: "Only the name is shown." },
    { value: "bundled", label: "One of the logos" },
    { value: "url", label: "A web address" },
  ] as const;

  it("is a radio group with each option's label and description", () => {
    render(<SourceChoice options={CHOICES} value="bundled" onChange={() => undefined} />);

    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "One of the logos" })).toBeChecked();
    expect(screen.getByText("Only the name is shown.")).toBeInTheDocument();
  });

  it("reports the chosen value", async () => {
    const onChange = vi.fn();
    render(<SourceChoice options={CHOICES} value="none" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: "A web address" }));

    expect(onChange).toHaveBeenCalledWith("url");
  });
});
