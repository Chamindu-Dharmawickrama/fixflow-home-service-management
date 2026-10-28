import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { Field, FieldGroup } from "./field";
import { getFieldId } from "./field-id";
import { FormField, FormFieldGroup } from "./form-field";

describe("Field", () => {
  it("ties the label to the control with matching for and id", () => {
    render(
      <Field id="email" label="Email address">
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText("Email address");
    expect(input).toHaveAttribute("id", "email");
    expect(screen.getByText("Email address").closest("label")).toHaveAttribute("for", "email");
  });

  it("describes the control by its help text", () => {
    render(
      <Field id="email" label="Email address" description="We'll send the quotation here.">
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText("Email address");
    const help = screen.getByText("We'll send the quotation here.");

    expect(help).toHaveAttribute("id", "email-description");
    expect(input).toHaveAttribute("aria-describedby", "email-description");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription("We'll send the quotation here.");
  });

  it("marks the control invalid and describes it by help and error together", () => {
    render(
      <Field
        id="email"
        label="Email address"
        description="We'll send the quotation here."
        error="Enter a valid email address."
      >
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText("Email address");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-description email-error");
    expect(screen.getByText("Enter a valid email address.").closest("[id]")).toHaveAttribute(
      "id",
      "email-error",
    );
    expect(input).toHaveAccessibleDescription(
      "We'll send the quotation here. Enter a valid email address.",
    );
  });

  it("describes the control by its error alone when there is no help text", () => {
    render(
      <Field id="phone" label="Phone" error="Too short.">
        {(control) => <Input {...control} />}
      </Field>,
    );
    expect(screen.getByLabelText("Phone")).toHaveAttribute("aria-describedby", "phone-error");
  });

  it("has no aria-describedby at all when there is nothing to describe", () => {
    render(
      <Field id="name" label="Name">
        {(control) => <Input {...control} />}
      </Field>,
    );
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-describedby");
  });

  it("marks a required field visibly and for assistive technology", () => {
    render(
      <Field id="name" label="Full name" required>
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText(/Full name/);
    expect(input).toHaveAttribute("aria-required", "true");
    // The asterisk is decorative; "required" comes from aria-required.
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps an always-present polite region for errors so a new message is announced", () => {
    const { rerender } = render(
      <Field id="name" label="Name">
        {(control) => <Input {...control} />}
      </Field>,
    );
    const region = document.getElementById("name-error");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();

    rerender(
      <Field id="name" label="Name" error="Required.">
        {(control) => <Input {...control} />}
      </Field>,
    );
    expect(document.getElementById("name-error")).toBe(region);
    expect(region).toHaveTextContent("Required.");
  });

  it("puts the control before its label in the inline layout", () => {
    render(
      <Field id="terms" label="I agree" layout="inline">
        {(control) => <Input type="checkbox" {...control} />}
      </Field>,
    );
    const checkbox = screen.getByLabelText("I agree");
    const label = screen.getByText("I agree");
    expect(checkbox.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("FieldGroup", () => {
  it("names a group of controls with a fieldset and legend, and describes it", () => {
    render(
      <FieldGroup
        id="window"
        legend="Preferred time"
        description="We'll confirm the slot."
        error="Choose one."
      >
        {(control) => (
          <RadioGroup {...control}>
            <RadioGroupItem value="MORNING" id="window-morning" aria-label="Morning" />
            <RadioGroupItem value="EVENING" id="window-evening" aria-label="Evening" />
          </RadioGroup>
        )}
      </FieldGroup>,
    );
    const group = screen.getByRole("group", { name: "Preferred time" });
    expect(group.tagName).toBe("FIELDSET");
    expect(group).toHaveAttribute("aria-describedby", "window-description window-error");

    const radiogroup = screen.getByRole("radiogroup");
    expect(radiogroup).toHaveAttribute("aria-invalid", "true");
    expect(radiogroup).toHaveAttribute("id", "window");
  });
});

describe("getFieldId", () => {
  it("builds a stable id from the field path", () => {
    expect(getFieldId("email")).toBe("field-email");
    expect(getFieldId("lines.2.quantity")).toBe("field-lines-2-quantity");
    expect(getFieldId("email", "dialog-")).toBe("dialog-field-email");
  });
});

const schema = z.object({ email: z.email("Enter a valid email address.") });

function EmailForm({ withDescription = true }: { withDescription?: boolean }) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });
  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(() => undefined)(event)}>
      <FormField
        control={form.control}
        name="email"
        label="Email address"
        required
        description={withDescription ? "Used for updates." : undefined}
      >
        {(field) => <Input type="email" {...field} />}
      </FormField>
      <button type="submit">Submit</button>
    </form>
  );
}

describe("FormField (React Hook Form)", () => {
  it("wires label, description and control before any error", () => {
    render(<EmailForm />);
    const input = screen.getByLabelText(/Email address/);
    expect(input).toHaveAttribute("id", "field-email");
    expect(input).toHaveAttribute("name", "email");
    expect(input).toHaveAttribute("aria-describedby", "field-email-description");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("shows the validation message beside the field and sets aria-invalid and aria-describedby", async () => {
    render(<EmailForm />);
    await userEvent.type(screen.getByLabelText(/Email address/), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    const input = screen.getByLabelText(/Email address/);
    expect(await screen.findByText("Enter a valid email address.")).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "field-email-description field-email-error");
    // What the person typed is kept.
    expect(input).toHaveValue("not-an-email");
  });

  it("clears the error once the value is valid", async () => {
    render(<EmailForm />);
    const input = screen.getByLabelText(/Email address/);
    await userEvent.type(input, "bad");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("Enter a valid email address.");

    await userEvent.clear(input);
    await userEvent.type(input, "morgan@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});

describe("FormFieldGroup", () => {
  const groupSchema = z.object({ window: z.string().min(1, "Choose a time window.") });

  function WindowForm() {
    const form = useForm<z.infer<typeof groupSchema>>({
      resolver: zodResolver(groupSchema),
      defaultValues: { window: "" },
    });
    return (
      <form noValidate onSubmit={(event) => void form.handleSubmit(() => undefined)(event)}>
        <FormFieldGroup control={form.control} name="window" legend="Preferred time" required>
          {({ value, onChange, ...field }) => (
            <RadioGroup value={value} onValueChange={onChange} {...field}>
              <RadioGroupItem value="MORNING" aria-label="Morning" />
            </RadioGroup>
          )}
        </FormFieldGroup>
        <button type="submit">Submit</button>
      </form>
    );
  }

  it("flags the group invalid and describes it by the error after a failed submit", async () => {
    render(<WindowForm />);
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("Choose a time window.")).toBeVisible();
    expect(screen.getByRole("group", { name: /Preferred time/ })).toHaveAttribute(
      "aria-describedby",
      "field-window-error",
    );
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-invalid", "true");
  });
});
