import { type AssignableTechnicianDto, ErrorCode } from "@fixflow/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { JOB_ID, TECHNICIAN_ID } from "../test-fixtures";
import { ScheduleDialog, type ScheduleDialogJob } from "./schedule-dialog";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const NEW_YORK = "America/New_York";
const SAM_ID = "7d2e1f0a-9b8c-4d7e-8f6a-5b4c3d2e1f00";
const RETIRED_ID = "8e3f2a1b-0c9d-4e8f-9a7b-6c5d4e3f2a11";

const JORDAN: AssignableTechnicianDto = {
  id: TECHNICIAN_ID,
  name: "Jordan Lee",
  specialties: ["Air conditioning"],
  calendarColor: "blue",
};
const SAM: AssignableTechnicianDto = {
  id: SAM_ID,
  name: "Sam Ortiz",
  specialties: [],
  calendarColor: "green",
};

/** A job that is booked 10:00 to 12:00 on 3 March (New York), the thing a new visit may clash with. */
const EXISTING = {
  id: "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f",
  reference: "JOB-2026-00031",
  status: "SCHEDULED",
  scheduledStart: "2026-03-03T15:00:00.000Z",
  scheduledEnd: "2026-03-03T17:00:00.000Z",
  serviceName: "AC Repair",
  customerName: "Alex Morgan",
};

const NEW_JOB: ScheduleDialogJob = {
  id: JOB_ID,
  reference: "JOB-2026-00007",
  status: "PENDING_SCHEDULING",
  scheduledStart: null,
  scheduledEnd: null,
  technicianId: null,
  customerName: "Amara Okafor",
};

const SCHEDULED_JOB: ScheduleDialogJob = {
  ...NEW_JOB,
  status: "SCHEDULED",
  scheduledStart: "2026-03-03T15:00:00.000Z",
  scheduledEnd: "2026-03-03T17:00:00.000Z",
  technicianId: TECHNICIAN_ID,
};

interface Server {
  technicians: () => AssignableTechnicianDto[] | Error;
  /** The jobs that overlap a window of the given length, whoever asks. */
  conflictsFor: (hours: number) => (typeof EXISTING)[];
  schedule: (body: unknown) => Promise<unknown>;
}

const calls = {
  conflictRoutes: [] as string[],
  assignable: 0,
  schedule: [] as unknown[],
};

function serve(overrides: Partial<Server> = {}) {
  const server: Server = {
    technicians: () => [JORDAN, SAM],
    conflictsFor: () => [],
    schedule: () => Promise.resolve({ id: JOB_ID, reference: "JOB-2026-00007" }),
    ...overrides,
  };
  apiFetchMock.mockImplementation((route: string, options?: { body?: unknown }) => {
    if (route === "/admin/technicians/assignable") {
      calls.assignable += 1;
      const result = server.technicians();
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    }
    if (route.startsWith("/admin/work-orders/conflicts?")) {
      calls.conflictRoutes.push(route);
      const params = new URL(route, "http://x").searchParams;
      const hours =
        (Date.parse(params.get("end") ?? "") - Date.parse(params.get("start") ?? "")) / 3_600_000;
      return Promise.resolve(server.conflictsFor(hours));
    }
    if (route.endsWith("/schedule")) {
      calls.schedule.push(options?.body);
      return server.schedule(options?.body);
    }
    return Promise.reject(new Error(`Unexpected request: ${route}`));
  });
}

/** The exact-time checks (a window of a few hours), not the whole-day look. */
const exactChecks = () =>
  calls.conflictRoutes.filter((route) => {
    const params = new URL(route, "http://x").searchParams;
    return (
      (Date.parse(params.get("end") ?? "") - Date.parse(params.get("start") ?? "")) / 3_600_000 < 20
    );
  });

interface Handlers {
  onOpenChange: Mock<(open: boolean) => void>;
  onScheduled: Mock<(job: unknown) => void>;
  onStale: Mock<() => void>;
}

