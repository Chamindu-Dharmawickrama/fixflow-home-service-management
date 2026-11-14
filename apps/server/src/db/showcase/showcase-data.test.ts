import { LIMITS } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS, DEMO_SERVICES } from "../seed-data.js";
import {
  DEMO_CUSTOMER_EXTRAS,
  PLANS,
  SHOWCASE_CUSTOMERS,
  SHOWCASE_TECHNICIAN,
  TECHNICIAN_NAMES,
} from "./showcase-data.js";

const FICTIONAL_PHONE = /^\(\d{3}\) 555-01\d\d$/;

describe("the showcase cast", () => {
  it("uses only reserved .test addresses and phone numbers in the fictional 555-01xx range", () => {
    for (const customer of SHOWCASE_CUSTOMERS) {
      expect(customer.email).toMatch(/\.test$/);
      expect(customer.phone).toMatch(FICTIONAL_PHONE);
    }
    expect(SHOWCASE_TECHNICIAN.email).toMatch(/\.test$/);
    expect(SHOWCASE_TECHNICIAN.phone).toMatch(FICTIONAL_PHONE);
  });

  it("has distinct customers, none of them a demo account", () => {
    const emails = SHOWCASE_CUSTOMERS.map((customer) => customer.email);
    expect(new Set(emails).size).toBe(emails.length);
    const keys = SHOWCASE_CUSTOMERS.map((customer) => customer.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const demo of DEMO_ACCOUNTS) {
      expect(emails).not.toContain(demo.email);
    }
  });

  it("gives every customer between one and three addresses, the demo customers included", () => {
    for (const customer of SHOWCASE_CUSTOMERS) {
      expect(customer.addresses.length).toBeGreaterThanOrEqual(1);
      expect(customer.addresses.length).toBeLessThanOrEqual(3);
    }
    // The base seed gives each demo customer one address; the showcase adds one or two.
    for (const [key, extras] of Object.entries(DEMO_CUSTOMER_EXTRAS)) {
      expect(["alex", "priya"]).toContain(key);
      expect(extras.addresses.length + 1).toBeLessThanOrEqual(3);
    }
  });

  it("has the fourth technician with a calendar colour of her own", () => {
    expect(Object.values(TECHNICIAN_NAMES)).toContain(SHOWCASE_TECHNICIAN.name);
    expect(new Set(Object.values(TECHNICIAN_NAMES)).size).toBe(4);
  });
});

describe("the showcase stories", () => {
  const customerKeys = new Set([
    ...SHOWCASE_CUSTOMERS.map((customer) => customer.key),
    ...Object.keys(DEMO_CUSTOMER_EXTRAS),
  ]);
  const slugs = new Set(DEMO_SERVICES.map((service) => service.slug));

  it("has one story per label", () => {
    const labels = PLANS.map((plan) => plan.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("names customers, services and technicians that exist", () => {
    for (const plan of PLANS) {
      expect(customerKeys, plan.label).toContain(plan.customer);
      expect(slugs, plan.label).toContain(plan.service);
      if (plan.schedule !== undefined) {
        expect(Object.keys(TECHNICIAN_NAMES), plan.label).toContain(plan.schedule.technician);
      }
    }
  });

  it("writes realistic, specific problem descriptions of the length the form allows", () => {
    for (const plan of PLANS) {
      const length = plan.description.length;
      expect(length, plan.label).toBeGreaterThanOrEqual(LIMITS.requestDescription.minLength);
      expect(length, plan.label).toBeLessThanOrEqual(LIMITS.requestDescription.maxLength);
      expect(plan.description, plan.label).not.toMatch(/lorem|ipsum|test test/i);
    }
  });

  it("prices every line plausibly, with two-place unit prices and a positive quantity", () => {
    const lines = PLANS.flatMap((plan) => [
      ...(plan.quote?.lines ?? []),
      ...(plan.quote?.replacement?.extraLines ?? []),
      ...(plan.quote?.expires?.lines ?? []),
      ...(plan.invoice?.extraLines ?? []),
    ]);
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) {
      expect(line.unitPrice).toMatch(/^\d+\.\d{2}$/);
      expect(Number(line.unitPrice)).toBeGreaterThan(0);
      expect(Number(line.unitPrice)).toBeLessThan(1000);
      expect(Number(line.quantity)).toBeGreaterThan(0);
      expect(line.description.length).toBeGreaterThan(5);
    }
  });

  it("puts every moment of a story in order: a request is sent, then reviewed, then quoted, then answered", () => {
    const at = (moment: readonly [number, string]) => moment[0] * 24 * 60 + hour(moment[1]);
    for (const plan of PLANS) {
      const sequence = [
        plan.submitted,
        plan.review,
        plan.quote?.sent,
        plan.decision?.at,
        plan.convert,
        plan.schedule?.at,
      ]
        .filter((moment): moment is readonly [number, string] => moment !== undefined)
        .map(at);
      expect(sequence, plan.label).toEqual([...sequence].sort((a, b) => a - b));
    }
  });

  it("never dates a request in the future, except through today's own time of day", () => {
    for (const plan of PLANS) {
      expect(plan.submitted[0], plan.label).toBeLessThanOrEqual(0);
    }
  });

  it("covers every request outcome the showcase promises", () => {
    const outcomes = {
      converted: PLANS.filter((plan) => plan.convert !== undefined).length,
      declined: PLANS.filter((plan) => plan.decision?.kind === "decline").length,
      cancelledRequest: PLANS.filter((plan) => plan.cancelRequest !== undefined).length,
      replaced: PLANS.filter((plan) => plan.quote?.replacement !== undefined).length,
      expired: PLANS.filter((plan) => plan.quote?.expires !== undefined).length,
      untouched: PLANS.filter((plan) => plan.review === undefined).length,
    };
    expect(outcomes).toEqual({
      converted: 13,
      declined: 1,
      cancelledRequest: 1,
      replaced: 1,
      expired: 1,
      untouched: 2,
    });
    expect(PLANS).toHaveLength(20);
  });
});

function hour(time: string): number {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}
