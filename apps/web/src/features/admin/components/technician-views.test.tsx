import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { adminTechnician, JOB_ID, TECHNICIAN_ID, technicianListItem } from "../test-fixtures";
import {
  AvailabilityCard,
  TechnicianDetailsCard,
  UpcomingAssignmentsCard,
} from "./technician-detail-cards";
import { TechniciansTable } from "./technicians-table";

const TZ = "America/New_York";
const SECOND_JOB_ID = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f";

function renderTable(technicians = [technicianListItem()]) {
  return render(
    <TechniciansTable
      technicians={technicians}
      timeZone={TZ}
      sort={{ field: "name", order: "asc" }}
      getSortHref={() => "/app/technicians?order=desc"}
    />,
  );
}

const rowOf = (index = 1) =>
  within(screen.getByRole("table", { name: "Technicians" })).getAllByRole("row")[
    index
  ] as HTMLElement;

describe("TechniciansTable", () => {
  it("has the columns the prompt asks for: name, specialties, contact, status, upcoming jobs, next job", () => {
    renderTable();

    expect(
      within(screen.getByRole("table", { name: "Technicians" }))
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Technician", "Specialties", "Contact", "Status", "Upcoming jobs", "Next job"]);
  });

  it("opens the technician from the name, and sorts from the header", () => {
    renderTable();

    expect(within(rowOf()).getByRole("link", { name: "Jordan Lee" })).toHaveAttribute(
      "href",
      `/app/technicians/${TECHNICIAN_ID}`,
    );
    expect(
      within(screen.getByRole("table", { name: "Technicians" })).getByRole("link", {
        name: /Technician/,
      }),
    ).toHaveAttribute("href", "/app/technicians?order=desc");
  });

  it("shows the specialties as a list, the contact details named for a screen reader and the state in words", () => {
    renderTable();

    const row = within(rowOf());
    const specialties = within(row.getByRole("list", { name: "Specialties" }));
    expect(specialties.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Air conditioning",
      "Heat pumps",
    ]);
    expect(row.getByText("jordan.lee@coolbreeze.test")).toBeVisible();
    expect(row.getByText("(212) 555-0151")).toBeVisible();
    expect(row.getByText("Email:")).toBeInTheDocument();
    expect(row.getByText("Phone:")).toBeInTheDocument();
    expect(row.getByText("Active")).toBeVisible();
  });

  it("shows Inactive as text, not only a colour", () => {
    renderTable([technicianListItem({ isActive: false, availableActions: ["EDIT", "ACTIVATE"] })]);
    expect(within(rowOf()).getByText("Inactive")).toBeVisible();
  });

  it("says so when there is nothing to show, rather than leaving a gap", () => {
    renderTable([technicianListItem({ specialties: [], phone: null, email: null })]);

    const row = within(rowOf());
    expect(row.getByText("None added")).toBeVisible();
    expect(row.getByText("No contact details")).toBeVisible();
    expect(row.getByText("None scheduled")).toBeVisible();
    expect(row.queryByText("Email:")).not.toBeInTheDocument();
  });

  it("shows only the details that exist, one of the two contact lines", () => {
    renderTable([technicianListItem({ phone: null })]);
    const row = within(rowOf());
    expect(row.getByText("Email:")).toBeInTheDocument();
    expect(row.queryByText("Phone:")).not.toBeInTheDocument();
  });

  it("shows the count of upcoming jobs and the next job in the business's time zone, with its reference", () => {
    renderTable([
      technicianListItem({
        upcomingJobCount: 3,
        // 14:00Z on 3 Mar is 9:00 AM in New York (EST).
        nextJob: {
          id: JOB_ID,
          reference: "JOB-2026-00007",
          scheduledStart: "2026-03-03T14:00:00.000Z",
        },
      }),
    ]);

    const row = within(rowOf());
    expect(row.getByText("3")).toBeVisible();
    expect(row.getByText("Mar 3, 2026, 9:00 AM")).toBeVisible();
    expect(row.getByText("JOB-2026-00007")).toBeVisible();
  });

  it("links the next job to its page, above the row's own link to the technician (T17)", () => {
    renderTable([
      technicianListItem({
        upcomingJobCount: 1,
        nextJob: {
          id: JOB_ID,
          reference: "JOB-2026-00007",
          scheduledStart: "2026-03-03T14:00:00.000Z",
        },
      }),
    ]);

    const link = within(rowOf()).getByRole("link", { name: "JOB-2026-00007" });
    expect(link).toHaveAttribute("href", `/app/jobs/${JOB_ID}`);
    // The row is one big link to the technician; the job's link has to sit above it to be clickable.
    expect(link).toHaveClass("relative", "z-10");
  });

  it("never shows the internal notes (the list does not carry them)", () => {
    renderTable();
    expect(screen.queryByText(/Senior technician/)).not.toBeInTheDocument();
  });

  it("wraps a long unbroken name instead of overflowing", () => {
    renderTable([technicianListItem({ name: "W".repeat(100) })]);
    const name = within(rowOf()).getByRole("link", { name: "W".repeat(100) });
    // It may shrink to the cell and break anywhere: `break-words` alone keeps the whole word.
    expect(name.querySelector("[class*='overflow-wrap:anywhere']")).not.toBeNull();
  });
});

