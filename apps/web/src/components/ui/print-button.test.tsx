import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrintButton } from "./print-button";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PrintButton", () => {
  it("opens the browser's print dialog, once per press", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<PrintButton />);

    await userEvent.click(screen.getByRole("button", { name: "Print" }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it("says what it prints when asked to", () => {
    render(<PrintButton>Print quotation</PrintButton>);

    expect(screen.getByRole("button", { name: "Print quotation" })).toBeVisible();
  });

  it("is itself left off the paper", () => {
    render(<PrintButton />);

    expect(screen.getByRole("button", { name: "Print" })).toHaveClass("print:hidden");
  });

  it("hides its icon from a screen reader", () => {
    render(<PrintButton />);

    expect(screen.getByRole("button", { name: "Print" }).querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
