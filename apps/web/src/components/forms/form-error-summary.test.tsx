import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Input } from "@/components/ui/input";

import { FormErrorSummary } from "./form-error-summary";
import { applyApiFieldErrors, collectFormErrors } from "./form-errors";
import { FormField } from "./form-field";

describe("collectFormErrors", () => {
  it("flattens nested errors into ordered { name, message } items", () => {
    const items = collectFormErrors({
      fullName: { type: "too_small", message: "Enter your full name." },
      lines: [
        undefined,
        { quantity: { type: "too_small", message: "Must be greater than zero." } },
      ],
      root: { server: { type: "server", message: "We couldn't save this." } },
    } as never);

    expect(items).toEqual([
      { name: "fullName", message: "Enter your full name." },
      { name: "lines.1.quantity", message: "Must be greater than zero." },
      { name: "root.server", message: "We couldn't save this." },
    ]);
  });

  it("lists a parent's own message before its children", () => {
    const items = collectFormErrors({
      lines: Object.assign([{ quantity: { type: "x", message: "Child." } }], {
        message: "Add at least one line.",
        type: "min",
      }),
    });
    expect(items.map((item) => item.name)).toEqual(["lines", "lines.0.quantity"]);
  });

  it("ignores refs, empty messages and an empty tree", () => {
    expect(collectFormErrors({})).toEqual([]);
    expect(collectFormErrors({ a: { type: "x", message: "", ref: { name: "a" } } })).toEqual([]);
  });
});

describe("applyApiFieldErrors", () => {
  it("sets a message per field and puts form-level issues on root.server", () => {
    const calls: [string, unknown][] = [];
    const applied = applyApiFieldErrors(
      (name: string, error: unknown) => calls.push([name, error]),
      {
        email: "That email is already registered.",
        "lines.2.quantity": "Must be greater than zero.",
        _: "Something else is wrong.",
      },
    );

    expect(applied).toEqual(["email", "lines.2.quantity", "_"]);
    expect(calls).toEqual([
      ["email", { type: "server", message: "That email is already registered." }],
      ["lines.2.quantity", { type: "server", message: "Must be greater than zero." }],
      ["root.server", { type: "server", message: "Something else is wrong." }],
    ]);
  });

  it("does nothing without field errors", () => {
    expect(applyApiFieldErrors(() => undefined, undefined)).toEqual([]);
  });
});

const schema = z.object({
  fullName: z.string().min(2, "Enter your full name."),
  email: z.email("Enter a valid email address."),
});

function SummaryForm({ focusFirstField = false }: { focusFirstField?: boolean }) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "" },
    shouldFocusError: focusFirstField,
  });
  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(() => undefined)(event)}>
      <FormErrorSummary
        errors={form.formState.errors}
        labels={{ fullName: "Full name", email: "Email address" }}
        submitCount={form.formState.submitCount}
      />
      <FormField control={form.control} name="fullName" label="Full name">
        {(field) => <Input {...field} />}
      </FormField>
      <FormField control={form.control} name="email" label="Email address">
        {(field) => <Input type="email" {...field} />}
      </FormField>
      <button type="submit">Submit</button>
    </form>
  );
}

describe("FormErrorSummary", () => {
  it("renders nothing while the form is valid", () => {
    render(<SummaryForm />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lists every problem, takes focus when a submit fails, and links to the fields", async () => {
    render(<SummaryForm />);
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(summary).toHaveTextContent("There are 2 problems to fix");

    const nameLink = screen.getByRole("link", { name: "Full name: Enter your full name." });
    const emailLink = screen.getByRole("link", {
      name: "Email address: Enter a valid email address.",
    });
    expect(nameLink).toHaveAttribute("href", "#field-fullName");
    expect(emailLink).toHaveAttribute("href", "#field-email");

    await userEvent.click(emailLink);
    expect(screen.getByLabelText("Email address")).toHaveFocus();
  });

  it("keeps focus on the summary even when the form is left to focus the first invalid field", async () => {
    render(<SummaryForm focusFirstField />);
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(summary).toHaveFocus());
    // And it stays there: nothing moves focus on afterwards.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(summary).toHaveFocus();
  });

  it("uses the singular for one problem", async () => {
    render(<SummaryForm />);
    await userEvent.type(screen.getByLabelText("Full name"), "Morgan Reyes");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There is 1 problem to fix");
  });

  it("shows a form-level server message without a link", async () => {
    function ServerErrorForm() {
      const form = useForm<{ email: string }>({ defaultValues: { email: "" } });
      return (
        <>
          <button
            type="button"
            onClick={() =>
              applyApiFieldErrors(form.setError, { _: "We couldn't save this just now." })
            }
          >
            Fail
          </button>
          <FormErrorSummary errors={form.formState.errors} />
        </>
      );
    }
    render(<ServerErrorForm />);
    await userEvent.click(screen.getByRole("button", { name: "Fail" }));

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("We couldn't save this just now.");
    expect(summary.querySelector("a")).toBeNull();
  });
});