function renderDialog(
  options: { job?: ScheduleDialogJob; rescheduling?: boolean; timeZone?: string } = {},
): Handlers {
  const handlers: Handlers = {
    onOpenChange: vi.fn<(open: boolean) => void>(),
    onScheduled: vi.fn<(job: unknown) => void>(),
    onStale: vi.fn<() => void>(),
  };
  render(
    <ScheduleDialog
      open
      job={options.job ?? NEW_JOB}
      rescheduling={options.rescheduling ?? false}
      timeZone={options.timeZone ?? NEW_YORK}
      {...handlers}
    />,
  );
  return handlers;
}

const dialog = () => screen.getByRole("dialog");
const date = () => within(dialog()).getByLabelText(/^Date/);
const startTime = () => within(dialog()).getByLabelText(/^Start time/);
const duration = () => within(dialog()).getByLabelText(/^How long/);
const technician = () => within(dialog()).getByLabelText(/^Technician/);
const reason = () => within(dialog()).getByLabelText(/^Reason for moving it/);
const save = (name: RegExp | string = /Schedule visit|Reschedule visit/) =>
  within(dialog()).getByRole("button", { name });

/** Fills the form the way a person would: date, time, then the technician once the list has loaded. */
async function fill(
  user: ReturnType<typeof userEvent.setup>,
  values: { date?: string; time?: string; technician?: string } = {},
) {
  await screen.findByRole("option", { name: "Jordan Lee" });
  fireEvent.change(date(), { target: { value: values.date ?? "2026-03-03" } });
  fireEvent.change(startTime(), { target: { value: values.time ?? "10:00" } });
  await user.selectOptions(technician(), values.technician ?? "Jordan Lee");
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.conflictRoutes = [];
  calls.assignable = 0;
  calls.schedule = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ScheduleDialog: what it shows", () => {
  it("names the job and the customer, and says whose clocks the times are on", async () => {
    serve();
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Schedule visit" })).toBeVisible();
    expect(within(dialog()).getByText(/JOB-2026-00007 for Amara Okafor/)).toBeVisible();
    expect(within(dialog()).getByText(/Times in/)).toHaveTextContent("Times in America/New_York");
    await screen.findByRole("option", { name: "Jordan Lee" });
  });

  it("adds the zone's short name once there is a date, so winter and summer are not confused", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await fill(user, { date: "2026-03-03" });
    expect(within(dialog()).getByText(/Times in/)).toHaveTextContent(
      "Times in America/New_York (EST)",
    );

    fireEvent.change(date(), { target: { value: "2026-07-14" } });
    expect(within(dialog()).getByText(/Times in/)).toHaveTextContent(
      "Times in America/New_York (EDT)",
    );
  });

  it("starts a new booking with no date, a 9:00 start and two hours", async () => {
    serve();
    renderDialog();
    await screen.findByRole("option", { name: "Jordan Lee" });

    expect(date()).toHaveValue("");
    expect(startTime()).toHaveValue("09:00");
    expect(duration()).toHaveValue("120");
    expect(technician()).toHaveValue("");
  });

  it("offers the active technicians the server lists, and a prompt before one is chosen", async () => {
    serve();
    renderDialog();

    await waitFor(() => expect(within(technician()).getAllByRole("option")).toHaveLength(3));
    const options = within(technician()).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Choose a technician",
      "Jordan Lee",
      "Sam Ortiz",
    ]);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/admin/technicians/assignable",
      expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
    );
  });

  it("says when the technicians cannot be loaded, offers another try, and recovers", async () => {
    let failing = true;
    serve({
      technicians: () => (failing ? new Error("down") : [JORDAN, SAM]),
    });
    const user = userEvent.setup();
    renderDialog();

    expect(await screen.findByText("We couldn't load the technicians.")).toBeVisible();
    expect(technician()).toBeDisabled();

    failing = false;
    await user.click(within(dialog()).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("option", { name: "Jordan Lee" })).toBeInTheDocument();
    expect(technician()).toBeEnabled();
  });

  it("says so when there is nobody to give the job to", async () => {
    serve({ technicians: () => [] });
    renderDialog();

    expect(await screen.findByText(/no active technicians to give this job to/)).toBeVisible();
  });

  it("says how long the visit is and when it ends, on the business's clocks", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await fill(user, { time: "10:00" });

    expect(within(dialog()).getByText("Ends at 12:00 PM.")).toBeVisible();
    await user.selectOptions(duration(), "5 hours");
    expect(within(dialog()).getByText("Ends at 3:00 PM.")).toBeVisible();
  });

  it("says the day it ends on when a visit runs past midnight", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await fill(user, { time: "22:00" });
    await user.selectOptions(duration(), "4 hours");

    expect(within(dialog()).getByText("Ends at 2:00 AM on Mar 4, 2026.")).toBeVisible();
  });

  it("offers half-hours up to 12 hours", async () => {
    serve();
    renderDialog();
    await screen.findByRole("option", { name: "Jordan Lee" });

    const labels = within(duration())
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels[0]).toBe("30 minutes");
    expect(labels).toContain("1 hour 30 minutes");
    expect(labels.at(-1)).toBe("12 hours");
    expect(labels).toHaveLength(24);
  });
});

