import type { AdminSettingsDto } from "@fixflow/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { BusinessSettingsForm } from "./business-settings-form";

const refresh = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const SETTINGS: AdminSettingsDto = {
  businessName: "CoolBreeze Home Services",
  tagline: "Home comfort and repairs, done properly the first time.",
  logoKey: "breeze",
  logoUrl: null,
  contactEmail: "hello@coolbreeze.test",
  phone: "(212) 555-0142",
  addressLine1: "48 Harbor Point Road",
  addressLine2: "Unit 3",
  city: "Harbor City",
  region: "NY",
  postalCode: "10999",
  serviceAreaDescription: "Harbor City and nearby towns.",
  currencyCode: "USD",
  timeZone: "America/New_York",
  defaultTaxRate: "8.00",
  quotationValidityDays: 14,
  invoiceDueDays: 14,
  defaultQuotationTerms: "Prices are valid until the date shown.",
  paymentInstructions: "Pay by bank transfer.",
  invoiceFooter: "Thank you for choosing us.",
  updatedAt: "2026-10-28T10:30:00.000Z",
};

const TIME_ZONES = ["America/New_York", "America/Toronto", "Asia/Colombo", "Europe/London", "UTC"];

function renderForm(settings: AdminSettingsDto = SETTINGS) {
  return render(<BusinessSettingsForm settings={settings} timeZones={TIME_ZONES} />);
}

