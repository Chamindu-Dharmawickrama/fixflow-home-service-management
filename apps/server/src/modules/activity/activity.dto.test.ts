import { describe, expect, it } from "vitest";

import {
  type AdminTimelineRow,
  CUSTOMER_ACTOR_YOU,
  type CustomerTimelineRow,
  toAdminTimelineEvent,
  toCustomerTimelineEvent,
} from "./activity.dto.js";

const CUSTOMER_USER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_USER_ID = "22222222-2222-4222-8222-222222222222";

const VIEWER = { userId: CUSTOMER_USER_ID, businessName: "CoolBreeze Home Services" };

/** The only keys a customer may ever receive. A new key here is a deliberate, reviewed decision. */
const CUSTOMER_EVENT_KEYS = ["actor", "createdAt", "id", "publicSummary", "toStatus"];

const SECRET_INTERNAL_SUMMARY = "Margin is thin; do not discount further (INTERNAL-ONLY-MARKER)";

function adminRow(overrides: Partial<AdminTimelineRow> = {}): AdminTimelineRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    actorUserId: ADMIN_USER_ID,
    entityType: "QUOTATION",
    entityId: "44444444-4444-4444-8444-444444444444",
    action: "quotation.sent",
    fromStatus: "DRAFT",
    toStatus: "SENT",
    summary: SECRET_INTERNAL_SUMMARY,
    publicSummary: "We sent you quotation QT-2026-00004.",
    metadata: { quotationReference: "QT-2026-00004", lineItemCount: 3, changedFields: ["total"] },
    requestId: "55555555-5555-4555-8555-555555555555",
    customerId: "66666666-6666-4666-8666-666666666666",
    createdAt: new Date("2026-10-29T14:30:00.000Z"),
    actor: { name: "Morgan Reyes", role: "BUSINESS_ADMIN" },
    ...overrides,
  };
}

describe("toAdminTimelineEvent", () => {
  it("shows staff everything: internal summary, metadata and who acted", () => {
    expect(toAdminTimelineEvent(adminRow())).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      action: "quotation.sent",
      entityType: "QUOTATION",
      entityId: "44444444-4444-4444-8444-444444444444",
      fromStatus: "DRAFT",
      toStatus: "SENT",
      summary: SECRET_INTERNAL_SUMMARY,
      publicSummary: "We sent you quotation QT-2026-00004.",
      customerVisible: true,
      metadata: { quotationReference: "QT-2026-00004", lineItemCount: 3, changedFields: ["total"] },
      actor: { name: "Morgan Reyes", role: "BUSINESS_ADMIN" },
      createdAt: "2026-10-29T14:30:00.000Z",
    });
  });

  it("marks an event with no public summary as internal and a system event as having no actor", () => {
    const dto = toAdminTimelineEvent(adminRow({ publicSummary: null, actor: null }));

    expect(dto.customerVisible).toBe(false);
    expect(dto.publicSummary).toBeNull();
    expect(dto.actor).toBeNull();
  });

  it("tolerates metadata that is not an object", () => {
    expect(toAdminTimelineEvent(adminRow({ metadata: null })).metadata).toEqual({});
    expect(toAdminTimelineEvent(adminRow({ metadata: ["x"] })).metadata).toEqual({});
  });
});

function customerRow(overrides: Partial<CustomerTimelineRow> = {}): CustomerTimelineRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    actorUserId: ADMIN_USER_ID,
    publicSummary: "We sent you quotation QT-2026-00004.",
    toStatus: "SENT",
    createdAt: new Date("2026-10-29T14:30:00.000Z"),
    ...overrides,
  };
}

describe("toCustomerTimelineEvent", () => {
  it("contains exactly the allowlisted keys and nothing else", () => {
    const dto = toCustomerTimelineEvent(customerRow(), VIEWER);

    expect(Object.keys(dto).sort()).toEqual(CUSTOMER_EVENT_KEYS);
    expect(dto).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      publicSummary: "We sent you quotation QT-2026-00004.",
      toStatus: "SENT",
      actor: "CoolBreeze Home Services",
      createdAt: "2026-10-29T14:30:00.000Z",
    });
  });

  it("does not leak the internal summary, metadata or staff identity even from a full database row", () => {
    // A caller that passes the whole row (by mistake) still gets only the allowlist.
    const fullRow = adminRow() as unknown as CustomerTimelineRow;

    const dto = toCustomerTimelineEvent(fullRow, VIEWER);
    const json = JSON.stringify(dto);

    expect(Object.keys(dto).sort()).toEqual(CUSTOMER_EVENT_KEYS);
    expect(json).not.toContain("INTERNAL-ONLY-MARKER");
    expect(json).not.toContain("Morgan Reyes");
    expect(json).not.toContain(ADMIN_USER_ID);
    expect(json).not.toContain("66666666-6666-4666-8666-666666666666");
    expect(json).not.toContain("metadata");
    expect(json).not.toContain("quotationReference");
  });

  it("says 'You' for the customer's own actions and the business name for anyone else's", () => {
    expect(
      toCustomerTimelineEvent(customerRow({ actorUserId: CUSTOMER_USER_ID }), VIEWER).actor,
    ).toBe(CUSTOMER_ACTOR_YOU);
    expect(toCustomerTimelineEvent(customerRow({ actorUserId: ADMIN_USER_ID }), VIEWER).actor).toBe(
      "CoolBreeze Home Services",
    );
    expect(toCustomerTimelineEvent(customerRow({ actorUserId: null }), VIEWER).actor).toBe(
      "CoolBreeze Home Services",
    );
  });

  it("fails closed rather than serialize an internal event", () => {
    const internal = customerRow({ publicSummary: null as unknown as string });

    expect(() => toCustomerTimelineEvent(internal, VIEWER)).toThrow(/internal activity event/);
  });
});
