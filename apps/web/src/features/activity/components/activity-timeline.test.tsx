import type { AdminTimelineEventDto, CustomerTimelineEventDto } from "@fixflow/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { eventAppearance } from "../lib/event-appearance";
import { toAdminTimelineEvent, toCustomerTimelineEvent } from "../lib/to-timeline-events";
import { ActivityTimeline } from "./activity-timeline";

const TIME_ZONE = "America/New_York";

const ADMIN_EVENTS: AdminTimelineEventDto[] = [
  {
    id: "e1",
    action: "request.submitted",
    entityType: "SERVICE_REQUEST",
    entityId: "r1",
    fromStatus: null,
    toStatus: "SUBMITTED",
    summary: "Alex Morgan submitted request FF-2026-00125.",
    publicSummary: "You sent your request FF-2026-00125.",
    customerVisible: true,
    metadata: {},
    actor: { name: "Alex Morgan", role: "CUSTOMER" },
    createdAt: "2026-10-26T14:05:00.000Z",
  },
  {
    id: "e2",
    action: "request.note_added",
    entityType: "SERVICE_REQUEST",
    entityId: "r1",
    fromStatus: null,
    toStatus: null,
    summary: "Morgan Reyes added an internal note about parts availability.",
    publicSummary: null,
    customerVisible: false,
    metadata: {},
    actor: { name: "Morgan Reyes", role: "BUSINESS_ADMIN" },
    createdAt: "2026-10-26T15:20:00.000Z",
  },
  {
    id: "e3",
    action: "quotation.expired",
    entityType: "QUOTATION",
    entityId: "q1",
    fromStatus: "SENT",
    toStatus: "EXPIRED",
    summary: "The system expired quotation QT-2026-00054.",
    publicSummary: "We marked quotation QT-2026-00054 as expired.",
    customerVisible: true,
    metadata: {},
    actor: null,
    createdAt: "2026-10-28T05:00:00.000Z",
  },
];

const CUSTOMER_EVENTS: CustomerTimelineEventDto[] = [
  {
    id: "e1",
    publicSummary: "You sent your request FF-2026-00125.",
    toStatus: "SUBMITTED",
    actor: "You",
    createdAt: "2026-10-26T14:05:00.000Z",
  },
  {
    id: "e3",
    publicSummary: "We marked quotation QT-2026-00054 as expired.",
    toStatus: "EXPIRED",
    actor: "CoolBreeze Home Services",
    createdAt: "2026-10-28T05:00:00.000Z",
  },
];

