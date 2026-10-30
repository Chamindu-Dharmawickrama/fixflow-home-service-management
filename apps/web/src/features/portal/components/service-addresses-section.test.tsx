import type { ServiceAddressDto } from "@fixflow/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { ServiceAddressesSection } from "./service-addresses-section";

const refresh = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

function address(overrides: Partial<ServiceAddressDto> = {}): ServiceAddressDto {
  return {
    id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    label: "Home",
    line1: "214 Larkspur Lane",
    line2: "Apt 2B",
    city: "Harbor City",
    region: "NY",
    postalCode: "10999",
    accessNotes: "Buzz apartment 2B. There is a friendly dog in the flat.",
    isDefault: true,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-28T10:30:00.000Z",
    ...overrides,
  };
}

const HOME = address();
const OFFICE = address({
  id: "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
  label: "Office",
  line1: "9 Dock Street",
  line2: null,
  postalCode: "10001",
  accessNotes: null,
  isDefault: false,
});

const button = (name: string | RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServiceAddressesSection: what it shows", () => {
  it("shows an empty state that guides the customer to add their first address", () => {
    render(<ServiceAddressesSection addresses={[]} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Service addresses" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "No saved addresses yet" }),
    ).toBeInTheDocument();
    expect(button("Add your first address")).toBeEnabled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    // One way in, not two.
    expect(screen.queryByRole("button", { name: "Add address" })).not.toBeInTheDocument();
  });

  it("lists each address with its label, lines and notes, and marks the default in words", () => {
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const home = within(items[0] as HTMLElement);
    expect(home.getByRole("heading", { level: 3, name: "Home" })).toBeInTheDocument();
    expect(home.getByText("Default")).toBeInTheDocument();
    expect(home.getByText("214 Larkspur Lane")).toBeInTheDocument();
    expect(home.getByText("Apt 2B")).toBeInTheDocument();
    expect(home.getByText("Harbor City, NY 10999")).toBeInTheDocument();
    expect(home.getByText(/Buzz apartment 2B/)).toBeInTheDocument();

    const office = within(items[1] as HTMLElement);
    expect(office.getByRole("heading", { level: 3, name: "Office" })).toBeInTheDocument();
    expect(office.queryByText("Default")).not.toBeInTheDocument();
    expect(office.queryByText(/Access notes/)).not.toBeInTheDocument();
  });

  it("clips long access notes with CSS only, so the whole text is still read out", () => {
    const notes = "Gate code 4471. ".repeat(20).trim();
    render(<ServiceAddressesSection addresses={[address({ accessNotes: notes })]} />);

    const paragraph = screen.getByText(/Access notes:/).closest("p");
    expect(paragraph).toHaveClass("line-clamp-2");
    expect(paragraph).toHaveTextContent(notes);
  });

  it("offers Edit and Delete on every address and 'Set as default' only on the others, each named by address", () => {
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    expect(button("Edit Home")).toBeEnabled();
    expect(button("Delete Home")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Set as default Home" })).not.toBeInTheDocument();
    expect(button("Edit Office")).toBeEnabled();
    expect(button("Delete Office")).toBeEnabled();
    expect(button("Set as default Office")).toBeEnabled();
  });

  it("stops offering 'Add address' at ten addresses and says why", () => {
    const ten = Array.from({ length: 10 }, (_, n) =>
      address({
        id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
        label: `Place ${n + 1}`,
        isDefault: n === 0,
      }),
    );
    render(<ServiceAddressesSection addresses={ten} />);

    expect(button("Add address")).toBeDisabled();
    expect(screen.getByText(/maximum of 10 addresses/)).toBeInTheDocument();
  });

  it("allows 'Add address' at nine addresses", () => {
    const nine = Array.from({ length: 9 }, (_, n) =>
      address({
        id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
        label: `Place ${n + 1}`,
        isDefault: n === 0,
      }),
    );
    render(<ServiceAddressesSection addresses={nine} />);

    expect(button("Add address")).toBeEnabled();
    expect(screen.queryByText(/maximum of 10 addresses/)).not.toBeInTheDocument();
  });
});

