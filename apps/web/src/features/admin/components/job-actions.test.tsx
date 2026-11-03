import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";

import { adminJob, JOB_ID, TECHNICIAN_ID, unscheduledJob } from "../test-fixtures";
import { JobActions } from "./job-actions";

const refresh = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace, push: vi.fn() }) }));
vi.mock("@/components/ui/sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const TIME_ZONE = "America/New_York";

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockImplementation((route: string) => {
    if (route === "/admin/technicians/assignable") {
      return Promise.resolve([
        { id: TECHNICIAN_ID, name: "Jordan Lee", specialties: [], calendarColor: "blue" },
      ]);
    }
    if (route.startsWith("/admin/work-orders/conflicts")) return Promise.resolve([]);
    return Promise.resolve({ id: JOB_ID, reference: "JOB-2026-00007" });
  });
});

describe("JobActions", () => {
  it("offers Schedule to a job with no appointment, and the dialog starts closed", () => {
    render(<JobActions job={unscheduledJob()} timeZone={TIME_ZONE} openSchedule={false} />);

    expect(screen.getByRole("button", { name: "Schedule" })).toBeEnabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers Reschedule to a job that has one", () => {
    render(<JobActions job={adminJob()} timeZone={TIME_ZONE} openSchedule={false} />);

    expect(screen.getByRole("button", { name: "Reschedule" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Schedule" })).not.toBeInTheDocument();
  });

  it("draws nothing for the actions a later task performs: no Start, Complete or Cancel button", () => {
    render(<JobActions job={adminJob()} timeZone={TIME_ZONE} openSchedule={false} />);

    for (const name of [/Start/, /Complete/, /Cancel/, /Needs/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("draws nothing when the server allows no scheduling (under way, done or cancelled)", () => {
    const { container } = render(
      <JobActions
        job={adminJob({ status: "IN_PROGRESS", availableActions: ["COMPLETE"] })}
        timeZone={TIME_ZONE}
        openSchedule={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the dialog on the button, and gives focus back to it on close", async () => {
    const user = userEvent.setup();
    render(<JobActions job={unscheduledJob()} timeZone={TIME_ZONE} openSchedule={false} />);

    await user.click(screen.getByRole("button", { name: "Schedule" }));
    const dialog = await screen.findByRole("dialog", { name: "Schedule visit" });
    await screen.findByRole("option", { name: "Jordan Lee" });
    await user.click(dialog.querySelector('button[type="button"]') as HTMLButtonElement);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Schedule" })).toHaveFocus();
  });

  it("opens the dialog at once when the address asked for it, and cleans the address on close", async () => {
    const user = userEvent.setup();
    render(<JobActions job={unscheduledJob()} timeZone={TIME_ZONE} openSchedule />);

    expect(await screen.findByRole("dialog", { name: "Schedule visit" })).toBeVisible();
    await screen.findByRole("option", { name: "Jordan Lee" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(replace).toHaveBeenCalledWith(`/app/jobs/${JOB_ID}`, { scroll: false });
    expect(screen.getByRole("button", { name: "Schedule" })).toHaveFocus();
  });

  it("does not touch the address when it was not the address that opened the dialog", async () => {
    const user = userEvent.setup();
    render(<JobActions job={unscheduledJob()} timeZone={TIME_ZONE} openSchedule={false} />);
    await user.click(screen.getByRole("button", { name: "Schedule" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not open the dialog from the address when the job cannot be scheduled", () => {
    render(
      <JobActions
        job={adminJob({ status: "COMPLETED", availableActions: [] })}
        timeZone={TIME_ZONE}
        openSchedule
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms a booking only after the server has accepted it, then reloads the page", async () => {
    const user = userEvent.setup();
    render(<JobActions job={unscheduledJob()} timeZone={TIME_ZONE} openSchedule />);
    await screen.findByRole("option", { name: "Jordan Lee" });

    await user.type(screen.getByLabelText(/^Date/), "2026-03-03");
    await user.selectOptions(screen.getByLabelText(/^Technician/), "Jordan Lee");
    expect(toastSuccess).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Schedule visit" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0]?.[0]).toBe("JOB-2026-00007 is scheduled");
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
