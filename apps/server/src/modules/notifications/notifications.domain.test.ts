import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_MESSAGE_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
  NotificationValidationError,
  validateNotificationContent,
  validateRecipient,
} from "./notifications.domain.js";

const VALID = {
  type: "QUOTATION_SENT",
  title: "Quotation QT-2026-00004 is ready",
  message: "We have sent you a quotation for AC Repair. Please review it.",
  linkPath: "/portal/quotations/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
} as const;

describe("validateNotificationContent", () => {
  it("accepts a well-formed notification, with or without an entity", () => {
    expect(() => {
      validateNotificationContent(VALID);
    }).not.toThrow();
    expect(() => {
      validateNotificationContent({
        ...VALID,
        entity: { type: "QUOTATION", id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" },
      });
    }).not.toThrow();
  });

  it.each([
    ["an absolute URL", "https://evil.test/portal/quotations/1"],
    ["a protocol-relative URL", "//evil.test/portal"],
    ["a script URL", "javascript:alert(1)"],
    ["a page outside the signed-in areas", "/login"],
    ["a path without a leading slash", "portal/quotations/1"],
    ["a backslash path", "/portal\\..\\evil"],
    ["a path with a dot segment", "/portal/../login"],
    ["an empty path", ""],
  ])("refuses %s as a link", (_name, linkPath) => {
    expect(() => {
      validateNotificationContent({ ...VALID, linkPath });
    }).toThrow(NotificationValidationError);
  });

  it("does not echo the offending link in the error", () => {
    let message = "";
    try {
      validateNotificationContent({ ...VALID, linkPath: "https://evil.test/secret-token-123" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("linkPath");
    expect(message).not.toContain("secret-token-123");
  });

  it("refuses an empty, over-long or multi-line title", () => {
    for (const title of ["", "   ", "x".repeat(NOTIFICATION_TITLE_MAX_LENGTH + 1), "Two\nlines"]) {
      expect(() => {
        validateNotificationContent({ ...VALID, title });
      }).toThrow(NotificationValidationError);
    }
    expect(() => {
      validateNotificationContent({ ...VALID, title: "x".repeat(NOTIFICATION_TITLE_MAX_LENGTH) });
    }).not.toThrow();
  });

  it("refuses an empty or over-long message", () => {
    for (const message of ["", " ", "x".repeat(NOTIFICATION_MESSAGE_MAX_LENGTH + 1)]) {
      expect(() => {
        validateNotificationContent({ ...VALID, message });
      }).toThrow(NotificationValidationError);
    }
  });

  it("refuses a type that is not a known notification type", () => {
    expect(() => {
      validateNotificationContent({ ...VALID, type: "SOMETHING_ELSE" as never });
    }).toThrow(NotificationValidationError);
  });

  it("refuses an entity id that is not a UUID", () => {
    expect(() => {
      validateNotificationContent({ ...VALID, entity: { type: "QUOTATION", id: "not-a-uuid" } });
    }).toThrow(NotificationValidationError);
  });
});

describe("validateRecipient", () => {
  it("accepts a UUID and refuses anything else", () => {
    expect(() => {
      validateRecipient("0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
    }).not.toThrow();
    for (const bad of ["", "admin", "1", "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a1"]) {
      expect(() => {
        validateRecipient(bad);
      }).toThrow(NotificationValidationError);
    }
  });
});
