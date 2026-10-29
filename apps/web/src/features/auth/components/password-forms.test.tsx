import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { ChangePasswordForm } from "./change-password-form";
import { ForgotPasswordForm } from "./forgot-password-form";
import { ResetPasswordForm } from "./reset-password-form";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const CONFIRMATION =
  "If an account exists for that email, we've sent a reset link. It works for 60 minutes.";
const NEW_PASSWORD = "copper lantern drifts west";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ForgotPasswordForm", () => {
  it("shows the same confirmation whatever the API answers for an address", async () => {
    apiFetchMock.mockResolvedValue({ message: CONFIRMATION });
    const user = userEvent.setup();
    render(<ForgotPasswordForm showOutboxNote={false} />);

    await user.type(screen.getByLabelText(/^Email address/), "nobody@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByTestId("forgot-confirmation")).toHaveTextContent(CONFIRMATION);
    expect(apiFetchMock).toHaveBeenCalledWith("/auth/password/forgot", {
      method: "POST",
      body: { email: "nobody@example.test" },
    });
    expect(screen.getByRole("button", { name: "Send another link" })).toBeInTheDocument();
  });

  it("validates the email before sending", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm showOutboxNote={false} />);

    await user.type(screen.getByLabelText(/^Email address/), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText(/Enter a valid email address/)).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("notes in development that links go to the outbox, and not otherwise", () => {
    const { unmount } = render(<ForgotPasswordForm showOutboxNote />);
    expect(screen.getByText(/\.data\/outbox\//)).toBeInTheDocument();
    unmount();

    render(<ForgotPasswordForm showOutboxNote={false} />);
    expect(screen.queryByText(/\.data\/outbox\//)).not.toBeInTheDocument();
  });

  it("shows the demo lock and reset-unavailable messages from the API", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 403,
        code: "DEMO_ACCOUNT_LOCKED",
        message: "This is a shared demo account, so its password can't be changed.",
      }),
    );
    const user = userEvent.setup();
    render(<ForgotPasswordForm showOutboxNote={false} />);

    await user.type(screen.getByLabelText(/^Email address/), "alex.morgan@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("shared demo account");
    expect(screen.queryByTestId("forgot-confirmation")).not.toBeInTheDocument();
  });
});

describe("ResetPasswordForm", () => {
  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, password = NEW_PASSWORD) {
    await user.type(screen.getByLabelText(/^New password/), password);
    await user.type(screen.getByLabelText(/^Confirm new password/), password);
    await user.click(screen.getByRole("button", { name: "Change password" }));
  }

  it.each([undefined, ""])("shows the invalid-link state when the token is %j", (token) => {
    render(<ResetPasswordForm token={token} />);

    expect(screen.getByTestId("reset-invalid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
  });

  it("sends the token with the new password and then offers to sign in", async () => {
    apiFetchMock.mockResolvedValue({ passwordReset: true });
    const user = userEvent.setup();
    render(<ResetPasswordForm token="the-token-from-the-email" />);

    await fillAndSubmit(user);

    expect(await screen.findByTestId("reset-success")).toHaveTextContent(
      "Your password has been changed.",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(apiFetchMock).toHaveBeenCalledWith("/auth/password/reset", {
      method: "POST",
      body: {
        token: "the-token-from-the-email",
        password: NEW_PASSWORD,
        passwordConfirmation: NEW_PASSWORD,
      },
    });
  });

  it("swaps to the request-a-new-link state when the API rejects the token", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 400,
        code: "INVALID_RESET_TOKEN",
        message: "This reset link is invalid or has expired. Request a new one to continue.",
      }),
    );
    const user = userEvent.setup();
    render(<ResetPasswordForm token="expired" />);

    await fillAndSubmit(user);

    expect(await screen.findByTestId("reset-invalid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toBeInTheDocument();
  });

  it("keeps the form and shows the server's message for a weak password", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "The request contains invalid values.",
        fieldErrors: { password: "That password is too common. Choose something harder to guess." },
      }),
    );
    const user = userEvent.setup();
    render(<ResetPasswordForm token="good-token" />);

    await fillAndSubmit(user);

    expect(
      await screen.findByText("That password is too common. Choose something harder to guess."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("reset-invalid")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^New password/)).toHaveValue(NEW_PASSWORD);
  });

  it("checks the confirmation before sending", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="good-token" />);

    await user.type(screen.getByLabelText(/^New password/), NEW_PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm new password/), "something different");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("The two passwords don't match.")).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe("ChangePasswordForm", () => {
  it("offers 'Set a password' to an account that has none, instead of a form that cannot work", () => {
    render(<ChangePasswordForm hasPassword={false} />);

    expect(screen.getByRole("link", { name: "Set a password" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.queryByLabelText(/^Current password/)).not.toBeInTheDocument();
  });

  it("changes the password, clears the fields and says the other devices were signed out", async () => {
    apiFetchMock.mockResolvedValue({ passwordChanged: true });
    const user = userEvent.setup();
    render(<ChangePasswordForm hasPassword />);

    await user.type(screen.getByLabelText(/^Current password/), "the old passphrase");
    await user.type(screen.getByLabelText(/^New password/), NEW_PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm new password/), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByTestId("password-changed")).toHaveTextContent(
      "other devices were signed out",
    );
    expect(apiFetchMock).toHaveBeenCalledWith("/auth/password/change", {
      method: "POST",
      body: {
        currentPassword: "the old passphrase",
        newPassword: NEW_PASSWORD,
        newPasswordConfirmation: NEW_PASSWORD,
      },
    });
    await waitFor(() => {
      expect(screen.getByLabelText(/^Current password/)).toHaveValue("");
    });
  });

  it("shows a wrong current password beside that field", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "INVALID_CURRENT_PASSWORD",
        message: "Your current password is incorrect.",
        fieldErrors: { currentPassword: "Your current password is incorrect." },
      }),
    );
    const user = userEvent.setup();
    render(<ChangePasswordForm hasPassword />);

    await user.type(screen.getByLabelText(/^Current password/), "not my password");
    await user.type(screen.getByLabelText(/^New password/), NEW_PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm new password/), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("Your current password is incorrect.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Current password/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByTestId("password-changed")).not.toBeInTheDocument();
  });

  it("shows the demo lock as a form message", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 403,
        code: "DEMO_ACCOUNT_LOCKED",
        message: "This is a shared demo account, so its password can't be changed.",
      }),
    );
    const user = userEvent.setup();
    render(<ChangePasswordForm hasPassword />);

    await user.type(screen.getByLabelText(/^Current password/), "anything at all");
    await user.type(screen.getByLabelText(/^New password/), NEW_PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm new password/), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("shared demo account");
  });
});