describe("AvailabilityCard", () => {
  const days = [
    { date: "2026-03-02", scheduledMinutes: 150 },
    { date: "2026-03-03", scheduledMinutes: 0 },
    { date: "2026-03-04", scheduledMinutes: 60 },
    { date: "2026-03-05", scheduledMinutes: 45 },
    { date: "2026-03-06", scheduledMinutes: 0 },
    { date: "2026-03-07", scheduledMinutes: 480 },
    { date: "2026-03-08", scheduledMinutes: 1380 },
  ];

  it("shows the seven days with today first, and the time booked on each in words", () => {
    render(<AvailabilityCard days={days} />);

    expect(screen.getByRole("heading", { level: 2, name: "Next 7 days" })).toBeVisible();
    const tiles = within(screen.getByRole("list")).getAllByRole("listitem");
    // Each tile: its heading, its date, and the time booked.
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      "Today Mon Mar 22 h 30 min",
      "Tue Mar 3Free",
      "Wed Mar 41 h",
      "Thu Mar 545 min",
      "Fri Mar 6Free",
      "Sat Mar 78 h",
      "Sun Mar 823 h",
    ]);
  });

  it("is honest that working hours are not tracked", () => {
    render(<AvailabilityCard days={days} />);
    expect(screen.getByText(/Working hours are not tracked/)).toBeVisible();
  });

  it("marks each day with a real date for assistive technology", () => {
    render(<AvailabilityCard days={days} />);
    expect(screen.getByText("Mar 3").closest("time")).toHaveAttribute("datetime", "2026-03-03");
  });
});

