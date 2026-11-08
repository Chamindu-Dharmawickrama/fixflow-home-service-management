import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, apiFetchEnvelope } from "@/lib/api";

import {
  adminJob,
  cancelledJob,
  completedJob,
  JOB_ID,
  needsReschedulingJob,
  startedJob,
  TECHNICIAN_ID,
  unscheduledJob,
} from "../test-fixtures";
import { JobActions } from "./job-actions";

const refresh = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastWarning = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace, push: vi.fn() }) }));
vi.mock("@/components/ui/sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: toastWarning },
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
  apiFetchEnvelope: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const envelopeMock = vi.mocked(apiFetchEnvelope);
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
  envelopeMock.mockResolvedValue({ data: {}, meta: { startedBeforeSchedule: false } });
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

  it("draws nothing for a job that is done or cancelled: the server allows nothing", () => {
    for (const job of [completedJob(), cancelledJob()]) {
      const { container, unmount } = render(
        <JobActions job={job} timeZone={TIME_ZONE} openSchedule={false} />,
      );
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
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

// ---- The lifecycle (T18) ---------------------------------------------------------------------------

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const queryButton = (name: string | RegExp) => screen.queryByRole("button", { name });

function renderJob(job = adminJob()) {
  const user = userEvent.setup();
  render(<JobActions job={job} timeZone={TIME_ZONE} openSchedule={false} />);
  return user;
}

async function chooseFromMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(button("More actions"));
  await user.click(await screen.findByRole("menuitem", { name }));
}

describe("JobActions: which controls the server's actions become (D-43)", () => {
  it("offers Start job, Reschedule and a menu for a scheduled job, and no Complete", async () => {
    const user = renderJob(adminJob());

    expect(button("Start job")).toBeEnabled();
    expect(button("Reschedule")).toBeEnabled();
    expect(queryButton("Complete job")).not.toBeInTheDocument();
    expect(queryButton("Cancel job")).not.toBeInTheDocument();

    await user.click(button("More actions"));
    expect(await screen.findByRole("menuitem", { name: "Needs rescheduling" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Cancel job" })).toBeVisible();
  });

  it("offers Complete job for a job under way, and no Start and no Cancel anywhere", async () => {
    const user = renderJob(startedJob());

    expect(button("Complete job")).toBeEnabled();
    expect(queryButton("Start job")).not.toBeInTheDocument();
    expect(queryButton("Reschedule")).not.toBeInTheDocument();

    await user.click(button("More actions"));
    expect(await screen.findByRole("menuitem", { name: "Needs rescheduling" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Cancel job" })).not.toBeInTheDocument();
  });

  it("offers Schedule and, in the menu, Cancel job for a job waiting for a time", async () => {
    const user = renderJob(unscheduledJob());
    expect(button("Schedule")).toBeEnabled();
    expect(queryButton("Start job")).not.toBeInTheDocument();
    await user.click(button("More actions"));
    expect(await screen.findByRole("menuitem", { name: "Cancel job" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Needs rescheduling" })).not.toBeInTheDocument();
  });

  it("offers Schedule again for a job that needs a new time", () => {
    renderJob(needsReschedulingJob());
    expect(button("Schedule")).toBeEnabled();
    expect(queryButton("Reschedule")).not.toBeInTheDocument();
  });

  it("offers only what the server lists: nothing is drawn for an action it does not", () => {
    renderJob(adminJob({ availableActions: ["START"] }));
    expect(button("Start job")).toBeEnabled();
    expect(queryButton("More actions")).not.toBeInTheDocument();
    expect(queryButton("Reschedule")).not.toBeInTheDocument();
  });
});

describe("JobActions: Start job", () => {
  it("asks first, and says what the customer will and will not be told", async () => {
    const user = renderJob(adminJob());
    expect(envelopeMock).not.toHaveBeenCalled();

    await user.click(button("Start job"));

    const dialog = await screen.findByRole("alertdialog", { name: "Start JOB-2026-00007?" });
    expect(dialog).toHaveTextContent("In progress");
    expect(dialog).toHaveTextContent("They are not sent a message");
    expect(envelopeMock).not.toHaveBeenCalled();
  });

  it("warns when the booked time is still to come", async () => {
    const user = renderJob(
      adminJob({
        scheduledStart: "2099-03-03T15:00:00.000Z",
        scheduledEnd: "2099-03-03T17:00:00.000Z",
      }),
    );
    await user.click(button("Start job"));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      /booked for .* which is later than now/,
    );
  });

  it("does not warn when the booked time has come", async () => {
    const user = renderJob(adminJob());
    await user.click(button("Start job"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByRole("note")).not.toBeInTheDocument();
  });

  it("sends the action with the status the page showed, then confirms and reloads", async () => {
    const user = renderJob(adminJob());
    await user.click(button("Start job"));
    const dialog = await screen.findByRole("alertdialog");
    expect(toastSuccess).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Start job" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(envelopeMock).toHaveBeenCalledWith(`/admin/work-orders/${JOB_ID}/transitions`, {
      method: "POST",
      body: { action: "START", expectedStatus: "SCHEDULED" },
    });
    expect(toastSuccess.mock.calls[0]?.[0]).toBe("JOB-2026-00007 is in progress");
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("says so when the server reports the job was started before its time", async () => {
    envelopeMock.mockResolvedValue({ data: {}, meta: { startedBeforeSchedule: true } });
    const user = renderJob(adminJob());
    await user.click(button("Start job"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Start job" }),
    );

    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(toastWarning.mock.calls[0]?.[0]).toBe(
      "JOB-2026-00007 was started before its booked time",
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and reloads the page when someone else has changed the job", async () => {
    envelopeMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "STALE_STATE",
        message: "Refresh to see the latest status.",
      }),
    );
    const user = renderJob(adminJob());
    await user.click(button("Start job"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Start job" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Someone else changed this job, so the page has been reloaded.",
    );
    expect(refresh).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });

  it("blocks a second press while the change is on its way", async () => {
    let finish: () => void = () => undefined;
    envelopeMock.mockImplementation(
      () =>
        new Promise((done) => {
          finish = () => done({ data: {}, meta: { startedBeforeSchedule: false } });
        }) as never,
    );
    const user = renderJob(adminJob());
    await user.click(button("Start job"));
    const dialog = await screen.findByRole("alertdialog");

    await user.click(within(dialog).getByRole("button", { name: "Start job" }));
    // A pending button stays focusable but is marked busy and ignores clicks (see Button).
    const pending = await within(dialog).findByRole("button", { name: /Start job/ });
    await waitFor(() => expect(pending).toHaveAttribute("aria-busy", "true"));
    await user.click(pending);
    await user.keyboard("{Escape}");

    expect(envelopeMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alertdialog")).toBeVisible();
    finish();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});

describe("JobActions: Complete job", () => {
  const SUMMARY = "Replaced the run capacitor and checked the cooling. All working.";

  async function openComplete() {
    const user = renderJob(startedJob());
    await user.click(button("Complete job"));
    const dialog = await screen.findByRole("alertdialog", { name: "Complete JOB-2026-00007?" });
    return { user, dialog };
  }

  it("labels the two notes by who reads them", async () => {
    const { dialog } = await openComplete();

    const summary = within(dialog).getByLabelText(/Completion summary for the customer/);
    const internal = within(dialog).getByLabelText(/Internal note \(optional\)/);
    expect(summary).toBeRequired();
    expect(internal).not.toBeRequired();
    expect(dialog).toHaveTextContent("The customer reads this on their job page.");
    expect(dialog).toHaveTextContent(
      "Only your team sees this. It is never shown to the customer.",
    );
    expect(dialog).toHaveTextContent("What was done, parts replaced, any advice");
  });

  it("will not confirm until the summary has at least 10 characters", async () => {
    const { user, dialog } = await openComplete();
    const confirm = within(dialog).getByRole("button", { name: "Complete job" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Completion summary/), "Done.");
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Completion summary/), " All fixed up.");
    expect(confirm).toBeEnabled();
    expect(envelopeMock).not.toHaveBeenCalled();
  });

  it("sends both notes, the customer's under completionNote and the team's under internalNote", async () => {
    const { user, dialog } = await openComplete();
    await user.type(within(dialog).getByLabelText(/Completion summary/), SUMMARY);
    await user.type(within(dialog).getByLabelText(/Internal note/), "Quote a surge protector.");
    await user.click(within(dialog).getByRole("button", { name: "Complete job" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(envelopeMock).toHaveBeenCalledWith(`/admin/work-orders/${JOB_ID}/transitions`, {
      method: "POST",
      body: {
        action: "COMPLETE",
        expectedStatus: "IN_PROGRESS",
        completionNote: SUMMARY,
        internalNote: "Quote a surge protector.",
      },
    });
    expect(toastSuccess.mock.calls[0]?.[0]).toBe("JOB-2026-00007 is complete");
  });

  it("leaves the internal note out when it is blank", async () => {
    const { user, dialog } = await openComplete();
    await user.type(within(dialog).getByLabelText(/Completion summary/), SUMMARY);
    await user.type(within(dialog).getByLabelText(/Internal note/), "   ");
    await user.click(within(dialog).getByRole("button", { name: "Complete job" }));

    await waitFor(() => expect(envelopeMock).toHaveBeenCalled());
    expect(envelopeMock.mock.calls[0]?.[1]?.body).toEqual({
      action: "COMPLETE",
      expectedStatus: "IN_PROGRESS",
      completionNote: SUMMARY,
    });
  });

  it("keeps what was typed when the server refuses, and says why", async () => {
    envelopeMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Enter a completion summary.",
      }),
    );
    const { user, dialog } = await openComplete();
    await user.type(within(dialog).getByLabelText(/Completion summary/), SUMMARY);
    await user.type(within(dialog).getByLabelText(/Internal note/), "Keep me.");
    await user.click(within(dialog).getByRole("button", { name: "Complete job" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a completion summary.");
    expect(within(dialog).getByLabelText(/Completion summary/)).toHaveValue(SUMMARY);
    expect(within(dialog).getByLabelText(/Internal note/)).toHaveValue("Keep me.");
    expect(within(dialog).getByRole("button", { name: "Complete job" })).toBeEnabled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("JobActions: Needs rescheduling and Cancel job", () => {
  const REASON = "The part is backordered until next week.";

  it("asks for an internal reason and an optional message to the customer, and sends both", async () => {
    const user = renderJob(adminJob());
    await chooseFromMenu(user, "Needs rescheduling");
    const dialog = await screen.findByRole("alertdialog", {
      name: "JOB-2026-00007 needs a new time?",
    });
    expect(dialog).toHaveTextContent("Your reason stays inside the business.");
    const confirm = within(dialog).getByRole("button", { name: "Mark as needing a new time" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason \(internal\)/), REASON);
    await user.type(within(dialog).getByLabelText(/Message to the customer/), "We will call you.");
    await user.click(confirm);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(envelopeMock).toHaveBeenCalledWith(`/admin/work-orders/${JOB_ID}/transitions`, {
      method: "POST",
      body: {
        action: "MARK_NEEDS_RESCHEDULING",
        expectedStatus: "SCHEDULED",
        reason: REASON,
        customerMessage: "We will call you.",
      },
    });
    expect(toastSuccess.mock.calls[0]?.[0]).toBe("JOB-2026-00007 needs a new time");
  });

  it("limits the reason for a new time to 200 characters, and a cancellation reason to 500", async () => {
    const user = renderJob(adminJob());
    await chooseFromMenu(user, "Needs rescheduling");
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByLabelText(/Reason \(internal\)/)).toHaveAttribute(
      "maxlength",
      "200",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    await chooseFromMenu(user, "Cancel job");
    dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByLabelText(/Reason \(internal\)/)).toHaveAttribute(
      "maxlength",
      "500",
    );
  });

  it("cancels with a reason, explains the consequence and styles the button as destructive", async () => {
    const user = renderJob(adminJob());
    await chooseFromMenu(user, "Cancel job");
    const dialog = await screen.findByRole("alertdialog", { name: "Cancel JOB-2026-00007?" });
    expect(dialog).toHaveTextContent("cannot be reopened");
    expect(dialog).toHaveTextContent("Any booked time is released");
    expect(dialog).toHaveTextContent("Your reason stays inside the business.");
    const confirm = within(dialog).getByRole("button", { name: "Cancel job" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason \(internal\)/), REASON);
    await user.click(confirm);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(envelopeMock.mock.calls[0]?.[1]?.body).toEqual({
      action: "CANCEL",
      expectedStatus: "SCHEDULED",
      reason: REASON,
    });
    expect(toastSuccess.mock.calls[0]?.[0]).toBe("JOB-2026-00007 was cancelled");
  });

  it("keeps the reason and the message when the server refuses, then lets the person try again", async () => {
    envelopeMock.mockRejectedValueOnce(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const user = renderJob(adminJob());
    await chooseFromMenu(user, "Cancel job");
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByLabelText(/Reason \(internal\)/), REASON);
    await user.type(within(dialog).getByLabelText(/Message to the customer/), "Sorry.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel job" }));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(within(dialog).getByLabelText(/Reason \(internal\)/)).toHaveValue(REASON);
    expect(within(dialog).getByLabelText(/Message to the customer/)).toHaveValue("Sorry.");

    await user.click(within(dialog).getByRole("button", { name: "Cancel job" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(envelopeMock).toHaveBeenCalledTimes(2);
  });

  it("closes without sending anything when the person keeps the job", async () => {
    const user = renderJob(adminJob());
    await chooseFromMenu(user, "Cancel job");
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Keep job" }),
    );

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(envelopeMock).not.toHaveBeenCalled();
    expect(button("More actions")).toHaveFocus();
  });
});

describe("JobActions: invoicing a completed job (T20)", () => {
  it("offers Create invoice as the one action of a completed job with no invoice", () => {
    render(
      <JobActions
        job={completedJob({ availableActions: ["CREATE_INVOICE"] })}
        timeZone={TIME_ZONE}
        openSchedule={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Create invoice for JOB-2026-00007" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /More actions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /invoice/i })).not.toBeInTheDocument();
  });

  it("links to the invoice instead once the job has one, and offers no second one", () => {
    render(
      <JobActions
        job={completedJob({
          invoice: {
            id: "c8d2e4f6-1a3b-4c5d-8e7f-9a0b1c2d3e4f",
            invoiceNumber: "INV-2026-00004",
            status: "ISSUED",
            statusLabel: "Issued",
          },
        })}
        timeZone={TIME_ZONE}
        openSchedule={false}
      />,
    );
    expect(screen.getByRole("link", { name: "View invoice INV-2026-00004" })).toHaveAttribute(
      "href",
      "/app/invoices/c8d2e4f6-1a3b-4c5d-8e7f-9a0b1c2d3e4f",
    );
    expect(screen.queryByRole("button", { name: /create invoice/i })).not.toBeInTheDocument();
  });

  it("links to a draft invoice as the draft", () => {
    render(
      <JobActions
        job={completedJob({
          invoice: {
            id: "c8d2e4f6-1a3b-4c5d-8e7f-9a0b1c2d3e4f",
            invoiceNumber: null,
            status: "DRAFT",
            statusLabel: "Draft",
          },
        })}
        timeZone={TIME_ZONE}
        openSchedule={false}
      />,
    );
    expect(screen.getByRole("link", { name: "View draft invoice" })).toBeVisible();
  });

  it("offers nothing invoice-related on a job that is not completed", () => {
    render(<JobActions job={startedJob()} timeZone={TIME_ZONE} openSchedule={false} />);
    expect(screen.queryByRole("button", { name: /invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /invoice/i })).not.toBeInTheDocument();
  });
});
