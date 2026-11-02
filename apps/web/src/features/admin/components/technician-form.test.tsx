import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

import {
  emptyTechnicianValues,
  type TechnicianFormValues,
  technicianToFormValues,
} from "../lib/technician-form";
import { TechnicianForm } from "./technician-form";

const onSubmit = vi.fn<(body: unknown) => Promise<void>>();
const onCancel = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  onSubmit.mockResolvedValue(undefined);
});

function renderForm(
  props: Partial<React.ComponentProps<typeof TechnicianForm>> & {
    initialValues?: TechnicianFormValues;
  } = {},
) {
  return render(
    <TechnicianForm
      label="Add technician"
      initialValues={emptyTechnicianValues("blue")}
      onSubmit={onSubmit}
      onCancel={onCancel}
      submitLabel="Add technician"
      {...props}
    />,
  );
}

const field = (name: RegExp | string) => screen.getByLabelText(name);
const save = () => screen.getByRole("button", { name: "Add technician" });

describe("what the form shows", () => {
  it("has a labelled box for each detail, and says which are optional and who sees the notes", () => {
    renderForm();

    expect(screen.getByRole("form", { name: "Add technician" })).toBeInTheDocument();
    expect(field(/^Name/)).toBeRequired();
    expect(field("Phone number")).toBeInTheDocument();
    expect(field("Email address")).toBeInTheDocument();
    expect(field("Add a specialty")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Calendar colour/ })).toBeInTheDocument();
    expect(field("Notes")).toBeInTheDocument();
    expect(
      screen.getByText("Only you and your team can see this. Customers never do."),
    ).toBeVisible();
    expect(screen.getByText(/They cannot sign in/)).toBeVisible();
  });

  it("offers every colour with its name, and starts on the one it was given", () => {
    renderForm({ initialValues: emptyTechnicianValues("purple") });

    const colours = within(screen.getByRole("group", { name: /Calendar colour/ })).getAllByRole(
      "radio",
    );
    expect(colours.map((radio) => radio.getAttribute("value"))).toEqual([
      "blue",
      "green",
      "amber",
      "purple",
      "rose",
      "teal",
      "orange",
      "slate",
    ]);
    expect(screen.getByRole("radio", { name: "Purple" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Blue" })).not.toBeChecked();
  });
});

describe("saving", () => {
  it("sends what was typed, tidied, once every field is valid", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(field(/^Name/), "  Jordan Lee ");
    await user.type(field("Phone number"), "(212) 555-0151");
    await user.type(field("Email address"), "Jordan.Lee@CoolBreeze.test");
    await user.click(screen.getByRole("radio", { name: "Teal" }));
    await user.click(save());

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      specialties: [],
      notes: null,
      calendarColor: "teal",
    });
  });

  it("tells what is wrong beside each field, in a summary, and sends nothing", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(field("Phone number"), "12345");
    await user.type(field("Email address"), "jordan@");
    await user.click(save());

    expect(await screen.findByText("Enter the name.", { selector: "span" })).toBeVisible();
    expect(
      screen.getByText(/Enter a phone number with 7 to 15 digits/, { selector: "span" }),
    ).toBeVisible();
    expect(
      screen.getByText("Enter a valid email address, like name@example.com.", { selector: "span" }),
    ).toBeVisible();
    expect(field(/^Name/)).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
    // What was typed is still there.
    expect(field("Phone number")).toHaveValue("12345");
  });

  it("blocks a second click while the first save is on its way", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    onSubmit.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    renderForm({ initialValues: { ...emptyTechnicianValues("blue"), name: "Jordan Lee" } });

    await user.click(save());
    await waitFor(() => {
      expect(save()).toHaveAttribute("aria-busy", "true");
    });
    await user.click(save());
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(field(/^Name/)).toBeDisabled();

    finish();
    await waitFor(() => {
      expect(field(/^Name/)).toBeEnabled();
    });
  });

  it("keeps Save unavailable when editing until something has changed", async () => {
    const user = userEvent.setup();
    renderForm({
      label: "Edit Jordan Lee",
      submitLabel: "Save changes",
      requireChange: true,
      initialValues: { ...emptyTechnicianValues("blue"), name: "Jordan Lee" },
    });
    const saveChanges = screen.getByRole("button", { name: "Save changes" });

    expect(saveChanges).toBeDisabled();
    await user.type(field("Phone number"), "2125550151");
    expect(saveChanges).toBeEnabled();
  });

  it("closes through Cancel without saving", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(field(/^Name/), "Jordan");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("when the server says no", () => {
  const filled = { ...emptyTechnicianValues("blue"), name: "Jordan Lee" };

  it("puts the server's message beside the field it names and keeps everything typed", async () => {
    const user = userEvent.setup();
    onSubmit.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Check the highlighted fields.",
        fieldErrors: { name: "The name must be at least 2 characters." },
      }),
    );
    renderForm({ initialValues: filled });

    await user.type(field("Phone number"), "(212) 555-0151");
    await user.click(save());

    expect(
      await screen.findByText("The name must be at least 2 characters.", { selector: "span" }),
    ).toBeVisible();
    expect(field("Phone number")).toHaveValue("(212) 555-0151");
    expect(field(/^Name/)).toHaveValue("Jordan Lee");
    expect(save()).toBeEnabled();
  });

  it("shows an error about one tag on the specialties", async () => {
    const user = userEvent.setup();
    onSubmit.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Check the highlighted fields.",
        fieldErrors: { "specialties.1": "The specialty must be 40 characters or fewer." },
      }),
    );
    renderForm({ initialValues: filled });

    await user.click(save());

    const group = screen.getByRole("group", { name: "Specialties" });
    expect(
      await within(group).findByText("The specialty must be 40 characters or fewer."),
    ).toBeVisible();
  });

  it("shows a failure that is not about a field above the form", async () => {
    const user = userEvent.setup();
    onSubmit.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    renderForm({ initialValues: filled });

    await user.click(save());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong.");
    expect(field(/^Name/)).toHaveValue("Jordan Lee");
  });
});

