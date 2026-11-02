import { describe, expect, it } from "vitest";

import {
  type RequestDetailRow,
  toCustomerRequestDto,
  toCustomerRequestListItem,
} from "./requests.dto.js";

const OWNER_USER_ID = "3e9f4b31-9c4d-4e31-8c40-5a2a6d0f2d44";
const STAFF_USER_ID = "4f0a5c42-ad5e-4f42-9d51-6b3b7e1a3e55";

function row(overrides: Partial<RequestDetailRow> = {}): RequestDetailRow {
  return {
    id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    reference: "FF-2026-00012",
    status: "SUBMITTED",
    serviceNameSnapshot: "AC Repair",
    preferredDate: new Date("2026-11-10T00:00:00.000Z"),
    preferredWindow: "MORNING",
    submittedAt: new Date("2026-10-30T14:05:00.000Z"),
    customerId: "1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22",
    description: "The unit stopped cooling and rattles when it starts.",
    addressLine1: "214 Larkspur Lane",
    addressLine2: "Unit 4",
    addressCity: "Harbor City",
    addressRegion: "NY",
    addressPostalCode: "10001",
    accessNotesSnapshot: "Gate code 4821",
    preferredStart: new Date("2026-11-10T13:00:00.000Z"),
    preferredEnd: new Date("2026-11-10T17:00:00.000Z"),
    cancelledAt: null,
    cancelCustomerMessage: null,
    customer: { userId: OWNER_USER_ID },
    quotations: [],
    notes: [],
    ...overrides,
  };
}

// 2 March 2026, 04:00 in New York.
const NOW = new Date("2026-03-02T09:00:00.000Z");
const VIEWER = { businessName: "CoolBreeze Home Services", now: NOW, timeZone: "America/New_York" };

type QuotationRow = RequestDetailRow["quotations"][number];

function quotationRow(overrides: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id: "5a1b2c3d-0000-4000-8000-000000000001",
    reference: "QT-2026-00007",
    status: "SENT",
    currencyCode: "USD",
    totalAmount: { toFixed: () => "230.08" } as QuotationRow["totalAmount"],
    validUntil: new Date("2026-03-16T00:00:00.000Z"),
    sentAt: new Date("2026-03-01T15:00:00.000Z"),
    respondedAt: null,
    replacedBy: null,
    ...overrides,
  };
}

describe("toCustomerRequestListItem", () => {
  it("returns the fields of a list row and nothing else", () => {
    expect(toCustomerRequestListItem(row())).toEqual({
      id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
      reference: "FF-2026-00012",
      status: "SUBMITTED",
      statusLabel: "Submitted",
      nextStep: "We're reviewing your request and will send a quotation.",
      serviceName: "AC Repair",
      preferredDate: "2026-11-10",
      preferredWindow: "MORNING",
      submittedAt: "2026-10-30T14:05:00.000Z",
    });
  });

  it("never copies a column across: a detail row yields only the list fields", () => {
    const keys = Object.keys(toCustomerRequestListItem(row()));

    expect(keys).not.toContain("description");
    expect(keys).not.toContain("customerId");
    expect(keys).not.toContain("addressLine1");
  });

  it("follows the status for the label and the next step", () => {
    const item = toCustomerRequestListItem(row({ status: "CANCELLED" }));

    expect(item.statusLabel).toBe("Cancelled");
    expect(item.nextStep).toMatch(/cancelled/i);
  });

  it("writes the preferred date as YYYY-MM-DD whatever the machine's time zone", () => {
    expect(toCustomerRequestListItem(row()).preferredDate).toBe("2026-11-10");
    expect(
      toCustomerRequestListItem(row({ preferredDate: new Date("2027-01-01T00:00:00.000Z") }))
        .preferredDate,
    ).toBe("2027-01-01");
  });
});