describe("UpcomingAssignmentsCard", () => {
  const job = (overrides = {}) => ({
    id: JOB_ID,
    reference: "JOB-2026-00007",
    customerName: "Alex Morgan",
    serviceName: "AC Diagnostic Visit",
    scheduledStart: "2026-03-03T14:00:00.000Z",
    scheduledEnd: "2026-03-03T16:00:00.000Z",
    status: "SCHEDULED" as const,
    ...overrides,
  });

  it("lists each job with its reference, customer, service, day, time range and state", () => {
    render(
      <UpcomingAssignmentsCard
        technician={adminTechnician({
          upcomingJobCount: 2,
          upcomingAssignments: [
            job(),
            job({
              id: SECOND_JOB_ID,
              reference: "JOB-2026-00009",
              customerName: "Priya Shah",
              serviceName: "Washing Machine Repair",
              scheduledStart: "2026-03-05T18:00:00.000Z",
              scheduledEnd: "2026-03-05T19:30:00.000Z",
              status: "IN_PROGRESS",
            }),
          ],
        })}
        timeZone={TZ}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Upcoming jobs" })).toBeVisible();
    const table = screen.getByRole("table", { name: "Upcoming jobs for Jordan Lee" });
    const first = within(within(table).getAllByRole("row")[1] as HTMLElement);
    expect(first.getByText("JOB-2026-00007")).toBeVisible();
    expect(first.getByText("Alex Morgan")).toBeVisible();
    expect(first.getByText("AC Diagnostic Visit")).toBeVisible();
    expect(first.getByText("Mar 3, 2026")).toBeVisible();
    expect(first.getByText("9:00 – 11:00 AM")).toBeVisible();
    expect(first.getByText("Scheduled")).toBeVisible();
    const second = within(within(table).getAllByRole("row")[2] as HTMLElement);
    expect(second.getByText("Priya Shah")).toBeVisible();
    expect(second.getByText("In progress")).toBeVisible();
  });

  it("links each job to its page by id (T17: the pages exist now)", () => {
    render(
      <UpcomingAssignmentsCard
        technician={adminTechnician({
          upcomingJobCount: 2,
          upcomingAssignments: [job(), job({ id: SECOND_JOB_ID, reference: "JOB-2026-00009" })],
        })}
        timeZone={TZ}
      />,
    );

    const table = within(screen.getByRole("table", { name: "Upcoming jobs for Jordan Lee" }));
    expect(table.getByRole("link", { name: "JOB-2026-00007" })).toHaveAttribute(
      "href",
      `/app/jobs/${JOB_ID}`,
    );
    expect(table.getByRole("link", { name: "JOB-2026-00009" })).toHaveAttribute(
      "href",
      `/app/jobs/${SECOND_JOB_ID}`,
    );
  });

  it("guides when there are no upcoming jobs", () => {
    render(<UpcomingAssignmentsCard technician={adminTechnician()} timeZone={TZ} />);

    expect(screen.getByRole("heading", { level: 3, name: "No upcoming jobs" })).toBeVisible();
    expect(screen.getByText("When a job is scheduled with Jordan, it appears here.")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says an inactive technician with no jobs is not offered for new ones", () => {
    render(
      <UpcomingAssignmentsCard technician={adminTechnician({ isActive: false })} timeZone={TZ} />,
    );
    expect(
      screen.getByText("Jordan has no jobs coming up and is not offered for new ones."),
    ).toBeVisible();
  });

  it("reminds that an inactive technician's jobs stay until they are reassigned", () => {
    render(
      <UpcomingAssignmentsCard
        technician={adminTechnician({
          isActive: false,
          upcomingJobCount: 1,
          upcomingAssignments: [job()],
        })}
        timeZone={TZ}
      />,
    );
    expect(
      screen.getByText(/Jordan is inactive; these jobs stay assigned until you reassign them\./),
    ).toBeVisible();
  });
});

describe("TechnicianDetailsCard", () => {
  it("shows the phone number and the email as links, the specialties, the colour and the notes", () => {
    render(<TechnicianDetailsCard technician={adminTechnician()} />);

    expect(screen.getByRole("link", { name: "(212) 555-0151" })).toHaveAttribute(
      "href",
      "tel:2125550151",
    );
    expect(screen.getByRole("link", { name: "jordan.lee@coolbreeze.test" })).toHaveAttribute(
      "href",
      "mailto:jordan.lee@coolbreeze.test",
    );
    expect(screen.getByText("Air conditioning")).toBeVisible();
    expect(screen.getByText("Heat pumps")).toBeVisible();
    // The colour is named in words, not only drawn.
    expect(screen.getByText("Blue")).toBeVisible();
    expect(screen.getByText(/Senior technician\. Takes the diagnostic visits/)).toBeVisible();
  });

  it("says for whom it is, and that the technician cannot sign in", () => {
    render(<TechnicianDetailsCard technician={adminTechnician()} />);
    expect(screen.getByText(/For your team only\. Jordan cannot sign in/)).toBeVisible();
  });

  it("says what is missing instead of leaving a gap", () => {
    render(
      <TechnicianDetailsCard
        technician={adminTechnician({
          phone: null,
          email: null,
          specialties: [],
          notes: null,
        })}
      />,
    );

    expect(screen.getAllByText("Not added")).toHaveLength(2);
    expect(screen.getByText("None added")).toBeVisible();
    expect(screen.getByText("No notes")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the line breaks of the notes", () => {
    render(
      <TechnicianDetailsCard technician={adminTechnician({ notes: "First line\nSecond line" })} />,
    );
    expect(screen.getByText(/First line/)).toHaveClass("whitespace-pre-line");
  });
});
