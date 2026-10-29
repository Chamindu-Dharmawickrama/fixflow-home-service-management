import type { AdminServiceDto } from "@fixflow/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { ServiceForm } from "./service-form";

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const SERVICE: AdminServiceDto = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  name: "AC Routine Maintenance",
  slug: "ac-routine-maintenance",
  category: "Air conditioning",
  shortDescription: "A yearly service that keeps your air conditioner efficient.",
  fullDescription: "A thorough service for split and ducted air conditioners, best in spring.",
  inclusions: ["Filter cleaning", "Refrigerant check"],
  estimatedDurationMinutes: 90,
  pricingMode: "FIXED",
  startingPrice: "129.00",
  currencyCode: "USD",
  imageKey: "air-conditioning",
  imageUrl: null,
  sortOrder: 20,
  isPublished: false,
  archivedAt: null,
  status: "UNPUBLISHED",
  isActive: false,
  availableActions: ["EDIT", "PUBLISH", "ARCHIVE"],
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-28T10:30:00.000Z",
};

const CATEGORIES = ["Air conditioning", "Cleaning"];

function renderCreate() {
  return render(<ServiceForm mode="create" currencyCode="USD" categories={CATEGORIES} />);
}
function renderEdit(service: AdminServiceDto = SERVICE) {
  return render(
    <ServiceForm mode="edit" service={service} currencyCode="USD" categories={CATEGORIES} />,
  );
}

const field = (label: RegExp | string) => screen.getByLabelText(label);
const saveButton = (name: string) => screen.getByRole("button", { name });

/** The preview card: its heading and price line. */
function preview() {
  return screen.getByTestId("service-preview");
}

/**
 * Pastes into a field as one change. Typing a long text key by key re-renders the whole form (and
 * its live preview) on every character, which made these tests take seconds each under load.
 */
async function enter(user: ReturnType<typeof userEvent.setup>, label: RegExp, text: string) {
  await user.click(field(label));
  await user.paste(text);
}

