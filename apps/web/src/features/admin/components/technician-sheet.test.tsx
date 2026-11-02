import type { AdminTechnicianDto } from "@fixflow/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { TechnicianSheet } from "./technician-sheet";

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const JORDAN: AdminTechnicianDto = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  name: "Jordan Lee",
  phone: "(212) 555-0151",
  email: "jordan.lee@coolbreeze.test",
  specialties: ["Air conditioning", "Heat pumps"],
  notes: "Senior technician.",
  calendarColor: "blue",
  isActive: true,
  upcomingJobCount: 0,
  nextJob: null,
  availableActions: ["EDIT", "DEACTIVATE"],
  createdAt: "2026-10-28T12:00:00.000Z",
  updatedAt: "2026-10-28T12:00:00.000Z",
  upcomingAssignments: [],
  availability: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

const field = (name: RegExp | string) => screen.getByLabelText(name);

describe("TechnicianSheet: adding", () => {
  function renderCreate() {
    return render(
      <TechnicianSheet
        mode="create"
        suggestedColor="purple"
        trigger={<button type="button">Add technician</button>}
      />,
    );
  }

  it("opens from its button as a dialog named Add technician, on the colour it suggests", async () => {
    const user = userEvent.setup();
    renderCreate();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add technician" }));

    const dialog = await screen.findByRole("dialog", { name: "Add technician" });
    expect(within(dialog).getByText(/They don't sign in/)).toBeVisible();
    expect(within(dialog).getByRole("radio", { name: "Purple" })).toBeChecked();
    expect(within(dialog).getByRole("form", { name: "Add technician" })).toBeInTheDocument();
  });

  it("creates the technician, says so, and goes to their page", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValue({ ...JORDAN, id: "new-id" });
    renderCreate();

    await user.click(screen.getByRole("button", { name: "Add technician" }));
    await user.type(await screen.findByLabelText(/^Name/), "Jordan Lee");
    await user.click(
      within(screen.getByRole("form", { name: "Add technician" })).getByRole("button", {
        name: "Add technician",
      }),
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/app/technicians/new-id");
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/admin/technicians", {
      method: "POST",
      body: {
        name: "Jordan Lee",
        phone: null,
        email: null,
        specialties: [],
        notes: null,
        calendarColor: "purple",
      },
    });
    expect(toastSuccess).toHaveBeenCalledWith("“Jordan Lee” was added", expect.anything());
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("stays open with everything typed when the server refuses, and announces nothing", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Check the highlighted fields.",
        fieldErrors: { email: "Enter a valid email address, like name@example.com." },
      }),
    );
    renderCreate();

    await user.click(screen.getByRole("button", { name: "Add technician" }));
    await user.type(await screen.findByLabelText(/^Name/), "Jordan Lee");
    await user.click(
      within(screen.getByRole("form", { name: "Add technician" })).getByRole("button", {
        name: "Add technician",
      }),
    );

    expect(
      await screen.findByText("Enter a valid email address, like name@example.com.", {
        selector: "span",
      }),
    ).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Add technician" })).toBeVisible();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Jordan Lee");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("closes without saving through Cancel", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.click(screen.getByRole("button", { name: "Add technician" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe("TechnicianSheet: editing", () => {
  function renderEdit(technician: AdminTechnicianDto = JORDAN) {
    return render(
      <TechnicianSheet
        mode="edit"
        technician={technician}
        trigger={<button type="button">Edit</button>}
      />,
    );
  }

  it("opens with the technician's details, named after them", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit Jordan Lee" });
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Jordan Lee");
    expect(within(dialog).getByLabelText("Notes")).toHaveValue("Senior technician.");
    expect(within(dialog).getByText("Heat pumps")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("sends only the fields that changed, then refreshes the page and says it was saved", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValue({ ...JORDAN, specialties: ["Air conditioning"] });
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("button", { name: "Remove Heat pumps" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/technicians/${JORDAN.id}`, {
      method: "PATCH",
      body: { specialties: ["Air conditioning"] },
    });
    expect(toastSuccess).toHaveBeenCalledWith("Changes saved", expect.anything());
    expect(push).not.toHaveBeenCalled();
  });

  it("closes without a request when only spacing differs", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(await screen.findByLabelText(/^Name/), "  ");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("reloads the page when the technician has gone, and keeps the sheet open with the reason", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 404, code: "NOT_FOUND", message: "That technician was not found." }),
    );
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(await screen.findByLabelText(/^Name/), " Q.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That technician was not found.");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("starts from the saved details each time it opens", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(await screen.findByLabelText(/^Name/), " Junior");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(await screen.findByLabelText(/^Name/)).toHaveValue("Jordan Lee");
  });
});

describe("the sheet fits a phone", () => {
  it("is the full width of a narrow screen up to a comfortable maximum, and scrolls", async () => {
    const user = userEvent.setup();
    render(
      <TechnicianSheet
        mode="create"
        suggestedColor="blue"
        trigger={<button type="button">Add technician</button>}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add technician" }));
    const dialog = await screen.findByRole("dialog", { name: "Add technician" });

    expect(dialog).toHaveClass("w-full", "max-w-md", "overflow-y-auto");
    expect(field(/^Name/)).toBeVisible();
  });
});
