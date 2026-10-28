import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NavGroup, NavItem } from "@/lib/navigation";

const pathname = vi.hoisted(() => ({ current: "/app/requests/42" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

import { MobileNav } from "./mobile-nav";
import { NavItems } from "./nav-items";
import { NavList } from "./nav-list";
import { PublicNav } from "./public-nav";
import { SkipLink } from "./skip-link";

const ADMIN_GROUPS: NavGroup[] = [
  {
    label: "Work",
    items: [
      { label: "Dashboard", href: "/app/dashboard", icon: "layout-dashboard", match: "exact" },
      { label: "Requests", href: "/app/requests", icon: "inbox" },
    ],
  },
  { label: "Business", items: [{ label: "Settings", href: "/app/settings", icon: "settings" }] },
];

const PUBLIC_ITEMS: NavItem[] = [
  { label: "Services", href: "/services", icon: "layers" },
  { label: "How it works", href: "/how-it-works", icon: "clipboard-list" },
];

beforeEach(() => {
  pathname.current = "/app/requests/42";
});

describe("NavItems", () => {
  it("renders grouped links with headings", () => {
    render(<NavItems groups={ADMIN_GROUPS} variant="sidebar" />);
    expect(screen.getByText("Work")).toBeVisible();
    expect(screen.getByRole("list", { name: "Work" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/app/settings");
  });

  it("marks only the active item as the current page", () => {
    render(<NavItems groups={ADMIN_GROUPS} variant="sidebar" activeHref="/app/requests" />);
    expect(screen.getByRole("link", { name: "Requests" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("renders nothing when there are no links", () => {
    const { container } = render(<NavItems groups={[{ items: [] }]} variant="top" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("NavList", () => {
  it("highlights the item for the current URL, including pages beneath it", () => {
    render(<NavList groups={ADMIN_GROUPS} variant="sidebar" />);
    expect(screen.getByRole("link", { name: "Requests" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("does not highlight an exact-match item on a deeper page", () => {
    pathname.current = "/app/dashboard/archive";
    render(<NavList groups={ADMIN_GROUPS} variant="sidebar" />);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });
});

describe("SkipLink", () => {
  it("is the first tab stop and points at the main content", async () => {
    render(
      <>
        <SkipLink />
        <button type="button">Other</button>
        <main id="main-content" />
      </>,
    );
    await userEvent.tab();
    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute("href", "#main-content");
  });
});

describe("PublicNav (mobile disclosure)", () => {
  it("opens and closes with the keyboard, and Escape returns focus to the button", async () => {
    render(<PublicNav items={PUBLIC_ITEMS} cta={<a href="/services">Browse services</a>} />);
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    await userEvent.tab();
    // The desktop row of links comes first in the tab order; reach the button explicitly.
    button.focus();
    await userEvent.keyboard("{Enter}");

    expect(button).toHaveAttribute("aria-expanded", "true");
    const panelId = button.getAttribute("aria-controls") ?? "";
    const panel = document.getElementById(panelId);
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByRole("link", { name: "Services" })).toBeVisible();
    expect(
      within(panel as HTMLElement).getByRole("link", { name: "Browse services" }),
    ).toBeVisible();

    // Move into the menu, then Escape from inside it.
    await userEvent.tab();
    expect(within(panel as HTMLElement).getByRole("link", { name: "Services" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(panelId)).toBeNull();
    expect(button).toHaveFocus();
  });

  it("toggles with Space and closes again with the same button", async () => {
    render(<PublicNav items={PUBLIC_ITEMS} />);
    const button = screen.getByRole("button", { name: "Menu" });
    button.focus();
    await userEvent.keyboard(" ");
    expect(button).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard(" ");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when a link is chosen", async () => {
    render(<PublicNav items={PUBLIC_ITEMS} />);
    const button = screen.getByRole("button", { name: "Menu" });
    await userEvent.click(button);
    const panel = document.getElementById(
      button.getAttribute("aria-controls") ?? "",
    ) as HTMLElement;
    await userEvent.click(within(panel).getByRole("link", { name: "How it works" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("renders nothing without navigation items", () => {
    const { container } = render(<PublicNav items={[]} />);
    expect(container.querySelector("nav")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("MobileNav (drawer)", () => {
  function renderDrawer() {
    return render(
      <>
        <MobileNav
          groups={ADMIN_GROUPS}
          brand={<span>FixFlow</span>}
          footer={<p>Signed in as Alex</p>}
        />
        <main>Page</main>
      </>,
    );
  }

  it("opens as a modal dialog, moves focus inside, and shows the navigation and footer", async () => {
    renderDrawer();
    const trigger = screen.getByRole("button", { name: "Open menu" });

    await userEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Main navigation" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(within(dialog).getByRole("link", { name: "Requests" })).toBeVisible();
    expect(within(dialog).getByText("Signed in as Alex")).toBeVisible();
  });

  it("closes with Escape and returns focus to the button that opened it", async () => {
    renderDrawer();
    const trigger = screen.getByRole("button", { name: "Open menu" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps Tab inside the drawer", async () => {
    renderDrawer();
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = await screen.findByRole("dialog");

    for (let press = 0; press < 8; press += 1) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("closes when a link is chosen", async () => {
    renderDrawer();
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("link", { name: "Settings" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