async function fillValidNewService(user: ReturnType<typeof userEvent.setup>) {
  await enter(user, /^Service name/, "Washing Machine Repair");
  await enter(user, /^Category/, "Appliance repair");
  await enter(user, /^Short description/, "Fixes for washers that will not drain or spin.");
  await enter(
    user,
    /^Full description/,
    "Front- and top-loading washing machines diagnosed and repaired at your home.",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServiceForm: creating", () => {
  it("makes the web address from the name while the name is typed", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(field(/^Service name/), "Home Deep Cleaning!");

    expect(field(/^Web address/)).toHaveValue("home-deep-cleaning");
    expect(screen.getByText(/\/services\/home-deep-cleaning\./)).toBeInTheDocument();
  });

  it("stops following the name once the address is edited by hand, and resumes if it is emptied", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(field(/^Service name/), "Home Cleaning");
    await user.clear(field(/^Web address/));
    await user.type(field(/^Web address/), "deep-clean");
    await user.type(field(/^Service name/), " Plus");
    expect(field(/^Web address/)).toHaveValue("deep-clean");

    await user.clear(field(/^Web address/));
    await user.type(field(/^Service name/), "!");
    expect(field(/^Web address/)).toHaveValue("home-cleaning-plus");
  });

  it("is quote-only to begin with, and asks for a price only for a fixed price", async () => {
    const user = userEvent.setup();
    renderCreate();

    expect(screen.queryByLabelText(/^Starting price/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Fixed starting price/ }));

    expect(field(/^Starting price \(USD\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Request a quote/ }));
    expect(screen.queryByLabelText(/^Starting price/)).not.toBeInTheDocument();
  });

  it("shows only the picture control that matches the choice", async () => {
    const user = userEvent.setup();
    renderCreate();
    expect(screen.queryByRole("group", { name: /Choose an illustration/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Picture web address/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "One of the illustrations" }));
    const group = screen.getByRole("group", { name: /Choose an illustration/ });
    expect(within(group).getAllByRole("radio")).toHaveLength(7);

    await user.click(screen.getByRole("radio", { name: /A web address/ }));
    expect(field(/^Picture web address/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Choose an illustration/ })).not.toBeInTheDocument();
  });

  it("keeps Save disabled until something is typed, and says so", async () => {
    const user = userEvent.setup();
    renderCreate();

    expect(saveButton("Create service")).toBeDisabled();
    expect(screen.getByText("All changes are saved.")).toBeInTheDocument();

    await user.type(field(/^Service name/), "A");
    expect(saveButton("Create service")).toBeEnabled();
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
  });

  it("does not send an invalid form, and shows each problem beside its field and in a summary", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(field(/^Service name/), "AC");
    await user.click(saveButton("Create service"));

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("There are");
    expect(field(/^Service name/)).toHaveAccessibleDescription(
      "The service name must be at least 3 characters.",
    );
    expect(field(/^Category/)).toBeInvalid();
    expect(field(/^Short description/)).toBeInvalid();
    expect(apiFetchMock).not.toHaveBeenCalled();
    // What was typed is still there.
    expect(field(/^Service name/)).toHaveValue("AC");
  });

  it("requires a price when the price is fixed", async () => {
    const user = userEvent.setup();
    renderCreate();
    await fillValidNewService(user);
    await user.click(screen.getByRole("radio", { name: /Fixed starting price/ }));

    await user.click(saveButton("Create service"));

    expect(
      await screen.findByText("Enter a starting price for a fixed-price service."),
    ).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("creates the service, tells the person it is unpublished, and opens it", async () => {
    apiFetchMock.mockResolvedValue({ ...SERVICE, id: "new-id", name: "Washing Machine Repair" });
    const user = userEvent.setup();
    renderCreate();
    await fillValidNewService(user);
    await user.click(screen.getByRole("radio", { name: /Fixed starting price/ }));
    await user.type(field(/^Starting price/), "89");
    await user.type(field(/^Usual time on site/), "90");

    await user.click(saveButton("Create service"));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/admin/services", {
      method: "POST",
      body: {
        name: "Washing Machine Repair",
        slug: "washing-machine-repair",
        category: "Appliance repair",
        shortDescription: "Fixes for washers that will not drain or spin.",
        fullDescription:
          "Front- and top-loading washing machines diagnosed and repaired at your home.",
        inclusions: [],
        estimatedDurationMinutes: 90,
        pricingMode: "FIXED",
        startingPrice: "89",
        imageKey: null,
        imageUrl: null,
        sortOrder: 0,
      },
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/app/settings/services/new-id");
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "“Washing Machine Repair” was created",
      expect.objectContaining({
        description: expect.stringContaining("until you publish") as string,
      }),
    );
  });

  it("shows a taken web address beside that field and keeps everything typed", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "SLUG_TAKEN",
        message: "Another service already uses this web address. Choose a different one.",
        fieldErrors: {
          slug: "Another service already uses this web address. Choose a different one.",
        },
      }),
    );
    const user = userEvent.setup();
    renderCreate();
    await fillValidNewService(user);

    await user.click(saveButton("Create service"));

    await waitFor(() => {
      expect(field(/^Web address/)).toBeInvalid();
    });
    expect(field(/^Web address/)).toHaveAccessibleDescription(
      /Another service already uses this web address/,
    );
    expect(field(/^Web address/)).toHaveValue("washing-machine-repair");
    expect(field(/^Service name/)).toHaveValue("Washing Machine Repair");
    expect(push).not.toHaveBeenCalled();
    // Not saved, so not announced as saved, and the person can try again.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(saveButton("Create service")).toBeEnabled();
  });

  it("shows a server problem that belongs to no field above the form", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "We couldn't reach the server. Check your connection and try again.",
      }),
    );
    const user = userEvent.setup();
    renderCreate();
    await fillValidNewService(user);

    await user.click(saveButton("Create service"));

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach the server");
    expect(field(/^Service name/)).toHaveValue("Washing Machine Repair");
  });

  it("blocks a second submit while the first is on its way", async () => {
    let finish: (value: AdminServiceDto) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise<AdminServiceDto>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderCreate();
    await fillValidNewService(user);

    await user.click(saveButton("Create service"));
    await user.click(saveButton("Create service"));
    await user.click(saveButton("Create service"));

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(field(/^Service name/)).toBeDisabled();
    finish({ ...SERVICE, id: "new-id" });
  });

  it("discard puts the empty form back", async () => {
    const user = userEvent.setup();
    renderCreate();
    await fillValidNewService(user);

    await user.click(saveButton("Discard changes"));

    expect(field(/^Service name/)).toHaveValue("");
    expect(field(/^Web address/)).toHaveValue("");
    expect(saveButton("Create service")).toBeDisabled();
  });
});

