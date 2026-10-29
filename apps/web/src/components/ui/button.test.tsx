import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("is a type=button by default so it never submits a form by accident", () => {
    render(<Button>Save draft</Button>);
    expect(screen.getByRole("button", { name: "Save draft" })).toHaveAttribute("type", "button");
  });

  it("calls onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send quotation</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Send quotation" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  describe("loading", () => {
    it("marks itself busy and aria-disabled, shows a spinner and announces what it is doing", () => {
      const { container } = render(
        <Button loading loadingText="Sending quotation…">
          Send quotation
        </Button>,
      );
      const button = screen.getByRole("button", { name: "Send quotation" });

      expect(button).toHaveAttribute("aria-busy", "true");
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(container.querySelector("svg")).not.toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent("Sending quotation…");
    });

    it("stays focusable, so keyboard focus is not lost while a request is pending", async () => {
      render(<Button loading>Save</Button>);
      const button = screen.getByRole("button", { name: "Save" });
      expect(button).not.toBeDisabled();
      await userEvent.tab();
      expect(button).toHaveFocus();
    });

    it("ignores clicks and Enter, so the action cannot run twice", async () => {
      const onClick = vi.fn();
      render(
        <Button loading onClick={onClick}>
          Save
        </Button>,
      );
      const button = screen.getByRole("button", { name: "Save" });
      await userEvent.click(button);
      button.focus();
      await userEvent.keyboard("{Enter}");
      await userEvent.keyboard(" ");
      expect(onClick).not.toHaveBeenCalled();
    });

    it("does not submit the form while loading", async () => {
      const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <input aria-label="Name" />
          <Button type="submit" loading>
            Save
          </Button>
        </form>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await userEvent.type(screen.getByLabelText("Name"), "x{Enter}");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("submits the form once it has stopped loading", async () => {
      const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <Button type="submit">Save</Button>
        </form>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("has no live region when it is not loading", () => {
      render(<Button>Save</Button>);
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");
    });
  });

  it("disabled really disables", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Void invoice
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Void invoice" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("styles the child element when asChild is used", () => {
    render(
      <Button asChild variant="outline">
        <a href="#browse">Browse services</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Browse services" });
    expect(link).toHaveAttribute("href", "#browse");
    expect(link.className).toContain("border-border-strong");
  });
});
