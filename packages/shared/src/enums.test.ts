import { describe, expect, it } from "vitest";

import * as enums from "./enums.js";
import * as shared from "./index.js";

const ENUM_NAMES = [
  "Role",
  "PricingMode",
  "ServiceRequestStatus",
  "PreferredWindow",
  "NoteVisibility",
  "QuotationStatus",
  "WorkOrderStatus",
  "InvoiceStatus",
  "PaymentMethod",
  "NotificationType",
  "EmailDeliveryStatus",
  "ActivityEntityType",
  "ReferenceType",
] as const;

describe("domain enums", () => {
  it("exports exactly the expected enums, all re-exported from the package entry point", () => {
    expect(Object.keys(enums).sort()).toEqual([...ENUM_NAMES].sort());
    for (const name of ENUM_NAMES) {
      expect(shared[name]).toBe(enums[name]);
    }
  });

  it.each(ENUM_NAMES)(
    "%s uses each value as its own key, so the two cannot drift apart",
    (name) => {
      for (const [key, value] of Object.entries(enums[name])) {
        expect(value).toBe(key);
      }
    },
  );

  it("matches the status models in the specification (§6.2–§6.5)", () => {
    expect(Object.values(enums.ServiceRequestStatus)).toEqual([
      "SUBMITTED",
      "UNDER_REVIEW",
      "QUOTED",
      "ACCEPTED",
      "DECLINED",
      "CONVERTED_TO_JOB",
      "CANCELLED",
    ]);
    expect(Object.values(enums.QuotationStatus)).toEqual([
      "DRAFT",
      "SENT",
      "ACCEPTED",
      "DECLINED",
      "EXPIRED",
      "VOID",
    ]);
    expect(Object.values(enums.WorkOrderStatus)).toEqual([
      "PENDING_SCHEDULING",
      "SCHEDULED",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
      "NEEDS_RESCHEDULING",
    ]);
    expect(Object.values(enums.InvoiceStatus)).toEqual([
      "DRAFT",
      "ISSUED",
      "PARTIALLY_PAID",
      "PAID",
      "OVERDUE",
      "VOID",
    ]);
  });
});
