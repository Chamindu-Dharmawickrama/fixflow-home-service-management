import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";
import { navigateWithFullReload } from "@/lib/auth/navigate";

import type { DemoAccountOption } from "../demo-accounts";
import { LoginForm } from "./login-form";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));
vi.mock("@/lib/auth/navigate", () => ({ navigateWithFullReload: vi.fn() }));
// The Google script is not loaded in tests.
vi.mock("next/script", () => ({ default: () => null }));

const apiFetchMock = vi.mocked(apiFetch);
const navigateMock = vi.mocked(navigateWithFullReload);

const DEMO_ACCOUNTS: DemoAccountOption[] = [
  {
    id: "admin",
    name: "Morgan Reyes",
    roleLabel: "Business admin",
    email: "admin@demo.fixflow.test",
    password: "demo-admin-password-for-tests",
    description: "Runs the business.",
    abilities: ["Review requests and send quotations", "Issue invoices"],
    limits: "Cannot change its password.",
  },
  {
    id: "customer",
    name: "Alex Morgan",
    roleLabel: "Customer",
    email: "alex.morgan@example.test",
    password: "demo-customer-password-for-tests",
    description: "A homeowner.",
    abilities: ["Send a service request", "Accept or decline a quotation"],
    limits: "Cannot change its password.",
  },
];

