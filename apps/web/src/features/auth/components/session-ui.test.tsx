import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";
import { navigateWithFullReload } from "@/lib/auth/navigate";

import { getDemoAccounts } from "../demo-accounts";
import { KEEP_ALIVE_INTERVAL_MS, SessionKeepAlive } from "./session-keep-alive";
import { UserMenu } from "./user-menu";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));
vi.mock("@/lib/auth/navigate", () => ({ navigateWithFullReload: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);
const navigateMock = vi.mocked(navigateWithFullReload);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UserMenu", () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /Account menu for/ }));
  };

  it("names the person and their role", async () => {
    const user = userEvent.setup();
    render(<UserMenu name="Morgan Reyes" avatarUrl={null} roleLabel="Business admin" />);

    await openMenu(user);

    expect(await screen.findByText("Morgan Reyes · Business admin")).toBeInTheDocument();
  });

  it("links to the account page only where the role has one (no dead links)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <UserMenu
        name="Morgan Reyes"
        avatarUrl={null}
        roleLabel="Business admin"
        accountHref="/app/account"
      />,
    );
    await openMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Account" })).toHaveAttribute(
      "href",
      "/app/account",
    );
    unmount();

    render(<UserMenu name="Alex Morgan" avatarUrl={null} roleLabel="Customer" />);
    await openMenu(user);
    await screen.findByRole("menuitem", { name: "Sign out" });
    expect(screen.queryByRole("menuitem", { name: "Account" })).not.toBeInTheDocument();
  });

  it("signs out through the API and then loads the home page afresh", async () => {
    apiFetchMock.mockResolvedValue({ signedOut: true });
    const user = userEvent.setup();
    render(<UserMenu name="Alex Morgan" avatarUrl={null} roleLabel="Customer" />);

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/");
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/auth/logout", { method: "POST" });
  });

  it("does not pretend to have signed out when the request fails", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 0, code: "NETWORK_ERROR", message: "offline" }),
    );
    const user = userEvent.setup();
    render(<UserMenu name="Alex Morgan" avatarUrl={null} roleLabel="Customer" />);

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't sign you out");
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("SessionKeepAlive", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiFetchMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the API who is signed in once, not on every visit within the interval", () => {
    const first = render(<SessionKeepAlive />);
    first.unmount();
    render(<SessionKeepAlive />);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    // `refresh=1` asks for the cookie again with the stored expiry (T25, D-114).
    expect(apiFetchMock).toHaveBeenCalledWith("/auth/me?refresh=1");
  });

  it("asks again once the interval has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    render(<SessionKeepAlive />).unmount();
    vi.setSystemTime(new Date(Date.now() + KEEP_ALIVE_INTERVAL_MS + 1000));
    render(<SessionKeepAlive />);

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a failed check and renders nothing", () => {
    apiFetchMock.mockRejectedValue(new Error("offline"));
    const { container } = render(<SessionKeepAlive />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("getDemoAccounts", () => {
  it("offers nothing unless demo mode is on", () => {
    expect(getDemoAccounts({ mode: undefined, adminPassword: "x", customerPassword: "y" })).toEqual(
      [],
    );
    expect(getDemoAccounts({ mode: "false", adminPassword: "x", customerPassword: "y" })).toEqual(
      [],
    );
  });

  it("offers the admin and the customer with the configured passwords", () => {
    const accounts = getDemoAccounts({
      mode: "true",
      adminPassword: "admin-pw-x",
      customerPassword: "cust-pw-y",
    });

    expect(accounts.map((a) => [a.id, a.email, a.password])).toEqual([
      ["admin", "admin@demo.fixflow.test", "admin-pw-x"],
      ["customer", "alex.morgan@example.test", "cust-pw-y"],
    ]);
  });

  it("says what each account can do, and what the demo locks for it (T24)", () => {
    const [admin, customer] = getDemoAccounts({
      mode: "true",
      adminPassword: "admin-pw-x",
      customerPassword: "cust-pw-y",
    });

    expect(admin?.abilities.join(" ")).toMatch(/quotations/);
    expect(admin?.abilities.join(" ")).toMatch(/invoices/);
    expect(admin?.limits).toMatch(/password/);
    expect(admin?.limits).toMatch(/business name, logo and contact details/);
    expect(customer?.abilities.join(" ")).toMatch(/Accept or decline a quotation/);
    expect(customer?.limits).toMatch(/password/);
  });

  it("leaves out an account whose password is not configured", () => {
    const accounts = getDemoAccounts({
      mode: "true",
      adminPassword: undefined,
      customerPassword: "cust-pw-y",
    });

    expect(accounts.map((a) => a.id)).toEqual(["customer"]);
  });
});
