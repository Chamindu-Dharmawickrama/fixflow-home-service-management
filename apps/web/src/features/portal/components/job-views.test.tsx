import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  cancelledCustomerJob,
  completedCustomerJob,
  customerJob,
  customerJobListItem,
  needsTimeCustomerJob,
  PORTAL_JOB_ID,
  PORTAL_QUOTATION_ID,
  PORTAL_REQUEST_ID,
  PORTAL_TIME_ZONE,
  startedCustomerJob,
} from "../test-fixtures";
import { JobCard, JobList } from "./job-cards";
import {
  JobCompletionCard,
  JobHistoryCard,
  JobLinksCard,
  JobStatusCard,
  JobVisitCard,
} from "./job-details";
import { RequestJobCard } from "./request-job-card";
import { UpcomingVisits } from "./upcoming-visits";

const ZONE = PORTAL_TIME_ZONE;

describe("JobCard", () => {
  it("shows the reference as the link, the service, the status, the visit and the first name", () => {
    render(
      <ul>
        <JobCard job={customerJobListItem()} timeZone={ZONE} />
      </ul>,
    );
    const item = screen.getByRole("listitem");

    expect(within(item).getByRole("link", { name: /JOB-2026-00007/ })).toHaveAttribute(
      "href",
      `/portal/jobs/${PORTAL_JOB_ID}`,
    );
    expect(within(item).getByText("Scheduled")).toBeVisible();
    expect(within(item).getByText("AC Repair")).toBeVisible();
    expect(within(item).getByText("Mar 3, 2026")).toBeVisible();
    expect(within(item).getByText(/10:00 AM – 12:00 PM EST/)).toBeVisible();
    expect(within(item).getByText("With Jordan")).toBeVisible();
  });

  it("reads the visit on the business's clocks, not the browser's", () => {
    render(
      <ul>
        <JobCard job={customerJobListItem()} timeZone="Asia/Tokyo" />
      </ul>,
    );
    expect(screen.getByText("Mar 4, 2026")).toBeVisible();
    expect(screen.getByText("12:00 – 2:00 AM GMT+9")).toBeVisible();
    expect(screen.queryByText(/EST/)).not.toBeInTheDocument();
  });

  it.each([
    ["PENDING_SCHEDULING", "Waiting for a time"],
    ["NEEDS_RESCHEDULING", "We are finding a new time"],
    ["CANCELLED", "No visit will take place"],
  ] as const)("says why there is no time for a %s job", (status, words) => {
    render(
      <ul>
        <JobCard
          job={customerJobListItem({
            status,
            scheduledStart: null,
            scheduledEnd: null,
            technician: null,
          })}
          timeZone={ZONE}
        />
      </ul>,
    );
    expect(screen.getByText(words)).toBeVisible();
    expect(screen.queryByText(/With /)).not.toBeInTheDocument();
  });

  it("says when a finished job was completed", () => {
    render(
      <ul>
        <JobCard
          job={customerJobListItem({
            status: "COMPLETED",
            statusLabel: "Completed",
            completedAt: "2026-03-03T16:40:00.000Z",
          })}
          timeZone={ZONE}
        />
      </ul>,
    );
    expect(screen.getByText(/Completed/, { selector: "p" })).toHaveTextContent(
      "Completed Mar 3, 2026",
    );
  });

  it("never shows a technician's surname, phone or email", () => {
    const { container } = render(
      <ul>
        <JobCard job={customerJobListItem()} timeZone={ZONE} />
      </ul>,
    );
    expect(container).not.toHaveTextContent(/Lee|555|@/);
  });
});

