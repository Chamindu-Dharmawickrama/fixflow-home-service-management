import type { AdminTechnicianDto } from "@fixflow/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { TechnicianActions } from "./technician-actions";

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const ACTIVE: AdminTechnicianDto = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  name: "Jordan Lee",
  phone: null,
  email: null,
  specialties: [],
  notes: null,
  calendarColor: "blue",
  isActive: true,
  upcomingJobCount: 3,
  nextJob: null,
  availableActions: ["EDIT", "DEACTIVATE"],
  createdAt: "2026-10-28T12:00:00.000Z",
  updatedAt: "2026-10-28T12:00:00.000Z",
  upcomingAssignments: [],
  availability: [],
};
const INACTIVE: AdminTechnicianDto = {
  ...ACTIVE,
  isActive: false,
  upcomingJobCount: 0,
  availableActions: ["EDIT", "ACTIVATE"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("which actions are offered", () => {
  it("offers Edit and Deactivate for an active technician, and not Reactivate", () => {
    render(<TechnicianActions technician={ACTIVE} />);

    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Reactivate" })).not.toBeInTheDocument();
  });

  it("offers Edit and Reactivate for an inactive technician, and not Deactivate", () => {
    render(<TechnicianActions technician={INACTIVE} />);

    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
  });

  it("offers only what the server lists", () => {
    render(<TechnicianActions technician={{ ...ACTIVE, availableActions: [] }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("deactivating", () => {
  async function openDialog() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    return {
      user,
      dialog: await screen.findByRole("alertdialog", { name: "Deactivate Jordan Lee?" }),
    };
  }

  it("asks first, and says what happens to their jobs and to new assignments", async () => {
    render(<TechnicianActions technician={ACTIVE} />);

    const { dialog } = await openDialog();

    expect(
      within(dialog).getByText(
        "Jordan Lee has 3 upcoming jobs. They stay assigned; you can reassign them from each job. Jordan won't be available for new assignments.",
      ),
    ).toBeVisible();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when the admin backs out", async () => {
    render(<TechnicianActions technician={ACTIVE} />);

    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("deactivates, reports the jobs that stayed from the server's own count, and refreshes the page", async () => {
    apiFetchMock.mockResolvedValue({ ...ACTIVE, isActive: false, upcomingJobCount: 2 });
    render(<TechnicianActions technician={ACTIVE} />);

    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/technicians/${ACTIVE.id}/deactivate`, {
      method: "POST",
    });
    expect(toastSuccess).toHaveBeenCalledWith("“Jordan Lee” is now inactive", {
      description: "2 upcoming jobs stay assigned. Reassign them from each job when you are ready.",
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the dialog open with the reason when it fails, and announces nothing", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    render(<TechnicianActions technician={ACTIVE} />);

    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reloads the page when the technician has gone", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 404, code: "NOT_FOUND", message: "That technician was not found." }),
    );
    render(<TechnicianActions technician={ACTIVE} />);

    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "That technician was not found.",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says there is nothing to reassign when no jobs are coming up", async () => {
    render(<TechnicianActions technician={{ ...ACTIVE, upcomingJobCount: 0 }} />);

    const { dialog } = await openDialog();

    expect(
      within(dialog).getByText(
        "Jordan Lee has no upcoming jobs. Jordan won't be available for new assignments.",
      ),
    ).toBeVisible();
  });
});

describe("reactivating", () => {
  it("reactivates at once, says so and refreshes the page", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValue({ ...INACTIVE, isActive: true });
    render(<TechnicianActions technician={INACTIVE} />);

    await user.click(screen.getByRole("button", { name: "Reactivate" }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/technicians/${INACTIVE.id}/activate`, {
      method: "POST",
    });
    expect(toastSuccess).toHaveBeenCalledWith("“Jordan Lee” is active again", {
      description: "They can be given new jobs.",
    });
  });

  it("shows it is working and sends one request however often it is pressed", async () => {
    const user = userEvent.setup();
    let finish: (value: AdminTechnicianDto) => void = () => undefined;
    apiFetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<TechnicianActions technician={INACTIVE} />);

    await user.click(screen.getByRole("button", { name: "Reactivate" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reactivate" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
    });
    await user.click(screen.getByRole("button", { name: "Reactivate" }));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    finish({ ...INACTIVE, isActive: true });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("says why when it could not, and does not claim success", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    render(<TechnicianActions technician={INACTIVE} />);

    await user.click(screen.getByRole("button", { name: "Reactivate" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("We couldn't reactivate this technician", {
        description: "Something went wrong.",
      });
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeEnabled();
  });
});
