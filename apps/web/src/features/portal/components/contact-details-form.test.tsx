import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { ContactDetailsForm } from "./contact-details-form";

const refresh = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const PROFILE = { name: "Alex Morgan", email: "alex.morgan@example.test", phone: "(212) 555-0171" };

const nameInput = () => screen.getByLabelText(/^Name/);
const phoneInput = () => screen.getByLabelText(/^Phone number/);
const saveButton = () => screen.getByRole("button", { name: "Save changes" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ContactDetailsForm", () => {
  it("shows the saved name and phone number, and the email address as read-only text", () => {
    render(<ContactDetailsForm profile={PROFILE} />);

    expect(nameInput()).toHaveValue("Alex Morgan");
    expect(phoneInput()).toHaveValue("(212) 555-0171");
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveValue("alex.morgan@example.test");
    expect(email).toHaveAttribute("readonly");
    expect(email).toHaveAccessibleDescription(/Contact us if you need to change your email/);
    expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/#contact");
  });

  it("leaves the phone field empty for a customer who has none", () => {
    render(<ContactDetailsForm profile={{ ...PROFILE, phone: null }} />);

    expect(phoneInput()).toHaveValue("");
  });

  it("has nothing to save until something changes", async () => {
    const user = userEvent.setup();
    render(<ContactDetailsForm profile={PROFILE} />);

    expect(saveButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument();

    await user.type(phoneInput(), "9");

    expect(saveButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeInTheDocument();
  });

  it("sends only the field that changed, then confirms once the server has said so", async () => {
    apiFetchMock.mockResolvedValue({ ...PROFILE, phone: "(212) 555-0199" });
    const user = userEvent.setup();
    render(<ContactDetailsForm profile={PROFILE} />);

    await user.clear(phoneInput());
    await user.type(phoneInput(), "(212) 555-0199");
    await user.click(saveButton());

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Contact details saved");
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith("/customers/me", {
      method: "PATCH",
      body: { phone: "(212) 555-0199" },
    });
    // The name appears in the account menu and the greeting, so the page is refreshed.
    expect(refresh).toHaveBeenCalled();
    // The saved values are now the baseline: there is nothing left to save.
    await waitFor(() => {
      expect(saveButton()).toBeDisabled();
    });
  });

  it("sends a cleared phone number as null", async () => {
    apiFetchMock.mockResolvedValue({ ...PROFILE, phone: null });
    const user = userEvent.setup();
    render(<ContactDetailsForm profile={PROFILE} />);

    await user.clear(phoneInput());
    await user.click(saveButton());

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/customers/me", {
        method: "PATCH",
        body: { phone: null },
      });
    });
  });

  it("explains a name that is too short beside the field and sends nothing", async () => {
    const user = userEvent.setup();
    render(<ContactDetailsForm profile={PROFILE} />);

    await user.clear(nameInput());
    await user.type(nameInput(), "A");
    await user.click(saveButton());

    expect(await screen.findByText("Your name must be at least 2 characters.")).toBeInTheDocument();
    expect(nameInput()).toBeInvalid();
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("explains a phone number the API would refuse, and sends nothing", async () => {
    const user = userEvent.setup();
    render(<ContactDetailsForm profile={PROFILE} />);

    await user.clear(phoneInput());
    await user.type(phoneInput(), "call me");
    await user.click(saveButton());

    expect(await screen.findByText(/Enter a phone number with 7 to 15 digits/)).toBeInTheDocument();
    expect(phoneInput()).toBeInvalid();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's message beside the field and keeps what was typed", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "The request contains invalid values.",
        fieldErrors: { phone: "That phone number is not one we can use." },
      }),
    );
    const user = userEvent.setup();
    render(<ContactDetailsForm profile={PROFILE} />);

    await user.clear(phoneInput());
    await user.type(phoneInput(), "(212) 555-0100");
    await user.click(saveButton());

    expect(await screen.findByText("That phone number is not one we can use.")).toBeInTheDocument();
    expect(phoneInput()).toBeInvalid();
    expect(phoneInput()).toHaveValue("(212) 555-0100");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
  });

  it("shows a server problem above the form, keeps the input and does not announce a save", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const user = userEvent.setup();
    render(<ContactDetailsForm profile={PROFILE} />);

    await user.clear(nameInput());
    await user.type(nameInput(), "Alexandra Morgan");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/Something went wrong/);
    expect(nameInput()).toHaveValue("Alexandra Morgan");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("blocks a second submit while the first is pending", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const user = userEvent.setup();
    render(<ContactDetailsForm profile={PROFILE} />);

    await user.clear(phoneInput());
    await user.type(phoneInput(), "(212) 555-0100");
    await user.click(saveButton());
    await user.click(saveButton());
    await user.keyboard("{Enter}");

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    resolve({ ...PROFILE, phone: "(212) 555-0100" });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("puts the saved values back when the changes are discarded", async () => {
    const user = userEvent.setup();
    render(<ContactDetailsForm profile={PROFILE} />);

    await user.clear(nameInput());
    await user.type(nameInput(), "Someone Else");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(nameInput()).toHaveValue("Alex Morgan");
    expect(saveButton()).toBeDisabled();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
