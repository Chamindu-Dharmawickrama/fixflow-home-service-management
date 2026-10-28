import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Copy, Pencil } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";
import { DateInput, TimeInput } from "./date-input";
import { IconButton } from "./icon-button";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import { Select } from "./select";
import { Switch } from "./switch";
import { Textarea } from "./textarea";

describe("Textarea counter", () => {
  it("counts characters against the limit and is described by the counter", async () => {
    render(<Textarea aria-label="Problem" maxLength={20} showCount defaultValue="Hello" />);
    const textarea = screen.getByLabelText("Problem");

    expect(screen.getByText(/5 \/ 20/)).toBeVisible();
    expect(textarea).toHaveAccessibleDescription(/5 \/ 20/);

    await userEvent.type(textarea, " world");
    expect(screen.getByText(/11 \/ 20/)).toBeVisible();
  });

  it("follows a controlled value", () => {
    const { rerender } = render(
      <Textarea
        aria-label="Problem"
        maxLength={50}
        showCount
        value="abc"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(/3 \/ 50/)).toBeVisible();
    rerender(
      <Textarea
        aria-label="Problem"
        maxLength={50}
        showCount
        value="abcdef"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(/6 \/ 50/)).toBeVisible();
  });

  it("warns as the limit approaches", () => {
    render(<Textarea aria-label="Problem" maxLength={10} showCount defaultValue="123456789" />);
    expect(screen.getByText(/9 \/ 10/).className).toContain("text-attention");
  });

  it("keeps the caller's aria-describedby alongside the counter", () => {
    render(
      <>
        <p id="hint">Be specific.</p>
        <Textarea aria-label="Problem" aria-describedby="hint" maxLength={20} showCount />
      </>,
    );
    expect(screen.getByLabelText("Problem")).toHaveAccessibleDescription(/Be specific\. 0 \/ 20/);
  });

  it("shows no counter unless asked", () => {
    render(<Textarea aria-label="Problem" maxLength={20} />);
    expect(screen.queryByText(/\/ 20/)).toBeNull();
  });

  it("calls onChange", async () => {
    const onChange = vi.fn();
    render(<Textarea aria-label="Problem" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Problem"), "ab");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe("Select", () => {
  it("starts on its placeholder and returns the chosen value", async () => {
    render(
      <Select aria-label="Service" placeholder="Choose a service">
        <option value="ac">AC Diagnostic Visit</option>
        <option value="wm">Washing Machine Repair</option>
      </Select>,
    );
    const select = screen.getByLabelText("Service");

    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "Choose a service" })).toBeInTheDocument();

    await userEvent.selectOptions(select, "wm");
    expect(select).toHaveValue("wm");
  });

  it("does not let a required select go back to its placeholder", () => {
    render(
      <Select aria-label="Service" placeholder="Choose a service" required>
        <option value="ac">AC</option>
      </Select>,
    );
    expect(screen.getByRole("option", { name: "Choose a service" })).toBeDisabled();
  });

  it("respects an explicit value", () => {
    render(
      <Select aria-label="Service" placeholder="Choose" value="wm" onChange={() => undefined}>
        <option value="ac">AC</option>
        <option value="wm">Washer</option>
      </Select>,
    );
    expect(screen.getByLabelText("Service")).toHaveValue("wm");
  });
});

describe("DateInput and TimeInput", () => {
  it("use the API formats: YYYY-MM-DD and HH:mm", () => {
    render(
      <>
        <DateInput aria-label="Date" defaultValue="2026-11-03" min="2026-10-28" />
        <TimeInput aria-label="Time" defaultValue="09:30" />
      </>,
    );
    expect(screen.getByLabelText("Date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-03");
    expect(screen.getByLabelText("Date")).toHaveAttribute("min", "2026-10-28");
    expect(screen.getByLabelText("Time")).toHaveAttribute("type", "time");
    expect(screen.getByLabelText("Time")).toHaveValue("09:30");
  });

  it("accept typed values", async () => {
    render(<DateInput aria-label="Date" />);
    await userEvent.type(screen.getByLabelText("Date"), "2026-12-01");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-12-01");
  });
});

describe("Checkbox, Switch and RadioGroup", () => {
  it("toggle with the keyboard", async () => {
    const onChecked = vi.fn();
    const onSwitch = vi.fn();
    render(
      <>
        <Checkbox aria-label="Agree" onCheckedChange={onChecked} />
        <Switch aria-label="Publish" onCheckedChange={onSwitch} />
      </>,
    );

    await userEvent.tab();
    expect(screen.getByRole("checkbox", { name: "Agree" })).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(onChecked).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("checkbox", { name: "Agree" })).toBeChecked();

    await userEvent.tab();
    expect(screen.getByRole("switch", { name: "Publish" })).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(onSwitch).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("switch", { name: "Publish" })).toBeChecked();
  });

  it("move through radio options with the arrow keys", async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup aria-label="Window" onValueChange={onValueChange} defaultValue="MORNING">
        <RadioGroupItem value="MORNING" aria-label="Morning" />
        <RadioGroupItem value="AFTERNOON" aria-label="Afternoon" />
      </RadioGroup>,
    );
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Morning" })).toHaveFocus();
    // Radix moves focus and checks the option on the next tick, so hold the key until it has.
    await userEvent.keyboard("{ArrowDown>}");
    await waitFor(() => expect(screen.getByRole("radio", { name: "Afternoon" })).toHaveFocus());
    await userEvent.keyboard("{/ArrowDown}");
    expect(onValueChange).toHaveBeenLastCalledWith("AFTERNOON");
    expect(screen.getByRole("radio", { name: "Afternoon" })).toBeChecked();
  });

  it("do not respond while disabled", async () => {
    const onChecked = vi.fn();
    render(<Checkbox aria-label="Locked" disabled onCheckedChange={onChecked} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Locked" }));
    expect(onChecked).not.toHaveBeenCalled();
  });
});

describe("IconButton", () => {
  it("is named by its required label", () => {
    render(<IconButton label="Edit request" icon={Pencil} tooltip={false} />);
    const button = screen.getByRole("button", { name: "Edit request" });
    expect(button).toBeVisible();
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("calls onClick and can show progress", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton label="Copy reference" icon={Copy} onClick={onClick} tooltip={false} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <IconButton label="Copy reference" icon={Copy} onClick={onClick} loading tooltip={false} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