function setup(props: Partial<React.ComponentProps<typeof LoginForm>> = {}) {
  const user = userEvent.setup();
  render(
    <LoginForm returnTo={undefined} googleClientId={undefined} demoAccounts={[]} {...props} />,
  );
  return user;
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
  password: string,
) {
  await user.type(screen.getByLabelText(/^Email address/), email);
  await user.type(screen.getByLabelText(/^Password/), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LoginForm", () => {
  it("has labelled fields, password-manager friendly autocomplete and a forgot-password link", () => {
    setup();

    expect(screen.getByLabelText(/^Email address/)).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText(/^Email address/)).toHaveAttribute("type", "email");
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows and hides the password with a keyboard-reachable toggle", async () => {
    const user = setup();
    const password = screen.getByLabelText(/^Password/);
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("shows errors beside the fields and sends nothing when they are empty", async () => {
    const user = setup();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email address/)).toHaveAttribute("aria-invalid", "true");
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("signs in and goes to the role's home when there is no returnTo", async () => {
    apiFetchMock.mockResolvedValue({ user: { role: "CUSTOMER" } });
    const user = setup();

    await fillAndSubmit(user, "alex.morgan@example.test", "a calm passphrase");

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/portal");
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      body: { email: "alex.morgan@example.test", password: "a calm passphrase" },
    });
  });

  it("goes back to the page the visitor was headed for", async () => {
    apiFetchMock.mockResolvedValue({ user: { role: "BUSINESS_ADMIN" } });
    const user = setup({ returnTo: "/app/dashboard" });

    await fillAndSubmit(user, "admin@demo.fixflow.test", "a calm passphrase");

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/app/dashboard");
    });
  });

  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)"])(
    "ignores the open-redirect attempt %j and goes to the role's home",
    async (returnTo) => {
      apiFetchMock.mockResolvedValue({ user: { role: "CUSTOMER" } });
      const user = setup({ returnTo });

      await fillAndSubmit(user, "alex.morgan@example.test", "a calm passphrase");

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/portal");
      });
    },
  );

  it("shows the API's generic error, keeps what was typed and does not navigate", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 401,
        code: "INVALID_CREDENTIALS",
        message:
          "Email or password is incorrect. If you signed up with Google, use Continue with Google, or reset your password.",
      }),
    );
    const user = setup();

    await fillAndSubmit(user, "alex.morgan@example.test", "wrong passphrase");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Email or password is incorrect/);
    expect(screen.getByLabelText(/^Email address/)).toHaveValue("alex.morgan@example.test");
    expect(screen.getByLabelText(/^Password/)).toHaveValue("wrong passphrase");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).not.toHaveAttribute("aria-busy");
  });

  it("explains a rate limit with the wait the server asked for", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 429,
        code: "RATE_LIMITED",
        message: "Too many requests.",
        retryAfterSeconds: 600,
      }),
    );
    const user = setup();

    await fillAndSubmit(user, "alex.morgan@example.test", "a calm passphrase");

    expect(await screen.findByRole("alert")).toHaveTextContent("wait 10 minutes");
  });

  it("says plainly when the server cannot be reached", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "We couldn't reach the server. Check your connection and try again.",
      }),
    );
    const user = setup();

    await fillAndSubmit(user, "alex.morgan@example.test", "a calm passphrase");

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't reach the server/);
  });

  it("blocks a second submit while the first is pending", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    apiFetchMock.mockReturnValue(new Promise((done) => (resolve = done)));
    const user = setup();

    await fillAndSubmit(user, "alex.morgan@example.test", "a calm passphrase");
    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    await user.click(button);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    resolve({ user: { role: "CUSTOMER" } });
  });

  describe("Google", () => {
    it("explains why the button is missing when no client ID is configured", () => {
      setup({ googleClientId: undefined });

      expect(screen.getByText(/Google sign-in isn't set up on this site yet/)).toBeInTheDocument();
      expect(screen.queryByTestId("google-button")).not.toBeInTheDocument();
    });

    it("renders Google's button container when a client ID is configured", () => {
      setup({ googleClientId: "1234567890-abc.apps.googleusercontent.com" });

      expect(screen.getByTestId("google-button")).toBeInTheDocument();
      expect(screen.queryByText(/Google sign-in isn't set up/)).not.toBeInTheDocument();
    });
  });

  describe("demo accounts (D-09)", () => {
    it("shows no panel outside demo mode", () => {
      setup({ demoAccounts: [] });

      expect(screen.queryByRole("heading", { name: "Demo accounts" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Public demo/)).not.toBeInTheDocument();
    });

    it("lists the accounts with the public-demo notice", () => {
      setup({ demoAccounts: DEMO_ACCOUNTS });

      expect(screen.getByRole("heading", { name: "Demo accounts" })).toBeInTheDocument();
      expect(
        screen.getByText(
          "Public demo — use fictional details; other visitors can see what you enter.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("admin@demo.fixflow.test")).toBeInTheDocument();
      expect(screen.getByText("alex.morgan@example.test")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /Use this account/ })).toHaveLength(2);
    });

    it("explains what each account can do and what it cannot (T24)", () => {
      setup({ demoAccounts: DEMO_ACCOUNTS });

      expect(screen.getByText("Review requests and send quotations")).toBeInTheDocument();
      expect(screen.getByText("Accept or decline a quotation")).toBeInTheDocument();
      expect(screen.getAllByText("Cannot change its password.")).toHaveLength(2);
      expect(screen.getByRole("link", { name: "Read the demo notice" })).toHaveAttribute(
        "href",
        "/privacy",
      );
    });

    it("still warns to use fictional details when the demo offers no account", () => {
      setup({ demoAccounts: [], demoMode: true });

      const notice = screen.getByTestId("demo-sign-in-notice");
      expect(notice).toHaveTextContent(
        "Public demo — use fictional details; other visitors can see what you enter.",
      );
      expect(within(notice).getByRole("link", { name: "Read the demo notice" })).toHaveAttribute(
        "href",
        "/privacy",
      );
      expect(screen.queryByRole("heading", { name: "Demo accounts" })).not.toBeInTheDocument();
    });

    it("shows the warning once, inside the panel, when accounts are offered", () => {
      setup({ demoAccounts: DEMO_ACCOUNTS, demoMode: true });

      expect(screen.queryByTestId("demo-sign-in-notice")).not.toBeInTheDocument();
      expect(screen.getAllByText(/Public demo — use fictional details/)).toHaveLength(1);
    });

    it("fills the real form, signs nobody in, and moves focus to Sign in", async () => {
      const user = setup({ demoAccounts: DEMO_ACCOUNTS });

      await user.click(screen.getByRole("button", { name: /Use this account: Morgan Reyes/ }));

      expect(screen.getByLabelText(/^Email address/)).toHaveValue("admin@demo.fixflow.test");
      expect(screen.getByLabelText(/^Password/)).toHaveValue("demo-admin-password-for-tests");
      expect(apiFetchMock).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Sign in" })).toHaveFocus();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Filled in the details for Morgan Reyes",
      );
    });

    it("signs in only when the visitor then presses Sign in", async () => {
      apiFetchMock.mockResolvedValue({ user: { role: "BUSINESS_ADMIN" } });
      const user = setup({ demoAccounts: DEMO_ACCOUNTS });

      await user.click(screen.getByRole("button", { name: /Use this account: Morgan Reyes/ }));
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(apiFetchMock).toHaveBeenCalledWith("/auth/login", {
          method: "POST",
          body: { email: "admin@demo.fixflow.test", password: "demo-admin-password-for-tests" },
        });
      });
    });
  });
});
