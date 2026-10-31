import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, useWatch } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MAX_LINES, previewDocument } from "./line-items";
import { LineItemsEditor } from "./line-items-editor";

interface Values {
  lines: { description: string; quantity: string; unitPrice: string; taxable: boolean }[];
}

const schema = z.object({
  lines: z.array(
    z.object({
      description: z.string().min(1, "Describe the work."),
      quantity: z.string(),
      unitPrice: z.string(),
      taxable: z.boolean(),
    }),
  ),
});

const START: Values = {
  lines: [
    { description: "Diagnostic visit", quantity: "1", unitPrice: "79.00", taxable: false },
    { description: "Run capacitor", quantity: "1", unitPrice: "45.50", taxable: true },
  ],
};

/** The editor inside a small form that shows the shared calculation's total, as the real editor does. */
function Harness({ initial = START, apiError }: { initial?: Values; apiError?: string }) {
  const form = useForm<Values>({
    defaultValues: initial,
    resolver: zodResolver(schema),
    mode: "onTouched",
  });
  const watched = useWatch({ control: form.control });
  const preview = previewDocument({
    lines: (watched.lines ?? []).map((line) => ({
      description: line?.description ?? "",
      quantity: line?.quantity ?? "",
      unitPrice: line?.unitPrice ?? "",
      taxable: line?.taxable ?? true,
    })),
    discountAmount: "0",
    taxRate: "8",
  });
  return (
    <form
      onSubmit={(event) => {
        void form.handleSubmit(() => undefined)(event);
      }}
    >
      <LineItemsEditor control={form.control} currencyCode="USD" lineTotals={preview.lineTotals} />
      <p data-testid="total">{preview.totals?.totalAmount ?? "no total"}</p>
      <button type="submit">Submit</button>
      <button
        type="button"
        onClick={() => {
          form.setError("lines.1.quantity", { type: "server", message: apiError ?? "Too many." });
        }}
      >
        Fail from the server
      </button>
    </form>
  );
}

const row = (n: number) => screen.getByRole("group", { name: `Line ${n}` });

describe("LineItemsEditor: the rows", () => {
  it("shows one labelled row per line with its fields and its own total", () => {
    render(<Harness />);

    expect(screen.getAllByRole("group", { name: /^Line \d+$/ })).toHaveLength(2);
    const first = within(row(1));
    expect(first.getByLabelText("Description")).toHaveValue("Diagnostic visit");
    expect(first.getByLabelText("Quantity")).toHaveValue("1");
    expect(first.getByLabelText(/Unit price/)).toHaveValue("79.00");
    expect(first.getByRole("checkbox", { name: "Taxable" })).not.toBeChecked();
    expect(first.getByText("$79.00")).toBeVisible();
    expect(within(row(2)).getByRole("checkbox", { name: "Taxable" })).toBeChecked();
    expect(screen.getByText("2 of 50 lines")).toBeVisible();
  });

  it("recalculates the line and the total from the shared calculation as you type", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // 79.00 + 45.50 = 124.50, tax 8 % on the taxable 45.50 is 3.64.
    expect(screen.getByTestId("total")).toHaveTextContent("128.14");

    const quantity = within(row(1)).getByLabelText("Quantity");
    await user.clear(quantity);
    await user.type(quantity, "2");

    expect(within(row(1)).getByText("$158.00")).toBeVisible();
    expect(screen.getByTestId("total")).toHaveTextContent("207.14");
  });

  it("shows a dash for a line total until its numbers are usable, and no total for the document", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.clear(within(row(2)).getByLabelText(/Unit price/));
    await user.type(within(row(2)).getByLabelText(/Unit price/), "abc");

    expect(within(row(2)).getByLabelText("Line total not available yet")).toBeVisible();
    expect(within(row(1)).getByText("$79.00")).toBeVisible();
    expect(screen.getByTestId("total")).toHaveTextContent("no total");
  });

  it("toggles a line's taxable box and the total follows", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(within(row(1)).getByRole("checkbox", { name: "Taxable" }));

    // Both lines taxable now: 124.50 + 8 % (9.96) = 134.46.
    expect(screen.getByTestId("total")).toHaveTextContent("134.46");
  });
});

