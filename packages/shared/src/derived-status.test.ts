import { describe, expect, it } from "vitest";

import {
  NotificationReadState,
  notificationReadState,
  PaymentRecordState,
  paymentRecordState,
} from "./derived-status.js";
import * as shared from "./index.js";

describe("derived display states", () => {
  it("are exported from the package entry point", () => {
    expect(shared.PaymentRecordState).toBe(PaymentRecordState);
    expect(shared.NotificationReadState).toBe(NotificationReadState);
    expect(shared.paymentRecordState).toBe(paymentRecordState);
    expect(shared.notificationReadState).toBe(notificationReadState);
  });

  it("use each value as its own key", () => {
    for (const states of [PaymentRecordState, NotificationReadState]) {
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
});
