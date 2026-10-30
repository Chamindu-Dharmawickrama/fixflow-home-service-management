import type { ServiceAddressDto } from "@fixflow/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AddressSelector } from "./address-selector";

function address(overrides: Partial<ServiceAddressDto> = {}): ServiceAddressDto {
  return {
    id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    label: "Home",
    line1: "214 Larkspur Lane",
    line2: "Apt 2B",
    city: "Harbor City",
    region: "NY",
    postalCode: "10999",
    accessNotes: "Gate code 4471. Beware of the dog.",
    isDefault: true,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-28T10:30:00.000Z",
    ...overrides,
  };
}

const HOME = address();
const OFFICE = address({
  id: "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
  label: "Office",
  line1: "9 Dock Street",
  line2: null,
  postalCode: "10001",
  accessNotes: null,
  isDefault: false,
});

describe("AddressSelector", () => {
  it("offers each address as a radio choice with its label and the address on one line", () => {
    render(<AddressSelector addresses={[HOME, OFFICE]} value={null} onChange={vi.fn()} />);

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    const home = screen.getByRole("radio", { name: /Home/ });
    expect(home).toHaveAccessibleName(/214 Larkspur Lane, Apt 2B, Harbor City, NY 10999/);
    expect(screen.getByRole("radio", { name: /Office/ })).toHaveAccessibleName(
      /9 Dock Street, Harbor City, NY 10001/,
    );
  });

  it("marks the default in words and keeps the access notes out of the choice", () => {
    render(<AddressSelector addresses={[HOME, OFFICE]} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /Home/ })).toHaveAccessibleName(/Default/);
    expect(screen.getByRole("radio", { name: /Office/ })).not.toHaveAccessibleName(/Default/);
    expect(screen.queryByText(/Gate code 4471/)).not.toBeInTheDocument();
  });

  it("shows the chosen address as selected and none when the value is null", () => {
    const { rerender } = render(
      <AddressSelector addresses={[HOME, OFFICE]} value={null} onChange={vi.fn()} />,
    );
    expect(
      screen.getAllByRole("radio").every((radio) => radio.getAttribute("aria-checked") === "false"),
    ).toBe(true);

    rerender(<AddressSelector addresses={[HOME, OFFICE]} value={OFFICE.id} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Office/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Home/ })).not.toBeChecked();
  });

  it("reports the chosen id when a choice is clicked, by its label too", async () => {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<string | null>(HOME.id);
      return (
        <AddressSelector
          addresses={[HOME, OFFICE]}
          value={value}
          onChange={(id) => {
            onChange(id);
            setValue(id);
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("Office"));

    expect(onChange).toHaveBeenCalledWith(OFFICE.id);
    expect(screen.getByRole("radio", { name: /Office/ })).toBeChecked();
  });

  it("can be used with the keyboard", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AddressSelector addresses={[HOME, OFFICE]} value={HOME.id} onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole("radio", { name: /Home/ })).toHaveFocus();
    // Radix moves focus to the next choice on a timer and chooses it only while the arrow key is
    // still down, as it is for a person; user-event would release the key straight away.
    await user.keyboard("{ArrowDown>}");
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(OFFICE.id);
    });
    await user.keyboard("{/ArrowDown}");
  });

  it("blocks every choice when disabled", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <AddressSelector addresses={[HOME, OFFICE]} value={null} onChange={onChange} disabled />,
    );

    await user.click(screen.getByText("Office"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Office/ })).toBeDisabled();
  });

  it("passes the field's accessibility attributes to the group", () => {
    render(
      <AddressSelector
        addresses={[HOME]}
        value={null}
        onChange={vi.fn()}
        id="serviceAddress"
        aria-invalid
        aria-describedby="serviceAddress-error"
      />,
    );

    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("id", "serviceAddress");
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAttribute("aria-describedby", "serviceAddress-error");
  });

  it("offers to add another address when asked to", async () => {
    const onAddNew = vi.fn();
    const user = userEvent.setup();
    render(
      <AddressSelector addresses={[HOME]} value={HOME.id} onChange={vi.fn()} onAddNew={onAddNew} />,
    );

    await user.click(screen.getByRole("button", { name: "Add a new address" }));

    expect(onAddNew).toHaveBeenCalledTimes(1);
  });

  it("shows no add button unless an action is given", () => {
    render(<AddressSelector addresses={[HOME]} value={HOME.id} onChange={vi.fn()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says so, instead of showing an empty list, when there is no saved address", async () => {
    const onAddNew = vi.fn();
    const user = userEvent.setup();
    render(<AddressSelector addresses={[]} value={null} onChange={vi.fn()} onAddNew={onAddNew} />);

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByText(/You have no saved addresses yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add an address" }));
    expect(onAddNew).toHaveBeenCalledTimes(1);
  });
});
