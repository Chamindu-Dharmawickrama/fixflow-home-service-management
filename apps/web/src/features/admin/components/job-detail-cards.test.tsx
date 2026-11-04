import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  adminJob,
  cancelledJob,
  completedJob,
  CUSTOMER_ID,
  needsReschedulingJob,
  QUOTATION_ID,
  REQUEST_ID,
  startedJob,
  unscheduledJob,
} from "../test-fixtures";
import {
  JobAddressCard,
  JobCustomerCard,
  JobHistoryCard,
  JobLinksCard,
  JobOutcomeCard,
  JobScheduleCard,
  JobScopeCard,
} from "./job-detail-cards";

const NEW_YORK = "America/New_York";

describe("JobScheduleCard", () => {
  it("shows when, for how long and with whom, on the business's clocks", () => {
    render(<JobScheduleCard job={adminJob()} timeZone={NEW_YORK} />);
    const card = screen.getByRole("heading", { name: "Appointment" }).closest("div") as HTMLElement;

    expect(
      screen.getByText(/Times are shown on the business's clocks \(America\/New_York\)/),
    ).toBeVisible();
    expect(screen.getByText("Mar 3, 2026")).toBeVisible();
    expect(screen.getByText(/10:00 AM – 12:00 PM EST/)).toBeVisible();
    expect(screen.getByText("2 hours")).toBeVisible();
    expect(screen.getByText("Jordan Lee")).toBeVisible();
    expect(card).toBeTruthy();
  });

  it("gives the business the technician's number and email to reach them", () => {
    render(<JobScheduleCard job={adminJob()} timeZone={NEW_YORK} />);

    expect(screen.getByRole("link", { name: "(212) 555-0151" })).toHaveAttribute(
      "href",
      "tel:(212) 555-0151",
    );
    expect(screen.getByRole("link", { name: "jordan.lee@coolbreeze.test" })).toHaveAttribute(
      "href",
      "mailto:jordan.lee@coolbreeze.test",
    );
  });

  it("says a technician who is now inactive is, and how to change it", () => {
    const job = adminJob();
    render(
      <JobScheduleCard
        job={{ ...job, technician: job.technician && { ...job.technician, isActive: false } }}
        timeZone={NEW_YORK}
      />,
    );
    expect(screen.getByText(/Inactive: reschedule to give the job to someone else/)).toBeVisible();
  });

  it("says 'Not scheduled yet' and what to do, instead of an empty card", () => {
    render(<JobScheduleCard job={unscheduledJob()} timeZone={NEW_YORK} />);

    expect(screen.getByText("Not scheduled yet")).toBeVisible();
    expect(screen.getByText(/Choose a day, a time and a technician/)).toBeVisible();
    expect(screen.queryByText("Technician")).not.toBeInTheDocument();
  });

  it("does not tell a cancelled job to be scheduled", () => {
    render(
      <JobScheduleCard
        job={unscheduledJob({ status: "CANCELLED", availableActions: [] })}
        timeZone={NEW_YORK}
      />,
    );
    expect(screen.getByText("Cancelled")).toBeVisible();
    expect(screen.getByText(/so no visit will take place/)).toBeVisible();
    expect(screen.queryByText(/Choose a day, a time and a technician/)).not.toBeInTheDocument();
  });

  it("shows when the work started and finished once it has", () => {
    render(
      <JobScheduleCard
        job={adminJob({
          status: "COMPLETED",
          startedAt: "2026-03-03T15:10:00.000Z",
          completedAt: "2026-03-03T16:45:00.000Z",
          availableActions: [],
        })}
        timeZone={NEW_YORK}
      />,
    );
    expect(screen.getByText("Started")).toBeVisible();
    expect(screen.getByText("Completed")).toBeVisible();
  });
});

describe("JobScopeCard", () => {
  it("shows the scope as written, and the lines and totals of the accepted quotation", () => {
    render(<JobScopeCard job={adminJob()} />);

    expect(screen.getByText(/The outdoor unit hums/)).toBeVisible();
    const lines = screen.getAllByRole("table", { name: "Lines of quotation QT-2026-00009" })[0];
    expect(within(lines as HTMLElement).getByText("Diagnostic visit")).toBeVisible();
    expect(within(lines as HTMLElement).getByText("Replace run capacitor")).toBeVisible();
    expect(screen.getByText("Subtotal").nextElementSibling).toHaveTextContent("$252.00");
    expect(screen.getByText("Total").nextElementSibling).toHaveTextContent("$255.64");
  });

  it("links to the quotation it came from", () => {
    render(<JobScopeCard job={adminJob()} />);
    expect(screen.getByRole("link", { name: "QT-2026-00009" })).toHaveAttribute(
      "href",
      `/app/quotations/${QUOTATION_ID}`,
    );
  });

  it("keeps a long unbroken word in the scope from widening the page", () => {
    render(<JobScopeCard job={adminJob({ scopeDescription: "x".repeat(300) })} />);
    expect(screen.getByText("x".repeat(300)).className).toMatch(/break-words/);
  });
});

describe("JobAddressCard", () => {
  it("shows the address and the access notes", () => {
    render(<JobAddressCard job={adminJob()} />);

    expect(screen.getByText("214 Larkspur Lane")).toBeVisible();
    expect(screen.getByText("Harbor City, NY 10001")).toBeVisible();
    expect(screen.getByText("Side gate code is 4471.")).toBeVisible();
  });

  it("says there are no access notes rather than leaving a gap", () => {
    const job = adminJob();
    render(<JobAddressCard job={{ ...job, address: { ...job.address, accessNotes: null } }} />);
    expect(screen.getByText("No access notes.")).toBeVisible();
  });
});

describe("JobCustomerCard", () => {
  it("gives the customer's contact details and a link to their history", () => {
    render(<JobCustomerCard job={adminJob()} />);

    expect(screen.getByText("Amara Okafor")).toBeVisible();
    expect(screen.getByRole("link", { name: "amara.okafor@example.test" })).toHaveAttribute(
      "href",
      "mailto:amara.okafor@example.test",
    );
    expect(screen.getByRole("link", { name: "(212) 555-0100" })).toBeVisible();
    expect(screen.getByRole("link", { name: /View full customer history/ })).toHaveAttribute(
      "href",
      `/app/customers/${CUSTOMER_ID}`,
    );
  });

  it("says when the customer gave no phone number", () => {
    const job = adminJob();
    render(<JobCustomerCard job={{ ...job, customer: { ...job.customer, phone: null } }} />);
    expect(screen.getByText("No phone number given.")).toBeVisible();
  });
});

describe("JobLinksCard", () => {
  it("links back to the request and the quotation", () => {
    render(<JobLinksCard job={adminJob()} />);

    expect(screen.getByRole("link", { name: "FF-2026-00012" })).toHaveAttribute(
      "href",
      `/app/requests/${REQUEST_ID}`,
    );
    expect(screen.getByRole("link", { name: "QT-2026-00009" })).toHaveAttribute(
      "href",
      `/app/quotations/${QUOTATION_ID}`,
    );
  });
});

describe("JobHistoryCard", () => {
  it("shows the history in the staff's words, with who did it", () => {
    render(
      <JobHistoryCard
        timeZone={NEW_YORK}
        job={adminJob({
          timeline: [
            {
              id: "event-1",
              action: "work_order.scheduled",
              entityType: "WORK_ORDER",
              entityId: "x",
              fromStatus: "PENDING_SCHEDULING",
              toStatus: "SCHEDULED",
              summary:
                "Morgan Reyes scheduled job JOB-2026-00007 for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST with Jordan Lee.",
              publicSummary:
                "We scheduled your visit for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST.",
              customerVisible: true,
              metadata: {},
              actor: { name: "Morgan Reyes", role: "BUSINESS_ADMIN" },
              createdAt: "2026-03-02T09:30:00.000Z",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText(/scheduled job JOB-2026-00007/)).toBeVisible();
    expect(screen.getByText(/with Jordan Lee/)).toBeVisible();
  });

  it("says nothing has happened rather than showing an empty box", () => {
    render(<JobHistoryCard job={adminJob({ timeline: [] })} timeZone={NEW_YORK} />);
    expect(screen.getByText("Nothing has happened yet.")).toBeVisible();
  });
});

describe("JobScheduleCard: a job that gave up its time (T18)", () => {
  it("shows the old appointment of a job that needs a new time as history, never as a booking", () => {
    render(<JobScheduleCard job={needsReschedulingJob()} timeZone={NEW_YORK} />);

    expect(screen.getByText("Needs a new time")).toBeVisible();
    expect(
      screen.getByText(/Choose a new day, a time and a technician with Schedule/),
    ).toBeVisible();
    expect(screen.getByText("Previously scheduled")).toBeVisible();
    expect(screen.getByText("Technician then")).toBeVisible();
    // It is not read as a live appointment.
    expect(screen.queryByText("When")).not.toBeInTheDocument();
    expect(screen.queryByText("Length")).not.toBeInTheDocument();
    expect(screen.queryByText(/Inactive/)).not.toBeInTheDocument();
  });

  it("says a cancelled job is cancelled and keeps its old time as history", () => {
    render(<JobScheduleCard job={cancelledJob()} timeZone={NEW_YORK} />);

    expect(screen.getByText("Cancelled")).toBeVisible();
    expect(screen.getByText(/so no visit will take place/)).toBeVisible();
    expect(screen.getByText("Previously scheduled")).toBeVisible();
    expect(screen.queryByText(/Choose a/)).not.toBeInTheDocument();
  });

  it("says nothing of a previous time for a job that was never scheduled", () => {
    render(
      <JobScheduleCard
        job={cancelledJob({ scheduledStart: null, scheduledEnd: null, technician: null })}
        timeZone={NEW_YORK}
      />,
    );
    expect(screen.queryByText("Previously scheduled")).not.toBeInTheDocument();
  });

  it("shows the start of a job that is under way", () => {
    render(<JobScheduleCard job={startedJob()} timeZone={NEW_YORK} />);
    expect(screen.getByText("Started")).toBeVisible();
    expect(screen.getByText("When")).toBeVisible();
  });
});

describe("JobOutcomeCard (T18)", () => {
  it("labels the completion summary as shown to the customer and the internal note as team only", () => {
    render(<JobOutcomeCard job={completedJob()} timeZone={NEW_YORK} />);

    const summary = screen.getByRole("region", { name: "Completion summary" });
    expect(within(summary).getByText("Shown to the customer")).toBeVisible();
    expect(within(summary).getByText(/Replaced the run capacitor/)).toBeVisible();

    const internal = screen.getByRole("region", { name: "Internal note" });
    expect(within(internal).getByText("Team only")).toBeVisible();
    expect(within(internal).getByText("Offer a surge protector at the next visit.")).toBeVisible();
  });

  it("says plainly when a note was not recorded", () => {
    render(
      <JobOutcomeCard
        job={completedJob({ completionNote: null, internalCompletionNote: null })}
        timeZone={NEW_YORK}
      />,
    );
    expect(screen.getByText("No summary was recorded.")).toBeVisible();
    expect(screen.getByText("No internal note was recorded.")).toBeVisible();
  });

  it("shows a cancelled job's reason as team only, with when it was cancelled", () => {
    render(<JobOutcomeCard job={cancelledJob()} timeZone={NEW_YORK} />);

    expect(screen.getByRole("heading", { name: "Cancellation" })).toBeVisible();
    expect(screen.getByText(/^Cancelled/, { selector: "p" })).toHaveTextContent(
      "Cancelled Mar 2, 2026, 1:00 PM EST.",
    );
    expect(screen.getByText("Team only")).toBeVisible();
    expect(screen.getByText("The customer moved away before the visit.")).toBeVisible();
    expect(screen.queryByText("Shown to the customer")).not.toBeInTheDocument();
  });

  it("draws nothing for a job that has not ended", () => {
    for (const job of [unscheduledJob(), adminJob(), startedJob(), needsReschedulingJob()]) {
      const { container, unmount } = render(<JobOutcomeCard job={job} timeZone={NEW_YORK} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
