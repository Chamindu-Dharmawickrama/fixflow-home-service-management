import type { ServiceAddressDto } from "@fixflow/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProfileSummaryCard } from "./profile-summary-card";
import { SignInSecurityCard } from "./sign-in-security-card";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const HOME: ServiceAddressDto = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  label: "Home",
  line1: "214 Larkspur Lane",
  line2: "Apt 2B",
  city: "Harbor City",
  region: "NY",
  postalCode: "10999",
  accessNotes: "Buzz apartment 2B.",
  isDefault: true,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-28T10:30:00.000Z",
};

describe("ProfileSummaryCard", () => {
  it("shows the contact details and the default address, with the way to the full profile", () => {
    render(
      <ProfileSummaryCard
        profile={{
          name: "Alex Morgan",
          email: "alex.morgan@example.test",
          phone: "(212) 555-0171",
          addresses: [
            {
              ...HOME,
              id: "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
              label: "Office",
              isDefault: false,
            },
            HOME,
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Your profile" })).toBeInTheDocument();
    expect(screen.getByText("Alex Morgan")).toBeInTheDocument();
    expect(screen.getByText("alex.morgan@example.test")).toBeInTheDocument();
    expect(screen.getByText("(212) 555-0171")).toBeInTheDocument();
    // The default one, not the first one in the list.
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.queryByText("Office")).not.toBeInTheDocument();
    expect(screen.getByText("Harbor City, NY 10999")).toBeInTheDocument();
    expect(screen.queryByText(/Buzz apartment/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View and edit your profile" })).toHaveAttribute(
      "href",
      "/portal/profile",
    );
  });

  it("says plainly what is missing instead of leaving a blank", () => {
    render(
      <ProfileSummaryCard
        profile={{
          name: "Priya Shah",
          email: "priya.shah@example.test",
          phone: null,
          addresses: [],
        }}
      />,
    );

    expect(screen.getByText("Not added yet")).toBeInTheDocument();
    expect(screen.getByText("No saved address yet")).toBeInTheDocument();
  });
});

describe("SignInSecurityCard", () => {
  it("lists the sign-in methods and offers the password form", () => {
    render(
      <SignInSecurityCard
        profile={{ hasPassword: true, hasGoogle: false, passwordChangeLocked: false }}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Sign-in & security" }),
    ).toBeInTheDocument();
    const methods = screen.getByText("Email and password").closest("div");
    expect(methods).toHaveTextContent("Set up");
    expect(screen.getByText("Google").closest("div")).toHaveTextContent("Not linked");
    expect(screen.getByRole("form", { name: "Change password" })).toBeInTheDocument();
    expect(screen.queryByText(/turned off in the demo/)).not.toBeInTheDocument();
  });

  it("shows a linked Google account", () => {
    render(
      <SignInSecurityCard
        profile={{ hasPassword: true, hasGoogle: true, passwordChangeLocked: false }}
      />,
    );

    expect(screen.getByText("Google").closest("div")).toHaveTextContent("Linked");
  });

  it("offers 'Set a password' to an account that signs in with Google only", () => {
    render(
      <SignInSecurityCard
        profile={{ hasPassword: false, hasGoogle: true, passwordChangeLocked: false }}
      />,
    );

    expect(screen.getByText("Email and password").closest("div")).toHaveTextContent("Not set up");
    expect(screen.queryByRole("form", { name: "Change password" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set a password" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("tells a demo account that password changes are turned off, and offers no form", () => {
    render(
      <SignInSecurityCard
        profile={{ hasPassword: true, hasGoogle: false, passwordChangeLocked: true }}
      />,
    );

    expect(screen.getByText(/Password changes are turned off in the demo/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Change password" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set a password" })).not.toBeInTheDocument();
  });
});