describe("ScheduleDialog: the technician's day and the conflict pre-check", () => {
  it("lists the technician's other jobs that day", async () => {
    serve({ conflictsFor: (hours) => (hours > 20 ? [EXISTING] : []) });
    const user = userEvent.setup();
    renderDialog();
    await fill(user);

    const day = await screen.findByRole("region", { name: "Jordan Lee's other jobs that day" });
    expect(day).toHaveTextContent("Jordan Lee's other jobs on Mar 3, 2026");
    expect(day).toHaveTextContent("JOB-2026-00031, 10:00 AM – 12:00 PM");
    expect(day).toHaveTextContent("Alex Morgan");
  });

  it("says the technician is free all day when they have nothing", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await fill(user);

    expect(await screen.findByText("None. They are free all day.")).toBeVisible();
  });

  it("asks for the day with the job being scheduled left out", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await fill(user);
    await screen.findByText("None. They are free all day.");

    const params = new URL(calls.conflictRoutes[0] ?? "", "http://x").searchParams;
    expect(params.get("technicianId")).toBe(TECHNICIAN_ID);
    expect(params.get("excludeId")).toBe(JOB_ID);
    // Midnight to midnight on the business's calendar: 3 March, 05:00Z to 4 March, 05:00Z.
    expect(params.get("start")).toBe("2026-03-03T05:00:00.000Z");
    expect(params.get("end")).toBe("2026-03-04T05:00:00.000Z");
  });

  it("says a time clashes, with the job and its time, shortly after the last change", async () => {
    serve({ conflictsFor: () => [EXISTING] });
    const user = userEvent.setup();
    renderDialog();
    await fill(user, { time: "11:00" });

    const check = await screen.findByText(/Conflicts with JOB-2026-00031/);
    expect(check).toHaveTextContent(
      "Conflicts with JOB-2026-00031, 10:00 AM – 12:00 PM. Choose another time or technician.",
    );
  });

  it("says a time is free when nothing overlaps", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await fill(user);

    expect(await screen.findByText("Jordan Lee is free at that time.")).toBeVisible();
  });

  it("waits for a pause before it asks about an exact time, and asks once", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await fill(user, { time: "10:00" });
    await screen.findByText("Jordan Lee is free at that time.");
    const before = exactChecks().length;

    for (const time of ["10:30", "11:00", "11:30", "12:00"]) {
      fireEvent.change(startTime(), { target: { value: time } });
    }
    // Straight after the changes nothing new has been asked.
    expect(exactChecks()).toHaveLength(before);
    await waitFor(() => expect(exactChecks()).toHaveLength(before + 1));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(exactChecks()).toHaveLength(before + 1);
    const asked = new URL(exactChecks().at(-1) ?? "", "http://x").searchParams;
    expect(asked.get("start")).toBe("2026-03-03T17:00:00.000Z");
  });

  it("asks nothing about the exact time until the form names one", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole("option", { name: "Jordan Lee" });
    await user.selectOptions(technician(), "Jordan Lee");

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls.conflictRoutes).toEqual([]);
  });

  it("never shows an answer for an earlier choice as the answer to the current one", async () => {
    // The answer for 10:00 is slow and says "clashes"; the answer for 14:00 is quick and says "free".
    const resolvers: Array<() => void> = [];
    apiFetchMock.mockImplementation((route: string) => {
      if (route === "/admin/technicians/assignable") return Promise.resolve([JORDAN, SAM]);
      const params = new URL(route, "http://x").searchParams;
      const hours =
        (Date.parse(params.get("end") ?? "") - Date.parse(params.get("start") ?? "")) / 3_600_000;
      if (hours > 20) return Promise.resolve([]);
      if (params.get("start") === "2026-03-03T15:00:00.000Z") {
        return new Promise((resolve) => {
          resolvers.push(() => resolve([EXISTING]));
        });
      }
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    renderDialog();
    await fill(user, { time: "10:00" });
    await waitFor(() => expect(resolvers).toHaveLength(1));

    fireEvent.change(startTime(), { target: { value: "14:00" } });
    expect(await screen.findByText("Jordan Lee is free at that time.")).toBeVisible();
    act(() => {
      for (const release of resolvers) release();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/Conflicts with/)).not.toBeInTheDocument();
    expect(screen.getByText("Jordan Lee is free at that time.")).toBeVisible();
  });

  it("says when the check could not be made, and that saving is still allowed", async () => {
    apiFetchMock.mockImplementation((route: string) =>
      route === "/admin/technicians/assignable"
        ? Promise.resolve([JORDAN, SAM])
        : Promise.reject(new Error("offline")),
    );
    const user = userEvent.setup();
    renderDialog();
    await fill(user);

    expect(await screen.findByText(/couldn't check for conflicts just now/)).toBeVisible();
    expect(save()).toBeEnabled();
  });
});

describe("ScheduleDialog: saving", () => {
  it("sends the business's date and time as UTC instants, with the technician and the status it saw", async () => {
    serve();
    const user = userEvent.setup();
    const { onScheduled } = renderDialog();
    await fill(user, { date: "2026-03-03", time: "10:00" });

    await user.click(save());

    await waitFor(() => expect(onScheduled).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/work-orders/${JOB_ID}/schedule`, {
      method: "PATCH",
      body: {
        scheduledStart: "2026-03-03T15:00:00.000Z",
        scheduledEnd: "2026-03-03T17:00:00.000Z",
        technicianId: TECHNICIAN_ID,
        expectedStatus: "PENDING_SCHEDULING",
      },
    });
  });

  it.each(["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata"])(
    "sends the same instants whatever time zone this device is set to (%s)",
    async (zone) => {
      const original = process.env.TZ;
      process.env.TZ = zone;
      try {
        serve();
        const user = userEvent.setup();
        const { onScheduled } = renderDialog();
        await fill(user, { date: "2026-03-03", time: "10:00" });
        await user.click(save());
        await waitFor(() => expect(onScheduled).toHaveBeenCalled());

        expect(calls.schedule).toEqual([
          expect.objectContaining({
            scheduledStart: "2026-03-03T15:00:00.000Z",
            scheduledEnd: "2026-03-03T17:00:00.000Z",
          }),
        ]);
      } finally {
        if (original === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = original;
        }
      }
    },
  );

  it("follows daylight saving: 10:00 in July is an hour earlier in UTC", async () => {
    serve();
    const user = userEvent.setup();
    const { onScheduled } = renderDialog();
    await fill(user, { date: "2026-07-14", time: "10:00" });
    await user.click(save());
    await waitFor(() => expect(onScheduled).toHaveBeenCalled());

    expect(calls.schedule[0]).toMatchObject({ scheduledStart: "2026-07-14T14:00:00.000Z" });
  });

  it("hands the saved job to the page", async () => {
    const saved = { id: JOB_ID, reference: "JOB-2026-00007" };
    serve({ schedule: () => Promise.resolve(saved) });
    const user = userEvent.setup();
    const { onScheduled } = renderDialog();
    await fill(user);
    await user.click(save());

    await waitFor(() => expect(onScheduled).toHaveBeenCalledWith(saved));
  });

  it("asks for what is missing before sending anything, with a message beside each field", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole("option", { name: "Jordan Lee" });

    await user.click(save());

    expect(await within(dialog()).findByText("Choose the date of the visit.")).toBeVisible();
    expect(within(dialog()).getByText("Choose a technician.")).toBeVisible();
    expect(date()).toHaveAttribute("aria-invalid", "true");
    expect(technician()).toHaveAttribute("aria-invalid", "true");
    expect(date()).toHaveFocus();
    expect(calls.schedule).toEqual([]);
  });

  it("clears a field's message as soon as it is changed", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole("option", { name: "Jordan Lee" });
    await user.click(save());
    await within(dialog()).findByText("Choose the date of the visit.");

    fireEvent.change(date(), { target: { value: "2026-03-03" } });

    expect(within(dialog()).queryByText("Choose the date of the visit.")).not.toBeInTheDocument();
    expect(within(dialog()).getByText("Choose a technician.")).toBeVisible();
  });

  it("does not guess a time the clocks skip (8 March 2026, 02:30 in New York)", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog();
    await fill(user, { date: "2026-03-08", time: "02:30" });

    await user.click(save());

    expect(
      await within(dialog()).findByText(
        "02:30 does not exist on that day: the clocks go forward that night. Choose another time.",
      ),
    ).toBeVisible();
    expect(startTime()).toHaveFocus();
    expect(calls.schedule).toEqual([]);
  });

  it("sends once, blocks a second press while saving, and cannot be dismissed meanwhile", async () => {
    let release: (value: unknown) => void = () => undefined;
    serve({
      schedule: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const user = userEvent.setup();
    const { onOpenChange, onScheduled } = renderDialog();
    await fill(user);

    await user.click(save());
    await waitFor(() => expect(calls.schedule).toHaveLength(1));
    // A busy button keeps its name (so focus and the label do not jump) and says it is busy.
    const busy = save();
    expect(busy).toHaveAttribute("aria-busy", "true");

    await user.click(busy);
    fireEvent.submit(busy.closest("form") as HTMLFormElement);
    // Escape and a click outside both try to close it; neither gets through.
    await user.keyboard("{Escape}");
    const overlay = document.querySelector<HTMLElement>("div.fixed.inset-0");
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay as HTMLElement);
    fireEvent.click(overlay as HTMLElement);
    expect(calls.schedule).toHaveLength(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(date()).toBeDisabled();

    release({ id: JOB_ID, reference: "JOB-2026-00007" });
    await waitFor(() => expect(onScheduled).toHaveBeenCalledTimes(1));
  });
});

describe("ScheduleDialog: when the server says no", () => {
  const conflictError = () =>
    new ApiError({
      status: 409,
      code: ErrorCode.SCHEDULING_CONFLICT,
      message:
        "Jordan Lee is already booked for JOB-2026-00031 on Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST. Choose another time or technician.",
      details: {
        conflictJobId: EXISTING.id,
        conflictReference: "JOB-2026-00031",
        conflictStart: "2026-03-03T15:00:00.000Z",
        conflictEnd: "2026-03-03T17:00:00.000Z",
        conflictCount: 1,
      },
    });

  it("shows a conflict clearly, with the job it collided with, and keeps every input", async () => {
    serve({ schedule: () => Promise.reject(conflictError()) });
    const user = userEvent.setup();
    const { onScheduled } = renderDialog();
    await fill(user, { date: "2026-03-03", time: "11:00" });
    await user.selectOptions(duration(), "3 hours");

    await user.click(save());

    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent("Jordan Lee is already booked for JOB-2026-00031");
    // The sentence names the job and when it is, on the business's clocks.
    expect(alert).toHaveTextContent("on Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST");
    expect(alert).toHaveTextContent("Your entries are kept");
    // Everything is where the person left it, and they can try again.
    expect(date()).toHaveValue("2026-03-03");
    expect(startTime()).toHaveValue("11:00");
    expect(duration()).toHaveValue("180");
    expect(technician()).toHaveValue(TECHNICIAN_ID);
    expect(save()).toBeEnabled();
    expect(dialog()).toBeVisible();
    expect(onScheduled).not.toHaveBeenCalled();
  });

  it("goes away from the message once something is changed, and a new try goes through", async () => {
    let refuse = true;
    serve({
      schedule: () =>
        refuse
          ? Promise.reject(conflictError())
          : Promise.resolve({ id: JOB_ID, reference: "JOB-2026-00007" }),
    });
    const user = userEvent.setup();
    const { onScheduled } = renderDialog();
    await fill(user, { time: "11:00" });
    await user.click(save());
    await within(dialog()).findByRole("alert");

    refuse = false;
    fireEvent.change(startTime(), { target: { value: "13:00" } });
    expect(within(dialog()).queryByRole("alert")).not.toBeInTheDocument();
    await user.click(save());

    await waitFor(() => expect(onScheduled).toHaveBeenCalled());
  });

  it("puts the server's field messages beside their fields and moves focus to the first", async () => {
    serve({
      schedule: () =>
        Promise.reject(
          new ApiError({
            status: 422,
            code: ErrorCode.VALIDATION_ERROR,
            message: "The request contains invalid values.",
            fieldErrors: {
              scheduledStart: "The visit cannot start in the past.",
              scheduledEnd: "A visit can last at most 12 hours.",
            },
          }),
        ),
    });
    const user = userEvent.setup();
    renderDialog();
    await fill(user);

    await user.click(save());

    expect(await within(dialog()).findByText("The visit cannot start in the past.")).toBeVisible();
    expect(within(dialog()).getByText("A visit can last at most 12 hours.")).toBeVisible();
    expect(date()).toHaveAttribute("aria-invalid", "true");
    expect(duration()).toHaveAttribute("aria-invalid", "true");
    expect(date()).toHaveFocus();
  });

  it("refuses an inactive technician beside the field and asks for the list again", async () => {
    serve({
      schedule: () =>
        Promise.reject(
          new ApiError({
            status: 422,
            code: ErrorCode.TECHNICIAN_INACTIVE,
            message: "Jordan Lee is inactive.",
            fieldErrors: { technicianId: "Jordan Lee is inactive, so they cannot be given jobs." },
          }),
        ),
    });
    const user = userEvent.setup();
    renderDialog();
    await fill(user);
    const loadsBefore = calls.assignable;

    await user.click(save());

    expect(
      await within(dialog()).findByText("Jordan Lee is inactive, so they cannot be given jobs."),
    ).toBeVisible();
    await waitFor(() => expect(calls.assignable).toBeGreaterThan(loadsBefore));
  });

  it("says a job someone else changed has changed, and tells the page to reload", async () => {
    serve({
      schedule: () =>
        Promise.reject(
          new ApiError({
            status: 409,
            code: ErrorCode.STALE_STATE,
            message: "This job was updated by someone else.",
          }),
        ),
    });
    const user = userEvent.setup();
    const { onStale } = renderDialog();
    await fill(user);

    await user.click(save());

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "Someone else changed this job, so the page has been reloaded.",
    );
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(date()).toHaveValue("2026-03-03");
  });

  it("shows any other failure in words, and lets the person try again", async () => {
    serve({
      schedule: () =>
        Promise.reject(
          new ApiError({
            status: 0,
            code: "NETWORK_ERROR",
            message: "We couldn't reach the server. Check your connection and try again.",
          }),
        ),
    });
    const user = userEvent.setup();
    renderDialog();
    await fill(user);

    await user.click(save());

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server",
    );
    expect(save()).toBeEnabled();
  });
});

describe("ScheduleDialog: rescheduling", () => {
  it("starts from the appointment, on the business's clocks, and asks for a reason", async () => {
    serve();
    renderDialog({ job: SCHEDULED_JOB, rescheduling: true });

    expect(screen.getByRole("dialog", { name: "Reschedule visit" })).toBeVisible();
    expect(await screen.findByRole("option", { name: "Jordan Lee" })).toBeInTheDocument();
    expect(date()).toHaveValue("2026-03-03");
    expect(startTime()).toHaveValue("10:00");
    expect(duration()).toHaveValue("120");
    expect(technician()).toHaveValue(TECHNICIAN_ID);
    expect(reason()).toBeVisible();
    expect(within(dialog()).getByText(/not why/)).toBeVisible();
  });

  it("does not ask for a reason on a first booking", async () => {
    serve();
    renderDialog();
    await screen.findByRole("option", { name: "Jordan Lee" });
    expect(within(dialog()).queryByLabelText(/Reason for moving it/)).not.toBeInTheDocument();
  });

  it("will not send a move without a reason, and says so beside the reason", async () => {
    serve();
    const user = userEvent.setup();
    renderDialog({ job: SCHEDULED_JOB, rescheduling: true });
    await screen.findByRole("option", { name: "Jordan Lee" });
    fireEvent.change(startTime(), { target: { value: "14:00" } });

    await user.click(save());

    expect(
      await within(dialog()).findByText(/Enter a reason of 5 to 200 characters/),
    ).toBeVisible();
    expect(reason()).toHaveFocus();
    expect(calls.schedule).toEqual([]);
  });

  it("sends the trimmed reason and the status it saw (SCHEDULED)", async () => {
    serve();
    const user = userEvent.setup();
    const { onScheduled } = renderDialog({ job: SCHEDULED_JOB, rescheduling: true });
    await screen.findByRole("option", { name: "Jordan Lee" });
    fireEvent.change(startTime(), { target: { value: "14:00" } });
    fireEvent.change(reason(), { target: { value: "  The part arrives a day late.  " } });

    await user.click(save());

    await waitFor(() => expect(onScheduled).toHaveBeenCalled());
    expect(calls.schedule[0]).toEqual({
      scheduledStart: "2026-03-03T19:00:00.000Z",
      scheduledEnd: "2026-03-03T21:00:00.000Z",
      technicianId: TECHNICIAN_ID,
      expectedStatus: "SCHEDULED",
      reason: "The part arrives a day late.",
    });
  });

  it("keeps an odd length the job already has, so the form can show it", async () => {
    serve();
    renderDialog({
      job: { ...SCHEDULED_JOB, scheduledEnd: "2026-03-03T15:45:00.000Z" },
      rescheduling: true,
    });
    await screen.findByRole("option", { name: "Jordan Lee" });

    expect(duration()).toHaveValue("45");
    expect(within(duration()).getByRole("option", { name: "45 minutes" })).toBeInTheDocument();
  });

  it("asks for another technician when the job's own has since been deactivated", async () => {
    serve({ technicians: () => [SAM] });
    const user = userEvent.setup();
    renderDialog({
      job: { ...SCHEDULED_JOB, technicianId: RETIRED_ID },
      rescheduling: true,
    });
    await screen.findByRole("option", { name: "Sam Ortiz" });
    fireEvent.change(reason(), { target: { value: "Moving to a new technician." } });

    expect(technician()).toHaveValue("");
    await user.click(save());
    expect(await within(dialog()).findByText("Choose a technician.")).toBeVisible();
    expect(calls.schedule).toEqual([]);
  });
});

describe("ScheduleDialog: opening and closing", () => {
  it("closes from Cancel and puts focus back on the button that opened it", async () => {
    serve();
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      const button = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={button} onClick={() => setOpen(true)}>
            Schedule
          </button>
          <ScheduleDialog
            open={open}
            onOpenChange={setOpen}
            job={NEW_JOB}
            rescheduling={false}
            timeZone={NEW_YORK}
            returnFocusTo={button}
            onScheduled={vi.fn()}
            onStale={vi.fn()}
          />
        </>
      );
    }
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Schedule" }));
    expect(await screen.findByRole("dialog", { name: "Schedule visit" })).toBeVisible();
    await screen.findByRole("option", { name: "Jordan Lee" });

    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Schedule" })).toHaveFocus();
  });

  it("opens fresh every time: what was typed last time is gone", async () => {
    serve();
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>Again</button>
          <ScheduleDialog
            open={open}
            onOpenChange={setOpen}
            job={NEW_JOB}
            rescheduling={false}
            timeZone={NEW_YORK}
            onScheduled={vi.fn()}
            onStale={vi.fn()}
          />
        </>
      );
    }
    render(<Harness />);
    await screen.findByRole("option", { name: "Jordan Lee" });
    fireEvent.change(date(), { target: { value: "2026-03-05" } });
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Again" }));
    await screen.findByRole("option", { name: "Jordan Lee" });

    expect(date()).toHaveValue("");
  });
});