describe("JobList", () => {
  it("is a named list with one card for each job", () => {
    render(
      <JobList
        label="Upcoming jobs"
        timeZone={ZONE}
        jobs={[
          customerJobListItem(),
          customerJobListItem({ id: "second", reference: "JOB-2026-00008" }),
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Upcoming jobs" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("JobStatusCard", () => {
  it("explains the status in plain words", () => {
    render(<JobStatusCard job={customerJob()} />);
    expect(screen.getByText(/Your visit is booked for the time shown below/)).toBeVisible();
  });

  it("leaves the status badge to the page header, so it is not said twice", () => {
    render(<JobStatusCard job={customerJob()} />);
    expect(screen.queryByText("Scheduled")).not.toBeInTheDocument();
  });

  it("says the technician has started only for a job that was started, and when", () => {
    render(<JobStatusCard job={startedCustomerJob()} />);
    expect(screen.getByText("Your technician has started work.")).toBeVisible();
    expect(screen.getByText(/^Work started/)).toHaveTextContent(
      "Work started Mar 3, 2026, 10:05 AM EST.",
    );
  });

  it("labels the old time of a job that needs a new one as history, not as a booking", () => {
    render(<JobStatusCard job={needsTimeCustomerJob()} />);
    expect(screen.getByText("Previously booked")).toBeVisible();
    expect(screen.getByText("That time no longer applies.")).toBeVisible();
    expect(screen.getByText(/We need to find a new time for your visit/)).toBeVisible();
  });

  it("says a cancelled job's visit will not take place", () => {
    render(<JobStatusCard job={cancelledCustomerJob()} />);
    expect(screen.getByText("That visit will not take place.")).toBeVisible();
    expect(screen.getByText(/^Cancelled/, { selector: "p" })).toHaveTextContent(
      "Cancelled Mar 2, 2026, 1:00 PM EST.",
    );
  });
});

describe("JobVisitCard", () => {
  it("answers what, when, where and who", () => {
    render(<JobVisitCard job={customerJob()} />);

    const terms = screen.getAllByRole("term").map((term) => term.textContent);
    expect(terms).toEqual(["What", "When", "Where", "Who"]);
    expect(screen.getByText("AC Repair")).toBeVisible();
    expect(screen.getByText(/Replace run capacitor/)).toBeVisible();
    expect(screen.getByText("Mar 3, 2026")).toBeVisible();
    expect(screen.getByText(/10:00 AM – 12:00 PM EST/)).toBeVisible();
    expect(screen.getByText("214 Larkspur Lane")).toBeVisible();
    expect(screen.getByText(/Side gate code is 4471/)).toBeVisible();
    expect(screen.getByText("Jordan")).toBeVisible();
  });

  it("says no time is booked and no one is named when there is neither", () => {
    render(<JobVisitCard job={needsTimeCustomerJob()} />);
    expect(screen.getByText("No time is booked yet.")).toBeVisible();
    expect(
      screen.getByText(/We will tell you who is coming once your visit is booked/),
    ).toBeVisible();
  });

  it("says no visit will take place for a cancelled job", () => {
    render(<JobVisitCard job={cancelledCustomerJob()} />);
    expect(screen.getByText("No visit will take place.")).toBeVisible();
  });

  it("says which clocks the times are on", () => {
    render(<JobVisitCard job={customerJob()} />);
    expect(screen.getByText(/America\/New_York/)).toBeVisible();
  });
});

describe("JobCompletionCard", () => {
  it("shows what was done, with its line breaks, once the job is complete", () => {
    render(<JobCompletionCard job={completedCustomerJob()} />);
    expect(screen.getByRole("heading", { name: "What we did" })).toBeVisible();
    expect(screen.getByText(/Replaced the run capacitor/)).toBeVisible();
    expect(screen.getByText(/The unit now reaches 68 degrees/)).toBeVisible();
  });

  it("draws nothing for a job that is not complete", () => {
    for (const job of [customerJob(), startedCustomerJob(), cancelledCustomerJob()]) {
      const { container, unmount } = render(<JobCompletionCard job={job} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("says no further details were written when the summary is empty", () => {
    render(<JobCompletionCard job={completedCustomerJob({ completionNote: null })} />);
    expect(screen.getByText(/No further details were written/)).toBeVisible();
  });
});

describe("JobHistoryCard", () => {
  it("lists what happened in the customer's words", () => {
    render(<JobHistoryCard job={customerJob()} />);
    const list = screen.getByRole("list", { name: "Job history" });
    expect(within(list).getByText("We created job JOB-2026-00007 for your request.")).toBeVisible();
    expect(within(list).getByText(/We scheduled your visit for/)).toBeVisible();
  });

  it("says so when nothing has happened", () => {
    render(<JobHistoryCard job={customerJob({ timeline: [] })} />);
    expect(screen.getByText("Nothing has happened yet.")).toBeVisible();
  });
});

describe("JobLinksCard", () => {
  it("links the request and the quotation the job came from, and shows no invoice yet", () => {
    render(<JobLinksCard job={customerJob()} />);
    expect(screen.getByRole("link", { name: /FF-2026-00012/ })).toHaveAttribute(
      "href",
      `/portal/requests/${PORTAL_REQUEST_ID}`,
    );
    expect(screen.getByRole("link", { name: /QT-2026-00004/ })).toHaveAttribute(
      "href",
      `/portal/quotations/${PORTAL_QUOTATION_ID}`,
    );
    expect(screen.queryByText(/Invoice/i)).not.toBeInTheDocument();
  });
});

describe("RequestJobCard", () => {
  it("links the job made from the request", () => {
    render(
      <RequestJobCard
        job={{
          id: PORTAL_JOB_ID,
          reference: "JOB-2026-00007",
          status: "SCHEDULED",
          statusLabel: "Scheduled",
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Your job" })).toBeVisible();
    expect(screen.getByText("Scheduled")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /See when it is booked and how it is going/ }),
    ).toHaveAttribute("href", `/portal/jobs/${PORTAL_JOB_ID}`);
  });

  it("draws nothing for a request that has no job, so no link leads nowhere", () => {
    const { container } = render(<RequestJobCard job={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("UpcomingVisits", () => {
  it("lists the visits under a heading, with a link to every job", () => {
    render(
      <UpcomingVisits
        jobs={[
          customerJobListItem(),
          customerJobListItem({ id: "two", reference: "JOB-2026-00009" }),
        ]}
        totalItems={5}
        timeZone={ZONE}
      />,
    );
    const region = screen.getByRole("region", { name: "Upcoming visits" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(within(region).getByRole("link", { name: "View all jobs" })).toHaveAttribute(
      "href",
      "/portal/jobs",
    );
  });

  it("says what to expect when nothing is booked, and offers no link to an empty list", () => {
    render(<UpcomingVisits jobs={[]} totalItems={0} timeZone={ZONE} />);
    const region = screen.getByRole("region", { name: "Upcoming visits" });
    expect(within(region).getByText(/No visits are booked/)).toBeVisible();
    expect(within(region).queryByRole("link")).not.toBeInTheDocument();
  });
});
