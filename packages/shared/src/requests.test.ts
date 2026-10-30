import { describe, expect, it } from "vitest";

import { PreferredWindow, ServiceRequestStatus } from "./enums.js";
import * as shared from "./index.js";
import {
  PREFERRED_WINDOW_ORDER,
  PREFERRED_WINDOWS,
  preferredWindowHours,
  preferredWindowText,
  REQUEST_NEXT_STEPS,
  REQUEST_STATUS_LABELS,
  requestNextStep,
  requestStatusLabel,
} from "./requests.js";

describe("preferred windows (D-35)", () => {
  it("are morning 08:00-12:00, afternoon 12:00-16:00 and evening 16:00-19:00", () => {
    expect(PREFERRED_WINDOWS.MORNING).toMatchObject({ startHour: 8, endHour: 12 });
    expect(PREFERRED_WINDOWS.AFTERNOON).toMatchObject({ startHour: 12, endHour: 16 });
    expect(PREFERRED_WINDOWS.EVENING).toMatchObject({ startHour: 16, endHour: 19 });
  });

  it("define every window of the enum, in the order they are offered", () => {
    expect(Object.keys(PREFERRED_WINDOWS).sort()).toEqual(Object.values(PreferredWindow).sort());
    expect(PREFERRED_WINDOW_ORDER).toEqual(["MORNING", "AFTERNOON", "EVENING"]);
  });

  it("each end after its start, within one day, and never overlap", () => {
    const windows = PREFERRED_WINDOW_ORDER.map((window) => PREFERRED_WINDOWS[window]);

    for (const { startHour, endHour } of windows) {
      expect(endHour).toBeGreaterThan(startHour);
      expect(startHour).toBeGreaterThanOrEqual(0);
      expect(endHour).toBeLessThanOrEqual(24);
    }
    windows.slice(1).forEach((window, index) => {
      expect(window.startHour).toBeGreaterThanOrEqual(windows[index]?.endHour ?? Infinity);
    });
  });

  it("read as clock times a customer understands", () => {
    expect(preferredWindowHours("MORNING")).toBe("8:00 AM – 12:00 PM");
    expect(preferredWindowHours("AFTERNOON")).toBe("12:00 PM – 4:00 PM");
    expect(preferredWindowHours("EVENING")).toBe("4:00 PM – 7:00 PM");
    expect(preferredWindowText("MORNING")).toBe("Morning (8:00 AM – 12:00 PM)");
  });
});

describe("request status wording", () => {
  const STATUSES = Object.values(ServiceRequestStatus);

  it("has a label and a next step for every status", () => {
    expect(Object.keys(REQUEST_STATUS_LABELS).sort()).toEqual([...STATUSES].sort());
    expect(Object.keys(REQUEST_NEXT_STEPS).sort()).toEqual([...STATUSES].sort());
    for (const status of STATUSES) {
      expect(requestStatusLabel(status).length).toBeGreaterThan(0);
      expect(requestNextStep(status).length).toBeGreaterThan(0);
    }
  });

  it("says what happens to a freshly submitted request", () => {
    expect(requestStatusLabel("SUBMITTED")).toBe("Submitted");
    expect(requestNextStep("SUBMITTED")).toBe(
      "We're reviewing your request and will send a quotation.",
    );
  });

  it("writes every next step as a sentence to the customer, ending with a full stop", () => {
    for (const status of STATUSES) {
      const text = requestNextStep(status);
      expect(text).toMatch(/^[A-Z]/);
      expect(text).toMatch(/\.$/);
      // No placeholder or developer wording leaks into customer text.
      expect(text).not.toMatch(/undefined|TODO|\{\{|\$\{/);
    }
  });

  it("gives different next steps to the statuses that need different things from the customer", () => {
    expect(new Set(STATUSES.map(requestNextStep)).size).toBe(STATUSES.length);
  });

  it("is re-exported from the package entry point", () => {
    expect(shared.requestNextStep).toBe(requestNextStep);
    expect(shared.PREFERRED_WINDOWS).toBe(PREFERRED_WINDOWS);
  });
});