describe("toCustomerRequestDto: quotations (T15)", () => {
  it("lists the quotations the customer was sent, with exactly the fields they may see", () => {
    const dto = toCustomerRequestDto({
      row: row({ quotations: [quotationRow()] }),
      timeline: [],
      viewer: VIEWER,
    });

    expect(dto.quotations).toEqual([
      {
        id: "5a1b2c3d-0000-4000-8000-000000000001",
        reference: "QT-2026-00007",
        status: "SENT",
        statusLabel: "Sent",
        totalAmount: "230.08",
        currencyCode: "USD",
        validUntil: "2026-03-16",
        sentAt: "2026-03-01T15:00:00.000Z",
        respondedAt: null,
        replacedBy: null,
      },
    ]);
  });

  it("reads a sent quotation past its last day as expired, before the sync has saved it", () => {
    const dto = toCustomerRequestDto({
      row: row({
        quotations: [quotationRow({ validUntil: new Date("2026-03-01T00:00:00.000Z") })],
      }),
      timeline: [],
      viewer: VIEWER,
    });

    expect(dto.quotations[0]).toMatchObject({ status: "EXPIRED", statusLabel: "Expired" });
  });

  it("points a withdrawn quotation to its replacement only once the replacement was sent", () => {
    const replacedBy = { id: "5a1b2c3d-0000-4000-8000-000000000002", reference: "QT-2026-00008" };
    const sentReplacement = toCustomerRequestDto({
      row: row({
        quotations: [quotationRow({ status: "VOID", replacedBy: { ...replacedBy, sentAt: NOW } })],
      }),
      timeline: [],
      viewer: VIEWER,
    });
    const draftReplacement = toCustomerRequestDto({
      row: row({
        quotations: [quotationRow({ status: "VOID", replacedBy: { ...replacedBy, sentAt: null } })],
      }),
      timeline: [],
      viewer: VIEWER,
    });

    expect(sentReplacement.quotations[0]?.replacedBy).toEqual(replacedBy);
    expect(draftReplacement.quotations[0]?.replacedBy).toBeNull();
    expect(JSON.stringify(draftReplacement)).not.toContain("QT-2026-00008");
  });

  it("refuses to serialize a draft, whatever the query returned", () => {
    expect(() =>
      toCustomerRequestDto({
        row: row({ quotations: [quotationRow({ status: "DRAFT", sentAt: null })] }),
        timeline: [],
        viewer: VIEWER,
      }),
    ).toThrow(/draft quotation/i);
  });
});

