import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";
import { navigateWithFullReload } from "@/lib/auth/navigate";

import { RegisterForm } from "./register-form";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));
vi.mock("@/lib/auth/navigate", () => ({ navigateWithFullReload: vi.fn() }));
vi.mock("next/script", () => ({ default: () => null }));

const apiFetchMock = vi.mocked(apiFetch);
const navigateMock = vi.mocked(navigateWithFullReload);

const GOOD_PASSWORD = "violet teapot sails home";

function setup(props: Partial<React.ComponentProps<typeof RegisterForm>> = {}) {
  const user = userEvent.setup();
  render(<RegisterForm googleClientId={undefined} demoMode={false} {...props} />);
  return user;
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  values: {
    name?: string;
    email?: string;
    password?: string;
    confirm?: string;
    terms?: boolean;
  } = {},
) {
  const {
    name = "Alex Morgan",
    email = "alex.morgan@example.test",
    password = GOOD_PASSWORD,
    confirm = password,
    terms = true,
  } = values;
  await user.type(screen.getByLabelText(/^Full name/), name);
  await user.type(screen.getByLabelText(/^Email address/), email);
  await user.type(screen.getByLabelText(/^Password/), password);
  await user.type(screen.getByLabelText(/^Confirm password/), confirm);
  if (terms) await user.click(screen.getByRole("checkbox"));
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Create account" }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RegisterForm", () => {
  it("labels every field, uses new-password for both password fields and explains the policy", () => {
    setup();

    expect(screen.getByLabelText(/^Full name/)).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText(/^Email address/)).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText(/^Confirm password/)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByText(/Use 10 to 128 characters/)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /I accept the terms of use and privacy notice/ }),
    ).toBeInTheDocument();
  });

  it("gives a live strength hint as the password grows", async () => {
    const user = setup();
    const hint = () => screen.getAllByRole("status").find((el) => el.hasAttribute("data-strength"));

    expect(hint()).toHaveAttribute("data-strength", "empty");
    await user.type(screen.getByLabelText(/^Password/), "short");
    expect(hint()).toHaveAttribute("data-strength", "too-short");
    expect(hint()).toHaveTextContent("Too short");
    await user.type(screen.getByLabelText(/^Password/), " plus");
    expect(hint()).toHaveAttribute("data-strength", "okay");
    await user.type(screen.getByLabelText(/^Password/), " and then some more");
    expect(hint()).toHaveAttribute("data-strength", "good");
  });

  it("lists what is wrong, links each item to its field and sends nothing", async () => {
    const user = setup();

    await submit(user);

    const summary = await screen.findByRole("alert", {}, { timeout: 2000 });
    expect(summary).toHaveTextContent("Enter your full name.");
    expect(summary).toHaveTextContent("You need to accept the terms and privacy notice.");
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("requires the terms checkbox, even when everything else is fine", async () => {
    const user = setup();
    await fill(user, { terms: false });

    await submit(user);

    expect(
      await screen.findAllByText("You need to accept the terms and privacy notice."),
    ).not.toHaveLength(0);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirmation beside the field", async () => {
    const user = setup();
    await fill(user, { confirm: "something else entirely" });

    await submit(user);

    expect((await screen.findAllByText("The two passwords don't match.")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByLabelText(/^Confirm password/)).toHaveAttribute("aria-invalid", "true");
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("rejects a password under ten characters before asking the server", async () => {
    const user = setup();
    await fill(user, { password: "short1" });

    await submit(user);

    expect((await screen.findAllByText("Use at least 10 characters.")).length).toBeGreaterThan(0);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("registers, sends the terms as accepted, and goes to the portal", async () => {
    apiFetchMock.mockResolvedValue({ user: { role: "CUSTOMER" } });
    const user = setup();
    await fill(user);

    await submit(user);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/portal");
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/auth/register", {
      method: "POST",
      body: {
        name: "Alex Morgan",
        email: "alex.morgan@example.test",
        password: GOOD_PASSWORD,
        passwordConfirmation: GOOD_PASSWORD,
        acceptTerms: true,
      },
    });
  });

  it("puts the server's field errors beside their fields and keeps the input", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "The request contains invalid values.",
        fieldErrors: { password: "That password is too common. Choose something harder to guess." },
      }),
    );
    const user = setup();
    await fill(user);

    await submit(user);

    expect(
      (await screen.findAllByText("That password is too common. Choose something harder to guess."))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^Email address/)).toHaveValue("alex.morgan@example.test");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("says an email is taken in the API's own words", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "EMAIL_TAKEN",
        message: "An account already exists for this email — sign in or reset your password.",
      }),
    );
    const user = setup();
    await fill(user);

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("An account already exists");
  });

  it("explains a closed sign-up clearly", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 403,
        code: "SIGNUP_DISABLED",
        message: "New accounts can't be created right now. Please contact the business.",
      }),
    );
    const user = setup();
    await fill(user);

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "New accounts can't be created right now",
    );
  });

  it("shows the public-demo privacy notice only in demo mode", () => {
    setup({ demoMode: true });
    expect(
      screen.getByText(
        "Public demo — use fictional details; other visitors can see what you enter.",
      ),
    ).toBeInTheDocument();
  });

  it("shows no demo notice otherwise", () => {
    setup({ demoMode: false });
    expect(screen.queryByText(/Public demo/)).not.toBeInTheDocument();
  });

  it("puts the terms notice beside the Google button", () => {
    setup({ googleClientId: "1234567890-abc.apps.googleusercontent.com" });

    expect(screen.getByTestId("google-button")).toBeInTheDocument();
    expect(screen.getByText(/By continuing with Google you agree/)).toBeInTheDocument();
  });
});
