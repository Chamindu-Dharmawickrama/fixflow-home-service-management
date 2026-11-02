import { describe, expect, it } from "vitest";

import {
  NotificationReadState,
  notificationReadState,
  PaymentRecordState,
  paymentRecordState,
  ServiceCatalogueState,
  serviceCatalogueState,
  TechnicianState,
} from "./derived-status.js";
import * as shared from "./index.js";

describe("derived display states", () => {
  it("are exported from the package entry point", () => {
    expect(shared.PaymentRecordState).toBe(PaymentRecordState);
    expect(shared.NotificationReadState).toBe(NotificationReadState);
    expect(shared.ServiceCatalogueState).toBe(ServiceCatalogueState);
    expect(shared.paymentRecordState).toBe(paymentRecordState);
    expect(shared.notificationReadState).toBe(notificationReadState);
    expect(shared.serviceCatalogueState).toBe(serviceCatalogueState);
  });

  it("use each value as its own key", () => {
    for (const states of [
      PaymentRecordState,
      NotificationReadState,
      ServiceCatalogueState,
      TechnicianState,
    ]) {
      for (const [key, value] of Object.entries(states)) {
        expect(value).toBe(key);
      }
    }
  });

  it("treats a payment as recorded until it is voided", () => {
    expect(paymentRecordState({ voidedAt: null })).toBe("RECORDED");
    expect(paymentRecordState({ voidedAt: "2026-10-28T15:00:00.000Z" })).toBe("VOID");
  });

  it("treats a notification as unread until it has a read time", () => {
    expect(notificationReadState({ readAt: null })).toBe("UNREAD");
    expect(notificationReadState({ readAt: "2026-10-28T15:00:00.000Z" })).toBe("READ");
  });

  it("derives where a service stands in the catalogue, archived first", () => {
    expect(serviceCatalogueState({ isPublished: true, archivedAt: null })).toBe("PUBLISHED");
    expect(serviceCatalogueState({ isPublished: false, archivedAt: null })).toBe("UNPUBLISHED");
    expect(serviceCatalogueState({ isPublished: false, archivedAt: new Date() })).toBe("ARCHIVED");
    // A row that is somehow both archived and published is archived: it must not look live.
    expect(
      serviceCatalogueState({ isPublished: true, archivedAt: "2026-10-28T15:00:00.000Z" }),
    ).toBe("ARCHIVED");
  });
});