describe("toCustomerRequestDto", () => {
  it("has exactly the fields a customer may see (an allowlist, so a new column cannot leak)", () => {
    const dto = toCustomerRequestDto({ row: row(), timeline: [], viewer: VIEWER });

    expect(Object.keys(dto).sort()).toEqual(
      [
        "id",
        "reference",
        "status",
        "statusLabel",
        "nextStep",
        "serviceName",
        "preferredDate",
        "preferredWindow",
        "submittedAt",
        "description",
        "address",
        "preferredStart",
        "preferredEnd",
        "cancellation",
        "quotations",
        "notes",
        "timeline",
      ].sort(),
    );
    expect(Object.keys(dto.address).sort()).toEqual(
      ["accessNotes", "city", "line1", "line2", "postalCode", "region"].sort(),
    );
  });

  it("does not expose the owner's ids", () => {
    const text = JSON.stringify(toCustomerRequestDto({ row: row(), timeline: [], viewer: VIEWER }));

    expect(text).not.toContain(OWNER_USER_ID);
    expect(text).not.toContain("1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22");
  });

  it("includes the address copy with the owner's access notes", () => {
    const { address } = toCustomerRequestDto({ row: row(), timeline: [], viewer: VIEWER });

    expect(address).toEqual({
      line1: "214 Larkspur Lane",
      line2: "Unit 4",
      city: "Harbor City",
      region: "NY",
      postalCode: "10001",
      accessNotes: "Gate code 4821",
    });
  });

  it("gives the window as UTC instants", () => {
    const dto = toCustomerRequestDto({ row: row(), timeline: [], viewer: VIEWER });

    expect(dto.preferredStart).toBe("2026-11-10T13:00:00.000Z");
    expect(dto.preferredEnd).toBe("2026-11-10T17:00:00.000Z");
  });

  describe("notes", () => {
    const note = (overrides: Record<string, unknown> = {}) => ({
      id: "5a1b6d53-be6f-4a53-8e62-7c4c8f2b4f66",
      body: "We will bring a replacement capacitor.",
      visibility: "CUSTOMER_VISIBLE" as const,
      authorUserId: STAFF_USER_ID,
      createdAt: new Date("2026-10-30T15:00:00.000Z"),
      ...overrides,
    });

    it("shows the business as the author of staff notes, never the staff member", () => {
      const dto = toCustomerRequestDto({
        row: row({ notes: [note()] }),
        timeline: [],
        viewer: VIEWER,
      });

      expect(dto.notes).toEqual([
        {
          id: "5a1b6d53-be6f-4a53-8e62-7c4c8f2b4f66",
          body: "We will bring a replacement capacitor.",
          author: "CoolBreeze Home Services",
          createdAt: "2026-10-30T15:00:00.000Z",
        },
      ]);
      expect(JSON.stringify(dto)).not.toContain(STAFF_USER_ID);
    });

    it("shows 'You' for a note the owner wrote", () => {
      const dto = toCustomerRequestDto({
        row: row({ notes: [note({ authorUserId: OWNER_USER_ID })] }),
        timeline: [],
        viewer: VIEWER,
      });

      expect(dto.notes[0]?.author).toBe("You");
    });

    it("refuses to serialize an internal note, even if a query let one through", () => {
      expect(() =>
        toCustomerRequestDto({
          row: row({ notes: [note({ visibility: "INTERNAL" })] }),
          timeline: [],
          viewer: VIEWER,
        }),
      ).toThrow(/internal request note/i);
    });
  });

  describe("cancellation", () => {
    const cancelled = (overrides: Partial<RequestDetailRow> = {}) =>
      row({
        status: "CANCELLED",
        cancelledAt: new Date("2026-10-31T09:00:00.000Z"),
        cancelCustomerMessage: "We no longer service that area, sorry.",
        ...overrides,
      });

    it("is null for a request that is not cancelled, whatever the columns hold", () => {
      expect(
        toCustomerRequestDto({
          row: row({ cancelCustomerMessage: "Leftover", cancelledAt: new Date() }),
          timeline: [],
          viewer: VIEWER,
        }).cancellation,
      ).toBeNull();
    });

    it("gives a cancelled request's time and the message the business chose to send", () => {
      expect(
        toCustomerRequestDto({ row: cancelled(), timeline: [], viewer: VIEWER }).cancellation,
      ).toEqual({
        cancelledAt: "2026-10-31T09:00:00.000Z",
        message: "We no longer service that area, sorry.",
      });
    });

    it("has a null message when the business sent none", () => {
      expect(
        toCustomerRequestDto({
          row: cancelled({ cancelCustomerMessage: null }),
          timeline: [],
          viewer: VIEWER,
        }).cancellation,
      ).toEqual({ cancelledAt: "2026-10-31T09:00:00.000Z", message: null });
    });

    it("never carries the internal reason, even if a row somehow held it", () => {
      const withReason = {
        ...cancelled(),
        cancelReason: "Customer is on the do-not-serve list.",
      } as RequestDetailRow;

      const text = JSON.stringify(
        toCustomerRequestDto({ row: withReason, timeline: [], viewer: VIEWER }),
      );

      expect(text).not.toContain("do-not-serve");
      expect(text).not.toContain("cancelReason");
    });
  });

  it("passes the customer timeline through unchanged", () => {
    const timeline = [
      {
        id: "6b2c7e64-cf70-4b64-9f73-8d5d9a3c5a77",
        publicSummary: "You submitted your request.",
        toStatus: "SUBMITTED",
        actor: "You",
        createdAt: "2026-10-30T14:05:00.000Z",
      },
    ];

    expect(toCustomerRequestDto({ row: row(), timeline, viewer: VIEWER }).timeline).toEqual(
      timeline,
    );
  });
});