describe("ServiceAddressesSection: adding", () => {
  async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/^Label/), "Rental unit");
    await user.type(screen.getByLabelText(/^Street address/), "73 Millrace Court");
    await user.type(screen.getByLabelText(/^City/), "Harbor City");
    await user.type(screen.getByLabelText(/^Postal code/), "10998");
  }

  it("saves a new address, confirms only after the server answers, and refreshes the list", async () => {
    apiFetchMock.mockResolvedValue(address({ label: "Rental unit", isDefault: true }));
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[]} />);

    await user.click(button("Add your first address"));
    const dialog = await screen.findByRole("dialog", { name: "Add an address" });
    expect(within(dialog).getByText("This will be your default address.")).toBeInTheDocument();
    await fillRequired(user);
    await user.click(within(dialog).getByRole("button", { name: "Save address" }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith(
        "“Rental unit” saved",
        expect.objectContaining({ description: "It is your default address." }),
      );
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/customers/me/addresses", {
      method: "POST",
      body: {
        label: "Rental unit",
        line1: "73 Millrace Court",
        line2: null,
        city: "Harbor City",
        region: null,
        postalCode: "10998",
        accessNotes: null,
      },
    });
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("validates before sending and shows each message beside its field", async () => {
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME]} />);

    await user.click(button("Add address"));
    const dialog = await screen.findByRole("dialog", { name: "Add an address" });
    expect(
      within(dialog).getByText("You can make it your default after you save it."),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Postal code/), "10<99>");
    await user.click(within(dialog).getByRole("button", { name: "Save address" }));

    expect(await within(dialog).findByText("Enter the label.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter the street address.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter the city.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Label/)).toBeInvalid();
    expect(screen.getByLabelText(/^Postal code/)).toBeInvalid();
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps the dialog and the typed input open when the server refuses, with the message beside the field", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "The request contains invalid values.",
        fieldErrors: { postalCode: "That postal code is not valid here." },
      }),
    );
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[]} />);

    await user.click(button("Add your first address"));
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.click(button("Save address"));

    expect(await screen.findAllByText("That postal code is not valid here.")).not.toHaveLength(0);
    expect(screen.getByLabelText(/^Postal code/)).toBeInvalid();
    expect(screen.getByLabelText(/^Street address/)).toHaveValue("73 Millrace Court");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the limit message from the server above the form and keeps the input", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "ADDRESS_LIMIT_REACHED",
        message: "You can save up to 10 addresses. Delete one you no longer use to add another.",
      }),
    );
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME]} />);

    await user.click(button("Add address"));
    await screen.findByRole("dialog");
    await fillRequired(user);
    await user.click(button("Save address"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/up to 10 addresses/);
    expect(screen.getByLabelText(/^City/)).toHaveValue("Harbor City");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("closes without sending anything when cancelled", async () => {
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME]} />);

    await user.click(button("Add address"));
    await screen.findByRole("dialog");
    await user.type(screen.getByLabelText(/^Label/), "Draft");
    await user.click(button("Cancel"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe("ServiceAddressesSection: editing", () => {
  it("opens with the saved values and has nothing to save until something changes", async () => {
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Edit Home"));
    const dialog = await screen.findByRole("dialog", { name: "Edit “Home”" });

    expect(within(dialog).getByLabelText(/^Label/)).toHaveValue("Home");
    expect(within(dialog).getByLabelText(/^Street address/)).toHaveValue("214 Larkspur Lane");
    expect(within(dialog).getByLabelText(/^Address line 2/)).toHaveValue("Apt 2B");
    expect(within(dialog).getByLabelText(/^State or region/)).toHaveValue("NY");
    expect(within(dialog).getByLabelText(/^Access notes/)).toHaveValue(HOME.accessNotes);
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("sends only the fields that changed", async () => {
    apiFetchMock.mockResolvedValue(address({ city: "Port Alder" }));
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Edit Home"));
    const dialog = await screen.findByRole("dialog");
    const city = within(dialog).getByLabelText(/^City/);
    await user.clear(city);
    await user.type(city, "Port Alder");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(`/customers/me/addresses/${HOME.id}`, {
        method: "PATCH",
        body: { city: "Port Alder" },
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith("“Home” updated", expect.anything());
    expect(refresh).toHaveBeenCalled();
  });

  it("clears an optional field by sending null", async () => {
    apiFetchMock.mockResolvedValue(address({ line2: null }));
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME]} />);

    await user.click(button("Edit Home"));
    await user.clear(await screen.findByLabelText(/^Address line 2/));
    await user.click(button("Save changes"));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(`/customers/me/addresses/${HOME.id}`, {
        method: "PATCH",
        body: { line2: null },
      });
    });
  });

  it("reloads the list when the address was deleted elsewhere, and keeps the form for the message", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 404,
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
      }),
    );
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME]} />);

    await user.click(button("Edit Home"));
    const city = await screen.findByLabelText(/^City/);
    await user.clear(city);
    await user.type(city, "Port Alder");
    await user.click(button("Save changes"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not found/i);
    expect(refresh).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("ServiceAddressesSection: choosing the default", () => {
  it("sets the default, confirms after the server answers, and refreshes", async () => {
    apiFetchMock.mockResolvedValue({ ...OFFICE, isDefault: true });
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Set as default Office"));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("“Office” is now your default address");
    });
    expect(apiFetchMock).toHaveBeenCalledWith(`/customers/me/addresses/${OFFICE.id}/default`, {
      method: "POST",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("blocks the other actions and a second click while it is pending", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Set as default Office"));
    expect(screen.getByRole("status")).toHaveTextContent("Setting Office as default…");
    await user.click(button("Set as default Office"));

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(button("Edit Home")).toBeDisabled();
    expect(button("Delete Office")).toBeDisabled();
    resolve({ ...OFFICE, isDefault: true });
    await waitFor(() => {
      expect(button("Edit Home")).toBeEnabled();
    });
  });

  it("says why it failed and does not announce a change that did not happen", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Set as default Office"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Something went wrong/);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(button("Set as default Office")).toBeEnabled();
  });
});

describe("ServiceAddressesSection: deleting", () => {
  it("asks first, and explains that past requests keep their original address", async () => {
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Delete Office"));

    const dialog = await screen.findByRole("alertdialog", { name: "Delete “Office”?" });
    expect(dialog).toHaveTextContent(
      /Requests you have already made keep the address they were made with/,
    );
    expect(dialog).not.toHaveTextContent(/default address/i);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("warns that another address becomes the default when the default is deleted", async () => {
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Delete Home"));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      /This is your default address\. The address you changed most recently becomes the default/,
    );
  });

  it("does not mention a new default when the only address is deleted", async () => {
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME]} />);

    await user.click(button("Delete Home"));

    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent(/becomes the default/);
  });

  it("deletes once confirmed, then confirms with a toast and refreshes", async () => {
    apiFetchMock.mockResolvedValue({ id: OFFICE.id });
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Delete Office"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete address" }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("“Office” deleted");
    });
    expect(apiFetchMock).toHaveBeenCalledWith(`/customers/me/addresses/${OFFICE.id}`, {
      method: "DELETE",
    });
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("leaves the address alone when cancelled", async () => {
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Delete Office"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("stays open with the reason when the delete fails, and announces nothing", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Delete Office"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete address" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Something went wrong/);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reloads the list when the address is already gone", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 404,
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
      }),
    );
    const user = userEvent.setup();
    render(<ServiceAddressesSection addresses={[HOME, OFFICE]} />);

    await user.click(button("Delete Office"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete address",
      }),
    );

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });
});