describe("ActivityTimeline, staff variant", () => {
  it("lists every event with the internal summary, the actor and the time", () => {
    render(<ActivityTimeline variant="admin" events={ADMIN_EVENTS} timeZone={TIME_ZONE} />);

    const list = screen.getByRole("list", { name: "Activity history" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Alex Morgan submitted request FF-2026-00125.");
    expect(items[0]).toHaveTextContent("Oct 26, 2026, 10:05 AM");
    expect(items[0]).toHaveTextContent("Alex Morgan");
    expect(items[1]).toHaveTextContent("Morgan Reyes added an internal note");
    expect(items[1]).toHaveTextContent("Morgan Reyes");
  });

  it("marks only the events the customer cannot see as Internal", () => {
    render(<ActivityTimeline variant="admin" events={ADMIN_EVENTS} timeZone={TIME_ZONE} />);

    const items = screen.getAllByRole("listitem");
    expect(within(items[0] as HTMLElement).queryByText("Internal")).not.toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText("Internal")).toBeInTheDocument();
    expect(within(items[2] as HTMLElement).queryByText("Internal")).not.toBeInTheDocument();
    expect(screen.getAllByText("Internal")).toHaveLength(1);
  });

  it("shows staff what the customer was told, and 'System' for an event with no actor", () => {
    render(<ActivityTimeline variant="admin" events={ADMIN_EVENTS} timeZone={TIME_ZONE} />);

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Customer sees: “You sent your request FF-2026-00125.”");
    expect(items[1]).not.toHaveTextContent("Customer sees");
    expect(items[2]).toHaveTextContent(
      "Customer sees: “We marked quotation QT-2026-00054 as expired.”",
    );
    expect(items[2]).toHaveTextContent("System");
  });

  it("uses a label of your choice for the list", () => {
    render(
      <ActivityTimeline
        variant="admin"
        events={ADMIN_EVENTS}
        timeZone={TIME_ZONE}
        label="Request FF-2026-00125 history"
      />,
    );

    expect(screen.getByRole("list", { name: "Request FF-2026-00125 history" })).toBeInTheDocument();
  });
});

describe("ActivityTimeline, customer variant", () => {
  it("shows what the customer may see, and who did it as 'You' or the business", () => {
    render(<ActivityTimeline variant="customer" events={CUSTOMER_EVENTS} timeZone={TIME_ZONE} />);

    const items = within(screen.getByRole("list", { name: "Request history" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("You sent your request FF-2026-00125.");
    expect(items[0]).toHaveTextContent("You");
    expect(items[1]).toHaveTextContent("We marked quotation QT-2026-00054 as expired.");
    expect(items[1]).toHaveTextContent("CoolBreeze Home Services");
  });

  it("has no Internal marker and no staff-only wording", () => {
    render(<ActivityTimeline variant="customer" events={CUSTOMER_EVENTS} timeZone={TIME_ZONE} />);

    expect(screen.queryByText("Internal")).not.toBeInTheDocument();
    expect(screen.queryByText(/Customer sees/)).not.toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });
});

describe("ActivityTimeline, empty", () => {
  it.each(["admin", "customer"] as const)("says nothing has happened yet (%s)", (variant) => {
    render(
      variant === "admin" ? (
        <ActivityTimeline variant="admin" events={[]} timeZone={TIME_ZONE} />
      ) : (
        <ActivityTimeline variant="customer" events={[]} timeZone={TIME_ZONE} />
      ),
    );

    expect(screen.getByText("Nothing has happened yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("takes a custom message", () => {
    render(
      <ActivityTimeline
        variant="customer"
        events={[]}
        timeZone={TIME_ZONE}
        emptyMessage="We will show updates on your request here."
      />,
    );

    expect(screen.getByText("We will show updates on your request here.")).toBeInTheDocument();
  });
});

describe("the adapters", () => {
  it("turn an internal staff event into a titled, attributed entry", () => {
    const entry = toAdminTimelineEvent(ADMIN_EVENTS[1] as AdminTimelineEventDto);

    expect(entry).toMatchObject({
      id: "e2",
      actor: "Morgan Reyes",
      timestamp: "2026-10-26T15:20:00.000Z",
      description: undefined,
      tone: "neutral",
    });
  });

  it("turn a customer event into its public sentence and nothing else", () => {
    const entry = toCustomerTimelineEvent(CUSTOMER_EVENTS[0] as CustomerTimelineEventDto);

    expect(entry).toMatchObject({
      id: "e1",
      title: "You sent your request FF-2026-00125.",
      actor: "You",
    });
    // Nothing beyond the sentence, the time, the actor and how it looks: no description, no badge.
    expect(Object.keys(entry).sort()).toEqual([
      "actor",
      "icon",
      "id",
      "timestamp",
      "title",
      "tone",
    ]);
  });
});

describe("eventAppearance", () => {
  it.each([
    ["SUBMITTED", "info"],
    ["SENT", "attention"],
    ["ACCEPTED", "success"],
    ["COMPLETED", "success"],
    ["PAID", "success"],
    ["OVERDUE", "danger"],
    ["EXPIRED", "neutral"],
    ["CANCELLED", "neutral"],
    ["VOID", "neutral"],
    ["NEEDS_RESCHEDULING", "attention"],
  ])("gives %s the %s tone from the status mapping", (status, tone) => {
    expect(eventAppearance(status).tone).toBe(tone);
  });

  it("gives a neutral dot to no status, an unknown status and names that exist on every object", () => {
    for (const status of [null, "SOMETHING_NEW", "constructor", "__proto__", "toString"]) {
      expect(eventAppearance(status).tone).toBe("neutral");
    }
  });
});
