import {
  EmailDeliveryStatus,
  InvoiceStatus,
  NotificationReadState,
  PaymentRecordState,
  QuotationStatus,
  ServiceRequestStatus,
  WorkOrderStatus,
} from "@fixflow/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  getStatusMeta,
  STATUS_ICON_NAMES,
  STATUS_TONES,
  type StatusKind,
} from "@/lib/formatting/status";

import { STATUS_ICONS, StatusBadge } from "./status-badge";

const ENUMS_BY_KIND: Record<StatusKind, Record<string, string>> = {
  request: ServiceRequestStatus,
  quotation: QuotationStatus,
  workOrder: WorkOrderStatus,
  invoice: InvoiceStatus,
  payment: PaymentRecordState,
  notification: NotificationReadState,
  emailDelivery: EmailDeliveryStatus,
};

const CASES = (Object.entries(ENUMS_BY_KIND) as [StatusKind, Record<string, string>][]).flatMap(
  ([kind, values]) => Object.values(values).map((status) => [kind, status] as const),
);

describe("StatusBadge", () => {
  it("covers every value of every status enum in @fixflow/shared", () => {
    // 7 + 6 + 6 + 6 + 2 + 2 + 5
    expect(CASES).toHaveLength(34);
  });

  it.each(CASES)("%s %s renders its label as text, a tone and an icon", (kind, status) => {
    const meta = getStatusMeta(kind, status as never);
    const { container } = render(<StatusBadge kind={kind} status={status as never} />);

    const badge = screen.getByText(meta.label);
    expect(badge).toBeVisible();
    // Colour is never the only signal: the label is real text inside the badge.
    expect(badge).toHaveTextContent(meta.label);
    expect(badge.className).toContain(`text-${meta.tone}`);
    expect(badge).toHaveAttribute("data-status", status);

    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("has a Lucide icon for every icon key the mapping can use", () => {
    expect(Object.keys(STATUS_ICONS).sort()).toEqual([...STATUS_ICON_NAMES].sort());
    for (const name of STATUS_ICON_NAMES) {
      expect(STATUS_ICONS[name]).toBeTruthy();
    }
  });

  it("uses a tone class for each of the five tones", () => {
    const seen = new Set<string>();
    for (const [kind, status] of CASES) {
      seen.add(getStatusMeta(kind, status as never).tone);
    }
    expect([...seen].sort()).toEqual([...STATUS_TONES].sort());
  });

  it("tells the same word apart by record kind", () => {
    const { rerender } = render(<StatusBadge kind="request" status="ACCEPTED" />);
    const asRequest = screen.getByText("Accepted").className;
    rerender(<StatusBadge kind="quotation" status="ACCEPTED" />);
    expect(screen.getByText("Accepted").className).toBe(asRequest);

    rerender(<StatusBadge kind="request" status="DECLINED" />);
    expect(screen.getByText("Declined")).toBeVisible();
    rerender(<StatusBadge kind="invoice" status="VOID" />);
    expect(screen.getByText("Void")).toBeVisible();
  });

  it("can hide the icon but never the label", () => {
    const { container } = render(<StatusBadge kind="invoice" status="OVERDUE" showIcon={false} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("Overdue")).toBeVisible();
  });

  it("still renders a value it does not know", () => {
    render(<StatusBadge kind="invoice" status={"WRITTEN_OFF" as never} />);
    expect(screen.getByText("Written off")).toBeVisible();
  });
});
