import {
  EmailDeliveryStatus,
  InvoiceStatus,
  NotificationReadState,
  PaymentRecordState,
  QuotationStatus,
  ServiceRequestStatus,
  WorkOrderStatus,
} from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  getStatusMeta,
  STATUS_ICON_NAMES,
  STATUS_META,
  STATUS_TONES,
  type StatusKind,
  statusLabel,
} from "./status";

/** Every status enum in `@fixflow/shared` and the badge kind that renders it. */
const ENUMS_BY_KIND: Record<StatusKind, Record<string, string>> = {
  request: ServiceRequestStatus,
  quotation: QuotationStatus,
  workOrder: WorkOrderStatus,
  invoice: InvoiceStatus,
  payment: PaymentRecordState,
  notification: NotificationReadState,
  emailDelivery: EmailDeliveryStatus,
};

const KINDS = Object.keys(ENUMS_BY_KIND) as StatusKind[];

describe("status mapping", () => {
  it("has a table for every status kind", () => {
    expect(Object.keys(STATUS_META).sort()).toEqual([...KINDS].sort());
  });

  it.each(KINDS)("%s: maps every enum value, and nothing else", (kind) => {
    expect(Object.keys(STATUS_META[kind]).sort()).toEqual(
      Object.values(ENUMS_BY_KIND[kind]).sort(),
    );
  });

  describe.each(KINDS)("%s", (kind) => {
    it.each(Object.values(ENUMS_BY_KIND[kind]))(
      "%s has a label, tone, icon and description",
      (value) => {
        const meta = getStatusMeta(kind, value as never);

        expect(meta.label.trim().length).toBeGreaterThan(0);
        expect(STATUS_TONES).toContain(meta.tone);
        expect(STATUS_ICON_NAMES).toContain(meta.icon);
        expect(meta.description).toMatch(/\.$/);
        expect(meta.description.length).toBeGreaterThan(10);
      },
    );

    it("gives every status in the kind a distinct label", () => {
      const labels = Object.values(STATUS_META[kind]).map((meta) => meta.label);
      expect(new Set(labels).size).toBe(labels.length);
    });
  });

  it("follows the tone rules", () => {
    // closed, terminal or void → neutral
    expect(getStatusMeta("request", "CANCELLED").tone).toBe("neutral");
    expect(getStatusMeta("quotation", "VOID").tone).toBe("neutral");
    expect(getStatusMeta("quotation", "EXPIRED").tone).toBe("neutral");
    expect(getStatusMeta("workOrder", "CANCELLED").tone).toBe("neutral");
    expect(getStatusMeta("invoice", "VOID").tone).toBe("neutral");
    expect(getStatusMeta("payment", "VOID").tone).toBe("neutral");
    // positive outcome → success
    expect(getStatusMeta("quotation", "ACCEPTED").tone).toBe("success");
    expect(getStatusMeta("workOrder", "COMPLETED").tone).toBe("success");
    expect(getStatusMeta("invoice", "PAID").tone).toBe("success");
    // problem or overdue → danger
    expect(getStatusMeta("invoice", "OVERDUE").tone).toBe("danger");
    expect(getStatusMeta("emailDelivery", "FAILED").tone).toBe("danger");
    // new or awaiting → info
    expect(getStatusMeta("request", "SUBMITTED").tone).toBe("info");
    expect(getStatusMeta("notification", "UNREAD").tone).toBe("info");
    // needs action → attention
    expect(getStatusMeta("workOrder", "PENDING_SCHEDULING").tone).toBe("attention");
    expect(getStatusMeta("workOrder", "NEEDS_RESCHEDULING").tone).toBe("attention");
    expect(getStatusMeta("quotation", "SENT").tone).toBe("attention");
  });

  it("never claims an email was delivered when it was only logged or handed over", () => {
    expect(getStatusMeta("emailDelivery", "LOGGED").label).not.toMatch(/sent|delivered/i);
    expect(getStatusMeta("emailDelivery", "SENT").label).toBe("Sent");
    expect(getStatusMeta("emailDelivery", "SENT").description).toMatch(/isn't confirmed/);
  });

  it("returns a neutral fallback for a value the web app does not know yet", () => {
    const meta = getStatusMeta("invoice", "WRITTEN_OFF" as never);
    expect(meta).toEqual({
      label: "Written off",
      tone: "neutral",
      icon: "circle-help",
      description: "",
    });
  });

  it("statusLabel returns just the label", () => {
    expect(statusLabel("workOrder", "NEEDS_RESCHEDULING")).toBe("Needs rescheduling");
    expect(statusLabel("invoice", "PARTIALLY_PAID")).toBe("Partially paid");
  });
});
