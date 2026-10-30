import type { PublicServiceDto, ServiceAddressDto } from "@fixflow/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { RequestForm, type RequestFormProps } from "./request-form";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const DESCRIPTION = "The AC unit stopped cooling overnight and rattles loudly when it starts up.";
const REQUEST_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

function service(overrides: Partial<PublicServiceDto> = {}): PublicServiceDto {
  return {
    id: "s1",
    name: "AC Repair",
    slug: "ac-repair",
    category: "Cooling",
    shortDescription: "Fix a unit that is warm, noisy or leaking.",
    fullDescription: "Full description of the AC repair service.",
    inclusions: [],
    estimatedDurationMinutes: 90,
    pricingMode: "QUOTE_REQUIRED",
    startingPrice: null,
    currencyCode: "USD",
    imageKey: null,
    imageUrl: null,
    ...overrides,
  };
}

function address(overrides: Partial<ServiceAddressDto> = {}): ServiceAddressDto {
  return {
    id: "a1",
    label: "Home",
    line1: "214 Larkspur Lane",
    line2: null,
    city: "Harbor City",
    region: "NY",
    postalCode: "10001",
    accessNotes: "Gate code 4821",
    isDefault: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const SERVICES = [
  service(),
  service({
    id: "s2",
    name: "Home Deep Cleaning",
    slug: "home-deep-cleaning",
    shortDescription: "A thorough clean of every room.",
    pricingMode: "FIXED",
    startingPrice: "189.00",
  }),
];

function renderForm(overrides: Partial<RequestFormProps> = {}) {
  const props: RequestFormProps = {
    services: SERVICES,
    addresses: [address()],
    preselectedServiceId: null,
    preselectionUnavailable: false,
    dateLimits: { min: "2026-11-02", max: "2027-01-30" },
    timeZone: "America/New_York",
    ...overrides,
  };
  return render(<RequestForm {...props} />);
}

const form = () => screen.getByRole("form", { name: "Request a service" });
const sendButton = () => screen.getByRole("button", { name: "Send request" });
const dateInput = () => screen.getByLabelText(/^Preferred date/);
const descriptionInput = () => screen.getByLabelText(/^What needs fixing/);

/** A saved address's radio, found by its text so a service called "Home ..." is never matched. */
const savedAddress = (label: RegExp) =>
  within(screen.getByRole("group", { name: /Choose an address/ })).getByRole("radio", {
    name: label,
  });

async function chooseService(user: ReturnType<typeof userEvent.setup>, name = /AC Repair/) {
  await user.click(screen.getByRole("radio", { name }));
}

async function fillValidRequest(user: ReturnType<typeof userEvent.setup>) {
  await chooseService(user);
  await user.click(descriptionInput());
  await user.paste(DESCRIPTION);
  fireEvent.change(dateInput(), { target: { value: "2026-11-10" } });
  await user.click(screen.getByRole("radio", { name: /Morning/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RequestForm: the page", () => {
  it("is one form with five numbered sections", () => {
    renderForm();

    const headings = within(form())
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Step 1 of 5: Choose a service",
      "Step 2 of 5: Describe the problem",
      "Step 3 of 5: Where should we come?",
      "Step 4 of 5: When would suit you?",
      "Step 5 of 5: Review and send",
    ]);
    expect(sendButton()).toBeEnabled();
  });

  it("offers every active service with what it covers and what it costs", () => {
    renderForm();

    const ac = screen.getByRole("radio", { name: /AC Repair/ });
    expect(ac).toHaveAccessibleName(/Fix a unit that is warm, noisy or leaking/);
    expect(ac).toHaveAccessibleName(/Request a quote/);
    expect(screen.getByRole("radio", { name: /Home Deep Cleaning/ })).toHaveAccessibleName(
      /From \$189\.00/,
    );
  });

  it("starts with the service from the link chosen", () => {
    renderForm({ preselectedServiceId: "s2" });

    expect(screen.getByRole("radio", { name: /Home Deep Cleaning/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /AC Repair/ })).not.toBeChecked();
    expect(screen.queryByText(/isn't open for requests/)).not.toBeInTheDocument();
  });

  it("says so, and chooses nothing, when the service from the link cannot be requested", () => {
    renderForm({ preselectedServiceId: null, preselectionUnavailable: true });

    expect(
      screen.getByText(/The service you picked isn't open for requests right now/),
    ).toBeVisible();
    for (const radio of screen.getAllByRole("radio", { name: /AC Repair|Home Deep Cleaning/ })) {
      expect(radio).not.toBeChecked();
    }
  });

  it("explains when there is no service to choose", () => {
    renderForm({ services: [] });

    expect(screen.getByText(/No services are open for requests at the moment/)).toBeVisible();
  });

  it("limits the date to the range from the server and says what it is", () => {
    renderForm();

    expect(dateInput()).toHaveAttribute("type", "date");
    expect(dateInput()).toHaveAttribute("min", "2026-11-02");
    expect(dateInput()).toHaveAttribute("max", "2027-01-30");
    expect(dateInput()).toHaveAccessibleDescription(/Nov 2, 2026 to Jan 30, 2027/);
  });

  it("shows the hours of each window and says it is a preference", () => {
    renderForm();

    expect(screen.getByRole("radio", { name: /Morning/ })).toHaveAccessibleName(
      /8:00 AM – 12:00 PM/,
    );
    expect(screen.getByRole("radio", { name: /Afternoon/ })).toHaveAccessibleName(
      /12:00 PM – 4:00 PM/,
    );
    expect(screen.getByRole("radio", { name: /Evening/ })).toHaveAccessibleName(
      /4:00 PM – 7:00 PM/,
    );
    expect(screen.getByText(/This is a preference — we'll confirm the exact time/)).toBeVisible();
  });

  it("names the business's clock for the date shown, which changes with daylight saving time", async () => {
    renderForm();

    // Before a date is chosen the first available day sets it (2 November: standard time).
    expect(screen.getByText(/local time \(EST\)/)).toBeVisible();

    fireEvent.change(dateInput(), { target: { value: "2027-01-15" } });
    await waitFor(() => {
      expect(screen.getByText(/local time \(EST\)/)).toBeVisible();
    });
  });

  it("helps with the description: an example, the minimum and a counter", () => {
    renderForm();

    expect(descriptionInput()).toHaveAccessibleDescription(/For example/);
    expect(descriptionInput()).toHaveAccessibleDescription(/At least 20 characters/);
    expect(descriptionInput()).toHaveAttribute("maxlength", "2000");
    expect(screen.getByText("0 / 2000")).toBeVisible();
  });
});

describe("RequestForm: checking before sending", () => {
  it("shows what is missing beside the fields, lists it, and sends nothing", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(sendButton());

    const summary = await screen.findByRole("alert");
    expect(within(summary).getByText(/problems to fix/)).toBeVisible();
    expect(descriptionInput()).toBeInvalid();
    expect(descriptionInput()).toHaveAccessibleDescription(/Tell us what is wrong/);
    expect(dateInput()).toBeInvalid();
    expect(screen.getByText("Choose a service.")).toBeVisible();
    expect(screen.getByText("Choose a date.")).toBeVisible();
    expect(screen.getByText("Choose a time window.")).toBeVisible();
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("links each item of the summary to its field", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(sendButton());
    const summary = await screen.findByRole("alert");

    const link = within(summary).getByRole("link", { name: /Problem description/ });
    await user.click(link);
    expect(descriptionInput()).toHaveFocus();
  });

  it("refuses a description that is too short, and a date outside the range", async () => {
    const user = userEvent.setup();
    renderForm();
    await chooseService(user);
    await user.click(descriptionInput());
    await user.paste("Too short.");
    fireEvent.change(dateInput(), { target: { value: "2026-11-01" } });
    await user.click(screen.getByRole("radio", { name: /Morning/ }));

    await user.click(sendButton());

    // The message is beside the field and, with the others, in the summary.
    await waitFor(() => {
      expect(descriptionInput()).toHaveAccessibleDescription(
        /the description needs at least 20 characters/,
      );
    });
    expect(dateInput()).toHaveAccessibleDescription(/Choose a date from tomorrow onwards/);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("counts the description as it is typed", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(descriptionInput());
    await user.paste("Twelve chars");

    expect(screen.getByText("12 / 2000")).toBeVisible();
  });
});

describe("RequestForm: sending", () => {
  it("posts the request with a saved address, then goes to the confirmation", async () => {
    apiFetchMock.mockResolvedValue({ id: REQUEST_ID });
    const user = userEvent.setup();
    renderForm();

    await fillValidRequest(user);
    await user.click(sendButton());

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(`/portal/requests/${REQUEST_ID}?submitted=1`);
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith("/requests", {
      method: "POST",
      body: {
        serviceId: "s1",
        description: DESCRIPTION,
        serviceAddressId: "a1",
        preferredDate: "2026-11-10",
        preferredWindow: "MORNING",
        submissionKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      },
    });
  });

  it("shows a loading state, blocks a second send and locks the fields while it is pending", async () => {
    let finish: (value: unknown) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidRequest(user);

    await user.click(sendButton());

    await waitFor(() => {
      expect(sendButton()).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Sending your request…");
    expect(descriptionInput()).toBeDisabled();
    expect(dateInput()).toBeDisabled();
    await user.click(sendButton());
    await user.click(sendButton());
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    finish({ id: REQUEST_ID });
    await waitFor(() => {
      expect(push).toHaveBeenCalledTimes(1);
    });
    // The button stays busy during the navigation: it must not come back to life.
    expect(sendButton()).toHaveAttribute("aria-busy", "true");
  });

  it("makes one submission key for the whole visit and sends it again on a retry", async () => {
    apiFetchMock
      .mockRejectedValueOnce(
        new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
      )
      .mockResolvedValueOnce({ id: REQUEST_ID });
    const user = userEvent.setup();
    renderForm();
    await fillValidRequest(user);

    await user.click(sendButton());
    await screen.findByText("Something went wrong.");
    await user.click(sendButton());

    await waitFor(() => {
      expect(push).toHaveBeenCalled();
    });
    const keys = apiFetchMock.mock.calls.map(
      ([, options]) => (options as { body: { submissionKey: string } }).body.submissionKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("keeps everything that was typed when the server fails, and says what happened", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidRequest(user);

    await user.click(sendButton());

    expect(await screen.findByText("Something went wrong.")).toBeVisible();
    expect(descriptionInput()).toHaveValue(DESCRIPTION);
    expect(dateInput()).toHaveValue("2026-11-10");
    expect(screen.getByRole("radio", { name: /AC Repair/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Morning/ })).toBeChecked();
    expect(sendButton()).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("explains a network failure without losing the form", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "We couldn't reach the server. Check your connection and try again.",
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidRequest(user);

    await user.click(sendButton());

    expect(await screen.findByText(/couldn't reach the server/)).toBeVisible();
    expect(descriptionInput()).toHaveValue(DESCRIPTION);
  });

  it("says how long to wait after too many requests", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 429,
        code: "RATE_LIMITED",
        message: "Too many requests.",
        retryAfterSeconds: 1800,
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidRequest(user);

    await user.click(sendButton());

    expect(await screen.findByText(/Please wait 30 minutes/)).toBeVisible();
  });

  it("puts the server's messages beside the fields they belong to, and keeps the values", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "SERVICE_INACTIVE",
        message: "This service isn't open for new requests right now.",
        fieldErrors: {
          serviceId:
            "This service isn't open for new requests right now. Please choose another service.",
          preferredDate: "Choose a date from tomorrow onwards.",
        },
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidRequest(user);

    await user.click(sendButton());

    const group = await screen.findByRole("group", { name: /Service/ });
    expect(within(group).getByText(/isn't open for new requests right now/)).toBeVisible();
    expect(dateInput()).toBeInvalid();
    expect(dateInput()).toHaveAccessibleDescription(/Choose a date from tomorrow onwards/);
    expect(screen.getByRole("alert")).toHaveTextContent(/2 problems to fix/);
    expect(descriptionInput()).toHaveValue(DESCRIPTION);
    expect(screen.getByRole("radio", { name: /Morning/ })).toBeChecked();
    expect(push).not.toHaveBeenCalled();
  });

  it("clears a server message once the field is corrected and sent again", async () => {
    apiFetchMock
      .mockRejectedValueOnce(
        new ApiError({
          status: 422,
          code: "VALIDATION_ERROR",
          message: "The request contains invalid values.",
          fieldErrors: { description: "The description is not acceptable." },
        }),
      )
      .mockResolvedValueOnce({ id: REQUEST_ID });
    const user = userEvent.setup();
    renderForm();
    await fillValidRequest(user);

    await user.click(sendButton());
    await screen.findByText("The description is not acceptable.");
    await user.click(descriptionInput());
    await user.paste(" It also smells of burning.");
    await user.click(sendButton());

    await waitFor(() => {
      expect(push).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("The description is not acceptable.")).not.toBeInTheDocument();
  });
});

describe("RequestForm: the address", () => {
  it("starts on the default saved address and shows it in the review", () => {
    renderForm({
      addresses: [address({ id: "a1", label: "Cabin", isDefault: false }), address({ id: "a2" })],
    });

    expect(savedAddress(/Home/)).toBeChecked();
    expect(savedAddress(/Cabin/)).not.toBeChecked();
    const review = screen.getByText("Address", { selector: "dt" }).closest("div");
    expect(review).toHaveTextContent("Home: 214 Larkspur Lane, Harbor City, NY 10001");
  });

  it("starts with the fields to type an address when there is no saved one", () => {
    renderForm({ addresses: [] });

    expect(screen.getByLabelText(/^Street address/)).toBeVisible();
    expect(screen.getByLabelText(/^City/)).toBeVisible();
    expect(screen.getByLabelText(/^Postal code/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Use a saved address instead" })).toBeNull();
  });

  it("switches to typing a new address, moves focus to its first field, and back again", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Add a new address" }));

    const street = screen.getByLabelText(/^Street address/);
    expect(street).toHaveFocus();
    expect(screen.queryByRole("radio", { name: /Larkspur/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use a saved address instead" }));

    expect(savedAddress(/Home/)).toBeChecked();
    expect(savedAddress(/Home/)).toHaveFocus();
  });

  it("keeps what was typed when switching away and back", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Add a new address" }));
    await user.type(screen.getByLabelText(/^Street address/), "73 Millrace Court");

    await user.click(screen.getByRole("button", { name: "Use a saved address instead" }));
    await user.click(screen.getByRole("button", { name: "Add a new address" }));

    expect(screen.getByLabelText(/^Street address/)).toHaveValue("73 Millrace Court");
  });

  it("sends a typed address that is not saved, without a label", async () => {
    apiFetchMock.mockResolvedValue({ id: REQUEST_ID });
    const user = userEvent.setup();
    renderForm();
    await fillValidRequest(user);
    await user.click(screen.getByRole("button", { name: "Add a new address" }));
    await user.type(screen.getByLabelText(/^Street address/), "73 Millrace Court");
    await user.type(screen.getByLabelText(/^City/), "Harbor City");
    await user.type(screen.getByLabelText(/^Postal code/), "10998");

    await user.click(sendButton());

    await waitFor(() => {
      expect(push).toHaveBeenCalled();
    });
    const body = (apiFetchMock.mock.calls[0]?.[1] as { body: Record<string, unknown> }).body;
    expect(body).not.toHaveProperty("serviceAddressId");
    expect(body.saveAddressToProfile).toBe(false);
    expect(body.newAddress).toEqual({
      line1: "73 Millrace Court",
      line2: null,
      city: "Harbor City",
      region: null,
      postalCode: "10998",
      accessNotes: null,
    });
  });

  it("asks for a label, and sends it, when the new address is saved to the profile", async () => {
    apiFetchMock.mockResolvedValue({ id: REQUEST_ID });
    const user = userEvent.setup();
    renderForm({ addresses: [] });
    await fillValidRequest(user);
    await user.type(screen.getByLabelText(/^Street address/), "73 Millrace Court");
    await user.type(screen.getByLabelText(/^City/), "Harbor City");
    await user.type(screen.getByLabelText(/^Postal code/), "10998");
    expect(screen.queryByLabelText(/^Label/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Save this address to my profile" }));
    await user.click(sendButton());

    await waitFor(() => {
      expect(screen.getByLabelText(/^Label/)).toHaveAccessibleDescription(
        /Enter a label so you can find this address again/,
      );
    });
    expect(apiFetchMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/^Label/), "Rental unit");
    await user.click(sendButton());

    await waitFor(() => {
      expect(push).toHaveBeenCalled();
    });
    const body = (apiFetchMock.mock.calls[0]?.[1] as { body: Record<string, unknown> }).body;
    expect(body.saveAddressToProfile).toBe(true);
    expect(body.newAddress).toMatchObject({ label: "Rental unit", line1: "73 Millrace Court" });
  });

  it("does not demand a label once saving is switched off again", async () => {
    const user = userEvent.setup();
    renderForm({ addresses: [] });
    const toggle = screen.getByRole("switch", { name: "Save this address to my profile" });

    await user.click(toggle);
    expect(screen.getByLabelText(/^Label/)).toBeVisible();
    await user.click(toggle);

    expect(screen.queryByLabelText(/^Label/)).not.toBeInTheDocument();
  });

  it("explains that the address will not be kept when ten are already saved", async () => {
    const ten = Array.from({ length: 10 }, (_unused, index) =>
      address({ id: `a${index}`, label: `Place ${index}`, isDefault: index === 0 }),
    );
    const user = userEvent.setup();
    renderForm({ addresses: ten });

    await user.click(screen.getByRole("button", { name: "Add a new address" }));

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText(/will be used for this request only/)).toBeVisible();
  });

  it("puts a server message about an address beside the address", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "The request contains invalid values.",
        fieldErrors: { serviceAddressId: "That isn't one of your saved addresses." },
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValidRequest(user);

    await user.click(sendButton());

    const group = within(await screen.findByRole("group", { name: /Choose an address/ }));
    expect(group.getByRole("radiogroup")).toBeInvalid();
    expect(group.getByText("That isn't one of your saved addresses.")).toBeVisible();
  });
});

describe("RequestForm: the review", () => {
  it("starts empty and fills in as the customer chooses", async () => {
    const user = userEvent.setup();
    renderForm();
    const review = () =>
      screen.getByText("Service", { selector: "dt" }).closest("dl") as HTMLElement;

    expect(review()).toHaveTextContent("Not chosen yet");
    expect(review()).toHaveTextContent("Not described yet");

    await fillValidRequest(user);

    expect(review()).toHaveTextContent("AC Repair");
    expect(review()).toHaveTextContent(DESCRIPTION);
    expect(review()).toHaveTextContent("Nov 10, 2026, morning (8:00 AM – 12:00 PM EST)");
  });
});
