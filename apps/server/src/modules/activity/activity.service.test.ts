import { ActivityEntityType } from "@fixflow/shared";
import { describe, expect, it, vi } from "vitest";

import type { DbClient } from "../../lib/db.js";
import { type ActivityMetadata, ActivityValidationError } from "./activity.metadata.js";
import { recordActivity, type RecordActivityInput } from "./activity.service.js";

const ID = "5b2d6d57-97b7-4d0a-9b9b-3e0d1e1b8c11";

const VALID: RecordActivityInput = {
  actorUserId: ID,
  entityType: ActivityEntityType.QUOTATION,
  entityId: ID,
  action: "quotation.sent",
  fromStatus: "DRAFT",
  toStatus: "SENT",
  summary: "Quotation QT-2026-00004 sent to the customer.",
  publicSummary: "Quotation sent",
  metadata: { quotationReference: "QT-2026-00004", totalAmount: "250.00" },
  requestId: ID,
  customerId: ID,
};

/** A transaction handle that records what would be written. */
function fakeTx(): { tx: DbClient; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn((args: { data: unknown }) =>
    Promise.resolve({ id: ID, ...(args.data as object) }),
  );
  return { tx: { activityEvent: { create } } as unknown as DbClient, create };
}

describe("recordActivity input validation", () => {
  it("writes one event with the values it was given", async () => {
    const { tx, create } = fakeTx();

    await recordActivity(tx, VALID);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        actorUserId: ID,
        entityType: "QUOTATION",
        entityId: ID,
        action: "quotation.sent",
        fromStatus: "DRAFT",
        toStatus: "SENT",
        summary: "Quotation QT-2026-00004 sent to the customer.",
        publicSummary: "Quotation sent",
        metadata: { quotationReference: "QT-2026-00004", totalAmount: "250.00" },
        requestId: ID,
        customerId: ID,
      },
    });
  });

  it("fills the optional fields with null and the metadata with an empty object", async () => {
    const { tx, create } = fakeTx();

    await recordActivity(tx, {
      actorUserId: null,
      entityType: ActivityEntityType.SETTINGS,
      entityId: ID,
      action: "settings.updated",
      summary: "Business settings updated.",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actorUserId: null,
        entityType: "SETTINGS",
        entityId: ID,
        action: "settings.updated",
        fromStatus: null,
        toStatus: null,
        summary: "Business settings updated.",
        publicSummary: null,
        metadata: {},
        requestId: null,
        customerId: null,
      },
    });
  });

  it.each([
    [
      "a metadata key that is not allowed",
      { metadata: { email: "x" } as unknown as ActivityMetadata },
    ],
    ["a metadata value that looks like an email", { metadata: { serviceName: "a@b.co" } }],
    ["a metadata value that looks like a token", { metadata: { reference: "a".repeat(40) } }],
    ["a metadata value that looks like an address", { metadata: { serviceName: "12 Elm Street" } }],
    ["an entity id that is not a UUID", { entityId: "FF-2026-00001" }],
    ["an actor id that is not a UUID", { actorUserId: "morgan" }],
    ["a customer id that is not a UUID", { customerId: "alex" }],
    ["an action in the wrong format", { action: "QuotationSent" }],
    ["an action without a dot", { action: "sent" }],
    ["an overlong action", { action: `quotation.${"a".repeat(60)}` }],
    ["a status that is not upper case", { toStatus: "sent" }],
    ["an empty summary", { summary: "   " }],
    ["an overlong summary", { summary: "x".repeat(501) }],
    ["an overlong public summary", { publicSummary: "x".repeat(301) }],
    ["an empty public summary", { publicSummary: "" }],
  ] satisfies [string, Partial<RecordActivityInput>][])(
    "rejects %s and writes nothing",
    async (_what, override) => {
      const { tx, create } = fakeTx();

      await expect(recordActivity(tx, { ...VALID, ...override })).rejects.toBeInstanceOf(
        ActivityValidationError,
      );
      expect(create).not.toHaveBeenCalled();
    },
  );
});