describe("specialties", () => {
  it("adds a tag with Enter, without submitting the form, and empties the box", async () => {
    const user = userEvent.setup();
    renderForm({ initialValues: { ...emptyTechnicianValues("blue"), name: "Jordan Lee" } });

    await user.type(field("Add a specialty"), "Heat pumps{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Heat pumps")).toBeVisible();
    expect(field("Add a specialty")).toHaveValue("");
    expect(screen.getByText("1 of 8")).toBeVisible();
  });

  it("submits the form on Enter when nothing is waiting to be added", async () => {
    const user = userEvent.setup();
    renderForm({ initialValues: { ...emptyTechnicianValues("blue"), name: "Jordan Lee" } });

    await user.type(field("Add a specialty"), "{Enter}");

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it("adds a tag with a comma or the Add button, and several from a pasted list", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(field("Add a specialty"), "Dryers,");
    await user.type(field("Add a specialty"), "Diagnostics");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(field("Add a specialty"));
    await user.paste("Heat pumps, Air conditioning");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const tags = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(tags.map((tag) => tag.textContent)).toEqual([
      "Dryers",
      "Diagnostics",
      "Heat pumps",
      "Air conditioning",
    ]);
  });

  it("keeps Add unavailable until there is something to add", async () => {
    const user = userEvent.setup();
    renderForm();
    const add = screen.getByRole("button", { name: "Add" });

    expect(add).toBeDisabled();
    await user.type(field("Add a specialty"), "   ");
    expect(add).toBeDisabled();
    await user.type(field("Add a specialty"), "Dryers");
    expect(add).toBeEnabled();
  });

  it("does not add a tag twice, and says so in words", async () => {
    const user = userEvent.setup();
    renderForm({
      initialValues: { ...emptyTechnicianValues("blue"), specialties: ["Heat pumps"] },
    });

    await user.type(field("Add a specialty"), "heat PUMPS{Enter}");

    expect(await screen.findByText("“heat PUMPS” is already in the list.")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    // It stays in the box, to be changed.
    expect(field("Add a specialty")).toHaveValue("heat PUMPS");
  });

  it("removes a tag with the button named after it", async () => {
    const user = userEvent.setup();
    renderForm({
      initialValues: { ...emptyTechnicianValues("blue"), specialties: ["Heat pumps", "Dryers"] },
    });

    await user.click(screen.getByRole("button", { name: "Remove Heat pumps" }));

    expect(screen.queryByText("Heat pumps")).not.toBeInTheDocument();
    expect(screen.getByText("Dryers")).toBeVisible();
    expect(screen.getByText("1 of 8")).toBeVisible();
  });

  it("stops at eight and says why", async () => {
    const user = userEvent.setup();
    renderForm({
      initialValues: {
        ...emptyTechnicianValues("blue"),
        specialties: Array.from({ length: 8 }, (_, i) => `Tag ${String(i + 1)}`),
      },
    });

    expect(field("Add a specialty")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByText("8 of 8")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove Tag 8" }));
    expect(field("Add a specialty")).toBeEnabled();
  });

  it("takes a tag that was typed but not added along when saving, so it is not lost", async () => {
    const user = userEvent.setup();
    renderForm({
      initialValues: {
        ...emptyTechnicianValues("blue"),
        name: "Jordan Lee",
        specialties: ["Dryers"],
      },
    });

    await user.type(field("Add a specialty"), "Heat pumps");
    await user.click(save());

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ specialties: ["Dryers", "Heat pumps"] }),
    );
  });

  it("does not save when the waiting tag cannot be added, and says what is wrong beside the tags", async () => {
    const user = userEvent.setup();
    renderForm({
      initialValues: {
        ...emptyTechnicianValues("blue"),
        name: "Jordan Lee",
        specialties: ["Heat pumps"],
      },
    });

    await user.type(field("Add a specialty"), "heat pumps");
    await user.click(save());

    const group = screen.getByRole("group", { name: "Specialties" });
    expect(
      await within(group).findAllByText("“heat pumps” is already in the list."),
    ).not.toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("editing", () => {
  it("opens with the technician's details", () => {
    renderForm({
      label: "Edit Jordan Lee",
      initialValues: technicianToFormValues({
        name: "Jordan Lee",
        phone: "(212) 555-0151",
        email: "jordan.lee@coolbreeze.test",
        specialties: ["Heat pumps"],
        notes: "Senior technician.",
        calendarColor: "rose",
      } as never),
    });

    expect(field(/^Name/)).toHaveValue("Jordan Lee");
    expect(field("Phone number")).toHaveValue("(212) 555-0151");
    expect(field("Email address")).toHaveValue("jordan.lee@coolbreeze.test");
    expect(field("Notes")).toHaveValue("Senior technician.");
    expect(screen.getByText("Heat pumps")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Rose" })).toBeChecked();
  });
});