describe("ServiceForm: preview", () => {
  it("shows a placeholder card at first, then the typed service as it will appear", async () => {
    const user = userEvent.setup();
    renderCreate();
    expect(preview()).toHaveTextContent("Service name");
    expect(preview()).toHaveTextContent("Request a quote");

    await user.type(field(/^Service name/), "Home Deep Cleaning");
    await user.type(field(/^Category/), "Cleaning");
    await user.click(screen.getByRole("radio", { name: /Fixed starting price/ }));
    await user.type(field(/^Starting price/), "189");
    await user.type(field(/^Usual time on site/), "240");

    expect(preview()).toHaveTextContent("Home Deep Cleaning");
    expect(preview()).toHaveTextContent("Cleaning");
    expect(preview()).toHaveTextContent("From $189.00");
    expect(preview()).toHaveTextContent("4 hr");
  });

  it("never shows a price that is not an amount", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole("radio", { name: /Fixed starting price/ }));

    await user.type(field(/^Starting price/), "abc");

    expect(preview()).toHaveTextContent("Request a quote");
    expect(preview()).not.toHaveTextContent("From");
  });
});

describe("ServiceForm: inclusions", () => {
  it("adds and removes rows, moves focus to the new box, and counts them", async () => {
    const user = userEvent.setup();
    renderCreate();
    expect(screen.getByText("No inclusions yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add inclusion" }));
    expect(field("Inclusion 1")).toHaveFocus();
    await user.type(field("Inclusion 1"), "Filter cleaning");
    await user.click(screen.getByRole("button", { name: "Add inclusion" }));
    await user.type(field("Inclusion 2"), "Refrigerant check");
    expect(screen.getByText("2 of 12")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove inclusion 1" }));

    expect(screen.queryByLabelText("Inclusion 2")).not.toBeInTheDocument();
    expect(field("Inclusion 1")).toHaveValue("Refrigerant check");
    expect(screen.getByText("1 of 12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add inclusion" })).toHaveFocus();
  });

  it("stops at twelve", async () => {
    const user = userEvent.setup();
    renderCreate();
    for (let i = 0; i < 12; i += 1) {
      await user.click(screen.getByRole("button", { name: "Add inclusion" }));
    }

    expect(screen.getByRole("button", { name: "Add inclusion" })).toBeDisabled();
    expect(screen.getByText("12 of 12")).toBeInTheDocument();
  });

  it("does not send blank rows", async () => {
    apiFetchMock.mockResolvedValue({ ...SERVICE, id: "new-id" });
    const user = userEvent.setup();
    renderCreate();
    await fillValidNewService(user);
    await user.click(screen.getByRole("button", { name: "Add inclusion" }));
    await user.type(field("Inclusion 1"), "Testing a full cycle");
    await user.click(screen.getByRole("button", { name: "Add inclusion" }));

    await user.click(saveButton("Create service"));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalled();
    });
    expect(apiFetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: { inclusions: ["Testing a full cycle"] },
    });
  });

  it("flags an inclusion that is too long beside its own box", async () => {
    const user = userEvent.setup();
    renderCreate();
    await fillValidNewService(user);
    await user.click(screen.getByRole("button", { name: "Add inclusion" }));
    await user.click(field("Inclusion 1"));
    await user.paste("x".repeat(121));

    await user.click(saveButton("Create service"));

    expect(
      await screen.findByText("An inclusion must be 120 characters or fewer."),
    ).toBeInTheDocument();
    expect(field("Inclusion 1")).toBeInvalid();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe("ServiceForm: editing", () => {
  it("shows the service as it is, with Save disabled", () => {
    renderEdit();

    expect(field(/^Service name/)).toHaveValue("AC Routine Maintenance");
    expect(field(/^Web address/)).toHaveValue("ac-routine-maintenance");
    expect(field(/^Starting price/)).toHaveValue("129.00");
    expect(field("Inclusion 1")).toHaveValue("Filter cleaning");
    expect(saveButton("Save changes")).toBeDisabled();
  });

  it("does not rewrite the web address when the name changes", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.type(field(/^Service name/), " Plus");

    expect(field(/^Web address/)).toHaveValue("ac-routine-maintenance");
  });

  it("warns, only when the address changes, that old links will break", async () => {
    const user = userEvent.setup();
    renderEdit();
    expect(screen.queryByText(/breaks existing links/)).not.toBeInTheDocument();

    await user.type(field(/^Web address/), "-2");

    expect(
      screen.getByText(/breaks existing links to \/services\/ac-routine-maintenance/),
    ).toBeInTheDocument();
    await user.clear(field(/^Web address/));
    await user.type(field(/^Web address/), "ac-routine-maintenance");
    expect(screen.queryByText(/breaks existing links/)).not.toBeInTheDocument();
  });

  it("sends only what changed, with the status the form was loaded in", async () => {
    apiFetchMock.mockResolvedValue({
      ...SERVICE,
      sortOrder: 5,
      updatedAt: "2026-10-29T10:00:00.000Z",
    });
    const user = userEvent.setup();
    renderEdit();

    await user.clear(field(/^Display order/));
    await user.type(field(/^Display order/), "5");
    await user.click(saveButton("Save changes"));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/services/${SERVICE.id}`, {
      method: "PATCH",
      body: { sortOrder: 5, expectedStatus: "UNPUBLISHED" },
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Changes saved", expect.anything());
    });
    expect(refresh).toHaveBeenCalled();
    // Saved: the form is clean again, and the next save compares with what was just saved.
    expect(saveButton("Save changes")).toBeDisabled();
    expect(screen.getByText("All changes are saved.")).toBeInTheDocument();
  });

  it("sends a changed list of inclusions whole", async () => {
    apiFetchMock.mockResolvedValue(SERVICE);
    const user = userEvent.setup();
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Remove inclusion 2" }));
    await user.click(saveButton("Save changes"));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalled();
    });
    expect(apiFetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: { inclusions: ["Filter cleaning"], expectedStatus: "UNPUBLISHED" },
    });
  });

  it("clears the price when the service becomes quote-only", async () => {
    apiFetchMock.mockResolvedValue({
      ...SERVICE,
      pricingMode: "QUOTE_REQUIRED",
      startingPrice: null,
    });
    const user = userEvent.setup();
    renderEdit();

    await user.click(screen.getByRole("radio", { name: /Request a quote/ }));
    await user.click(saveButton("Save changes"));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalled();
    });
    expect(apiFetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: { pricingMode: "QUOTE_REQUIRED", startingPrice: null },
    });
  });

  it("explains a service that someone else changed, keeps the edits, and reloads the page's data", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "STALE_STATE",
        message: "This service was changed by someone else. Reload it and try again.",
      }),
    );
    const user = userEvent.setup();
    renderEdit();
    await user.type(field(/^Service name/), " Plus");

    await user.click(saveButton("Save changes"));

    expect(await screen.findByRole("alert")).toHaveTextContent("changed by someone else");
    expect(field(/^Service name/)).toHaveValue("AC Routine Maintenance Plus");
    expect(refresh).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("discard puts the saved values back", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.type(field(/^Service name/), " Plus");
    await user.click(screen.getByRole("button", { name: "Remove inclusion 1" }));

    await user.click(saveButton("Discard changes"));

    expect(field(/^Service name/)).toHaveValue("AC Routine Maintenance");
    expect(field("Inclusion 1")).toHaveValue("Filter cleaning");
    expect(saveButton("Save changes")).toBeDisabled();
  });

  it("holds the visibility controls while there are unsaved changes, and says why", async () => {
    const user = userEvent.setup();
    renderEdit();
    const published = screen.getByRole("switch", { name: "Published on the website" });
    expect(published).toBeEnabled();

    await user.type(field(/^Service name/), " Plus");

    expect(published).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive service" })).toBeDisabled();
    expect(screen.getByText(/Save or discard your changes first/)).toBeInTheDocument();
  });
});