const field = (label: RegExp | string) => screen.getByLabelText(label);
const save = () => screen.getByRole("button", { name: "Save changes" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BusinessSettingsForm", () => {
  it("shows every setting as it is stored, in four sections", () => {
    renderForm();

    for (const heading of [
      "Business identity",
      "Contact",
      "Region and tax",
      "Quotations and invoices",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(field(/^Business name/)).toHaveValue("CoolBreeze Home Services");
    expect(field(/^Contact email/)).toHaveValue("hello@coolbreeze.test");
    expect(field(/^Phone number/)).toHaveValue("(212) 555-0142");
    expect(field(/^Street address/)).toHaveValue("48 Harbor Point Road");
    expect(field(/^Currency/)).toHaveValue("USD");
    expect(field(/^Time zone/)).toHaveValue("America/New_York");
    expect(field(/^Default tax rate/)).toHaveValue("8.00");
    expect(field(/^Quotation validity/)).toHaveValue("14");
    expect(field(/^Invoice payment term/)).toHaveValue("14");
    expect(field(/^Default quotation terms/)).toHaveValue("Prices are valid until the date shown.");
  });

  it("says that region and tax changes only apply to new quotations and invoices", () => {
    renderForm();

    const notice = screen.getByTestId("new-documents-notice");
    expect(notice).toHaveTextContent("apply to new quotations and invoices only");
    expect(notice).toHaveTextContent("keep the currency, tax rate and terms they were made with");
  });

  it("offers the supported two-decimal currencies and the time zones grouped by region", () => {
    renderForm();

    const currency = field(/^Currency/);
    expect(within(currency).getByRole("option", { name: "USD · US dollar" })).toBeInTheDocument();
    expect(
      within(currency).getByRole("option", { name: "LKR · Sri Lankan rupee" }),
    ).toBeInTheDocument();
    expect(within(currency).queryByRole("option", { name: /JPY/ })).not.toBeInTheDocument();

    const zone = field(/^Time zone/);
    expect(within(zone).getByRole("group", { name: "America" })).toBeInTheDocument();
    expect(within(zone).getByRole("option", { name: "New York" })).toHaveValue("America/New_York");
    expect(within(zone).getByRole("group", { name: "Other" })).toBeInTheDocument();
  });

  it("starts clean: nothing to save, nothing to discard", () => {
    renderForm();

    expect(save()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
    expect(screen.getByText("All changes are saved.")).toBeInTheDocument();
  });

  it("shows the logo choice, and the matching control", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByRole("radio", { name: "One of the logos" })).toBeChecked();
    expect(
      within(screen.getByRole("group", { name: /Choose a logo/ })).getAllByRole("radio"),
    ).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "Breeze" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: /A web address/ }));
    expect(field(/^Logo web address/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Choose a logo/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /No logo/ }));
    expect(screen.queryByLabelText(/^Logo web address/)).not.toBeInTheDocument();
  });

  it("previews the business name with its mark as it is typed", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(field(/^Business name/));
    await user.type(field(/^Business name/), "Harbor HVAC");

    expect(screen.getByText("How it looks").parentElement).toHaveTextContent("Harbor HVAC");
  });

  describe("saving", () => {
    it("sends only the field that changed, and confirms only once the server has said yes", async () => {
      let finish: (value: AdminSettingsDto) => void = () => undefined;
      apiFetchMock.mockReturnValue(
        new Promise<AdminSettingsDto>((resolve) => {
          finish = resolve;
        }),
      );
      const user = userEvent.setup();
      renderForm();

      await user.clear(field(/^Phone number/));
      await user.type(field(/^Phone number/), "(212) 555-0199");
      expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
      await user.click(save());

      await waitFor(() => {
        expect(apiFetchMock).toHaveBeenCalledTimes(1);
      });
      expect(apiFetchMock).toHaveBeenCalledWith("/admin/settings", {
        method: "PATCH",
        body: { phone: "(212) 555-0199" },
      });
      // Still waiting: nothing is announced, and the form is locked against a second submit.
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(field(/^Phone number/)).toBeDisabled();

      finish({ ...SETTINGS, phone: "(212) 555-0199" });

      await waitFor(() => {
        expect(toastSuccess).toHaveBeenCalledWith(
          "Settings saved",
          expect.objectContaining({
            description: "New quotations and invoices will use the updated settings.",
          }),
        );
      });
      expect(refresh).toHaveBeenCalled();
      expect(save()).toBeDisabled();
      expect(screen.getByText("All changes are saved.")).toBeInTheDocument();
    });

    it("sends the API's types: day counts as numbers, the tax rate as text, a cleared field as null", async () => {
      apiFetchMock.mockResolvedValue(SETTINGS);
      const user = userEvent.setup();
      renderForm();

      await user.clear(field(/^Quotation validity/));
      await user.type(field(/^Quotation validity/), "30");
      await user.clear(field(/^Default tax rate/));
      await user.type(field(/^Default tax rate/), "9.25");
      await user.clear(field(/^Tagline/));
      await user.click(save());

      await waitFor(() => {
        expect(apiFetchMock).toHaveBeenCalled();
      });
      expect(apiFetchMock.mock.calls[0]?.[1]).toMatchObject({
        body: { quotationValidityDays: 30, defaultTaxRate: "9.25", tagline: null },
      });
    });

    it("switches the logo to a web address by sending both logo fields", async () => {
      apiFetchMock.mockResolvedValue(SETTINGS);
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByRole("radio", { name: /A web address/ }));
      await user.type(field(/^Logo web address/), "https://cdn.example.test/logo.svg");
      await user.click(save());

      await waitFor(() => {
        expect(apiFetchMock).toHaveBeenCalled();
      });
      expect(apiFetchMock.mock.calls[0]?.[1]).toMatchObject({
        body: { logoKey: null, logoUrl: "https://cdn.example.test/logo.svg" },
      });
    });

    it("changes the currency and the time zone through their lists", async () => {
      apiFetchMock.mockResolvedValue(SETTINGS);
      const user = userEvent.setup();
      renderForm();

      await user.selectOptions(field(/^Currency/), "LKR");
      await user.selectOptions(field(/^Time zone/), "Asia/Colombo");
      await user.click(save());

      await waitFor(() => {
        expect(apiFetchMock).toHaveBeenCalled();
      });
      expect(apiFetchMock.mock.calls[0]?.[1]).toMatchObject({
        body: { currencyCode: "LKR", timeZone: "Asia/Colombo" },
      });
    });

    it("compares the next save with what was just saved, not with what was loaded", async () => {
      apiFetchMock.mockResolvedValueOnce({ ...SETTINGS, phone: "(212) 555-0199" });
      apiFetchMock.mockResolvedValueOnce({
        ...SETTINGS,
        phone: "(212) 555-0199",
        city: "Port Harbor",
      });
      const user = userEvent.setup();
      renderForm();

      await user.clear(field(/^Phone number/));
      await user.type(field(/^Phone number/), "(212) 555-0199");
      await user.click(save());
      await waitFor(() => {
        expect(toastSuccess).toHaveBeenCalledTimes(1);
      });
      await user.clear(field(/^City/));
      await user.type(field(/^City/), "Port Harbor");
      await user.click(save());

      await waitFor(() => {
        expect(apiFetchMock).toHaveBeenCalledTimes(2);
      });
      expect(apiFetchMock.mock.calls[1]?.[1]).toMatchObject({ body: { city: "Port Harbor" } });
    });
  });

  describe("validation", () => {
    it("shows a problem beside its field before anything is sent, and keeps what was typed", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.clear(field(/^Default tax rate/));
      await user.type(field(/^Default tax rate/), "100.5");
      await user.clear(field(/^Contact email/));
      await user.type(field(/^Contact email/), "not-an-email");
      await user.click(save());

      expect(await screen.findByRole("alert")).toHaveTextContent("There are 2 problems to fix");
      expect(field(/^Default tax rate/)).toHaveAccessibleDescription(
        expect.stringContaining("The tax rate must be between 0 and 100.") as string,
      );
      expect(field(/^Contact email/)).toBeInvalid();
      expect(field(/^Default tax rate/)).toHaveValue("100.5");
      expect(apiFetchMock).not.toHaveBeenCalled();
    });

    it("shows the API's field errors beside the fields, even for rules only the server knows", async () => {
      apiFetchMock.mockRejectedValue(
        new ApiError({
          status: 422,
          code: "VALIDATION_ERROR",
          message: "The request contains invalid values.",
          fieldErrors: {
            timeZone: "Choose a time zone from the list, like America/New_York.",
            phone:
              "Enter a phone number with 7 to 15 digits, like (212) 555-0142 or +44 20 7946 0000.",
          },
        }),
      );
      const user = userEvent.setup();
      renderForm();
      await user.clear(field(/^Business name/));
      await user.type(field(/^Business name/), "CoolBreeze Co");

      await user.click(save());

      await waitFor(() => {
        expect(field(/^Time zone/)).toBeInvalid();
      });
      expect(field(/^Time zone/)).toHaveAccessibleDescription(
        expect.stringContaining("Choose a time zone from the list") as string,
      );
      expect(field(/^Phone number/)).toBeInvalid();
      expect(field(/^Business name/)).toHaveValue("CoolBreeze Co");
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(save()).toBeEnabled();
    });

    it("shows a failure that belongs to no field as a message above the form", async () => {
      apiFetchMock.mockRejectedValue(
        new ApiError({
          status: 0,
          code: "NETWORK_ERROR",
          message: "We couldn't reach the server. Check your connection and try again.",
        }),
      );
      const user = userEvent.setup();
      renderForm();
      await user.clear(field(/^Business name/));
      await user.type(field(/^Business name/), "CoolBreeze Co");

      await user.click(save());

      expect(await screen.findByText(/We couldn't reach the server/)).toBeInTheDocument();
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(field(/^Business name/)).toHaveValue("CoolBreeze Co");
    });

    it("explains a rate limit with how long to wait", async () => {
      apiFetchMock.mockRejectedValue(
        new ApiError({
          status: 429,
          code: "RATE_LIMITED",
          message: "Too many requests.",
          retryAfterSeconds: 120,
        }),
      );
      const user = userEvent.setup();
      renderForm();
      await user.clear(field(/^Business name/));
      await user.type(field(/^Business name/), "CoolBreeze Co");

      await user.click(save());

      expect(await screen.findByText(/Please wait 2 minutes and try again/)).toBeInTheDocument();
    });
  });

  it("discard puts the saved values back", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.clear(field(/^Business name/));
    await user.type(field(/^Business name/), "Something else");
    await user.selectOptions(field(/^Currency/), "EUR");

    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(field(/^Business name/)).toHaveValue("CoolBreeze Home Services");
    expect(field(/^Currency/)).toHaveValue("USD");
    expect(save()).toBeDisabled();
  });
});
