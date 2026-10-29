import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bannerText, DemoBanner } from "./demo-banner";

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DemoBanner", () => {
  it("says the business is fictional and that data resets, naming the business", () => {
    render(<DemoBanner businessName="CoolBreeze Home Services" />);

    const banner = screen.getByRole("region", { name: "Demo notice" });
    expect(banner).toHaveTextContent(
      "FixFlow portfolio demo — CoolBreeze Home Services is a fictional business. Data resets regularly.",
    );
  });

  it("links to the privacy and demo notice", () => {
    render(<DemoBanner businessName="CoolBreeze Home Services" />);

    expect(screen.getByRole("link", { name: "Privacy and demo notice" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  it("still reads sensibly when the business name could not be loaded", () => {
    render(<DemoBanner />);

    expect(screen.getByRole("region", { name: "Demo notice" })).toHaveTextContent(
      "FixFlow portfolio demo — the business shown here is fictional. Data resets regularly.",
    );
    expect(bannerText(undefined)).not.toContain("{business}");
  });

  it("can be dismissed, and stays dismissed for the rest of the session", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DemoBanner businessName="CoolBreeze Home Services" />);

    await user.click(screen.getByRole("button", { name: "Dismiss demo notice" }));

    expect(screen.queryByRole("region", { name: "Demo notice" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("fixflow.demoBannerDismissed")).toBe("1");

    // The next page of the same session mounts a fresh banner: it stays away.
    unmount();
    render(<DemoBanner businessName="CoolBreeze Home Services" />);
    expect(screen.queryByRole("region", { name: "Demo notice" })).not.toBeInTheDocument();
  });

  it("comes back in a new session", () => {
    window.sessionStorage.setItem("fixflow.demoBannerDismissed", "1");
    window.sessionStorage.clear();

    render(<DemoBanner businessName="CoolBreeze Home Services" />);

    expect(screen.getByRole("region", { name: "Demo notice" })).toBeInTheDocument();
  });

  it("still closes when the browser will not store the choice", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<DemoBanner businessName="CoolBreeze Home Services" />);

    await user.click(screen.getByRole("button", { name: "Dismiss demo notice" }));

    // Nothing was stored, so the banner is shown again on the next render, but the click did not throw.
    expect(screen.getByRole("region", { name: "Demo notice" })).toBeInTheDocument();
  });

  it("does not break when reading storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    render(<DemoBanner businessName="CoolBreeze Home Services" />);

    expect(screen.getByRole("region", { name: "Demo notice" })).toBeInTheDocument();
  });
});