describe("LineItemsEditor: adding, removing and moving", () => {
  it("adds a line with one of something and a price still to enter, and focuses it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add line" }));

    expect(screen.getAllByRole("group", { name: /^Line \d+$/ })).toHaveLength(3);
    const added = within(row(3));
    expect(added.getByLabelText("Description")).toHaveValue("");
    expect(added.getByLabelText("Quantity")).toHaveValue("1");
    expect(added.getByLabelText(/Unit price/)).toHaveValue("");
    expect(added.getByRole("checkbox", { name: "Taxable" })).toBeChecked();
    await waitFor(() => expect(added.getByLabelText("Description")).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("Line 3 added.");
    expect(screen.getByText("3 of 50 lines")).toBeVisible();
  });

  it("stops adding at 50 lines", () => {
    const many = Array.from({ length: MAX_LINES }, (_, index) => ({
      description: `Line ${index + 1}`,
      quantity: "1",
      unitPrice: "1.00",
      taxable: true,
    }));
    render(<Harness initial={{ lines: many }} />);

    expect(screen.getByRole("button", { name: "Add line" })).toBeDisabled();
    expect(screen.getByText("50 of 50 lines")).toBeVisible();
  });

  it("removes the line it names, renumbers the rest, and keeps keyboard focus on the page", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Remove line 1" }));

    expect(screen.getAllByRole("group", { name: /^Line \d+$/ })).toHaveLength(1);
    expect(within(row(1)).getByLabelText("Description")).toHaveValue("Run capacitor");
    expect(screen.getByRole("button", { name: "Add line" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Line 1 removed.");
    expect(screen.getByTestId("total")).toHaveTextContent("49.14");
  });

  it("will not remove the only line", () => {
    render(<Harness initial={{ lines: [START.lines[0] as Values["lines"][number]] }} />);
    expect(screen.getByRole("button", { name: "Remove line 1" })).toBeDisabled();
  });

  it("moves a line up and down, and the buttons at the ends are off", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Move line 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move line 2 down" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Move line 2 up" }));

    expect(within(row(1)).getByLabelText("Description")).toHaveValue("Run capacitor");
    expect(within(row(2)).getByLabelText("Description")).toHaveValue("Diagnostic visit");
    expect(screen.getByRole("status")).toHaveTextContent("Line 2 moved up to position 1.");

    await user.click(screen.getByRole("button", { name: "Move line 1 down" }));
    expect(within(row(1)).getByLabelText("Description")).toHaveValue("Diagnostic visit");
  });

  it("can be driven entirely from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    screen.getByRole("button", { name: "Add line" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(within(row(3)).getByLabelText("Description")).toHaveFocus());
    await user.keyboard("Filter");
    await user.tab();
    expect(within(row(3)).getByLabelText("Quantity")).toHaveFocus();
    await user.tab();
    expect(within(row(3)).getByLabelText(/Unit price/)).toHaveFocus();
    await user.tab();
    expect(within(row(3)).getByRole("checkbox", { name: "Taxable" })).toHaveFocus();
    await user.keyboard(" ");
    expect(within(row(3)).getByRole("checkbox", { name: "Taxable" })).not.toBeChecked();
  });
});

describe("LineItemsEditor: errors beside the field", () => {
  it("shows a row's error beside the field that has it, and marks only that field invalid", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Fail from the server" }));

    const quantity = within(row(2)).getByLabelText("Quantity");
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    expect(quantity).toHaveAccessibleDescription("Too many.");
    expect(within(row(2)).getByText("Too many.")).toBeVisible();
    expect(within(row(1)).getByLabelText("Quantity")).not.toHaveAttribute("aria-invalid");
    expect(within(row(2)).getByLabelText(/Unit price/)).not.toHaveAttribute("aria-invalid");
  });

  it("shows a validation message on the row that is missing its description", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          lines: [
            { description: "", quantity: "1", unitPrice: "5.00", taxable: true },
            START.lines[1] as Values["lines"][number],
          ],
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await within(row(1)).findByText("Describe the work.")).toBeVisible();
    expect(within(row(1)).getByLabelText("Description")).toHaveAttribute("aria-invalid", "true");
    expect(within(row(2)).queryByText("Describe the work.")).not.toBeInTheDocument();
  });
});
