import { Role } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  canActAsAdmin,
  canActAsCustomer,
  decideGoogleLink,
  emailKeyPart,
  isAdminEmail,
  isDemoAccountEmail,
  isExpired,
  RESET_TOKEN_LIFETIME_MS,
  roleForNewAccount,
  SESSION_LIFETIME_MS,
  SESSION_RENEW_INTERVAL_MS,
  sessionExpiry,
  shouldRenewSession,
} from "./auth.domain.js";

const ADMINS = ["owner@coolbreeze.example", "admin@demo.fixflow.test"];
const NOW = new Date("2026-10-28T12:00:00.000Z");
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

describe("admin allowlist (D-08)", () => {
  it("matches normalized emails only", () => {
    expect(isAdminEmail("owner@coolbreeze.example", ADMINS)).toBe(true);
    expect(isAdminEmail("  Owner@CoolBreeze.Example ", ADMINS)).toBe(true);
    expect(isAdminEmail("someone@coolbreeze.example", ADMINS)).toBe(false);
    expect(isAdminEmail("owner@coolbreeze.example.evil.test", ADMINS)).toBe(false);
  });

  it("is empty-safe", () => {
    expect(isAdminEmail("owner@coolbreeze.example", [])).toBe(false);
  });

  it("makes an allowlisted new account an admin and everyone else a customer", () => {
    expect(roleForNewAccount("Owner@CoolBreeze.example", ADMINS)).toBe(Role.BUSINESS_ADMIN);
    expect(roleForNewAccount("alex.morgan@example.test", ADMINS)).toBe(Role.CUSTOMER);
  });
});

describe("canActAsAdmin", () => {
  const admin = { role: Role.BUSINESS_ADMIN, email: "owner@coolbreeze.example" } as const;

  it("needs the admin role and an allowlisted email", () => {
    expect(canActAsAdmin(admin, ADMINS)).toBe(true);
  });

  it("denies an admin whose email has left the allowlist, with no exemptions", () => {
    expect(canActAsAdmin(admin, ["someone.else@coolbreeze.example"])).toBe(false);
    expect(canActAsAdmin(admin, [])).toBe(false);
  });

  it("denies a customer even when their email is on the allowlist", () => {
    expect(canActAsAdmin({ role: Role.CUSTOMER, email: "owner@coolbreeze.example" }, ADMINS)).toBe(
      false,
    );
  });
});

describe("canActAsCustomer", () => {
  it("needs the customer role and a customer record", () => {
    expect(canActAsCustomer({ role: Role.CUSTOMER, customerId: "c1" })).toBe(true);
    expect(canActAsCustomer({ role: Role.CUSTOMER })).toBe(false);
    expect(canActAsCustomer({ role: Role.BUSINESS_ADMIN, customerId: "c1" })).toBe(false);
  });
});

describe("isDemoAccountEmail (D-09)", () => {
  it.each(["admin@demo.fixflow.test", "ALEX.MORGAN@example.test", "priya.shah@example.test"])(
    "recognises %s",
    (email) => {
      expect(isDemoAccountEmail(email)).toBe(true);
    },
  );

  it("does not recognise anyone else", () => {
    expect(isDemoAccountEmail("visitor@example.test")).toBe(false);
    expect(isDemoAccountEmail("owner@coolbreeze.example")).toBe(false);
  });
});

describe("decideGoogleLink (D-51)", () => {
  it("recognises an account already linked to the same Google identity", () => {
    expect(decideGoogleLink({ googleSubject: "sub-1", emailVerifiedAt: NOW }, "sub-1")).toEqual({
      kind: "already-linked",
    });
  });

  it("refuses an account linked to a different Google identity", () => {
    expect(decideGoogleLink({ googleSubject: "sub-1", emailVerifiedAt: NOW }, "sub-2")).toEqual({
      kind: "conflict",
    });
  });

  it("keeps the password of a verified local account when linking", () => {
    expect(decideGoogleLink({ googleSubject: null, emailVerifiedAt: NOW }, "sub-1")).toEqual({
      kind: "link",
      clearPasswordAndSessions: false,
    });
  });

  it("clears the password and sessions of an unverified local account (pre-hijacking)", () => {
    expect(decideGoogleLink({ googleSubject: null, emailVerifiedAt: null }, "sub-1")).toEqual({
      kind: "link",
      clearPasswordAndSessions: true,
    });
  });
});

describe("session timing (D-10)", () => {
  it("expires seven days after it starts", () => {
    expect(SESSION_LIFETIME_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(sessionExpiry(NOW).toISOString()).toBe("2026-11-04T12:00:00.000Z");
  });

  it("is expired at and after its expiry, not before", () => {
    expect(isExpired(at(1), NOW)).toBe(false);
    expect(isExpired(at(0), NOW)).toBe(true);
    expect(isExpired(at(-1), NOW)).toBe(true);
  });

  it("renews only after more than an hour of use", () => {
    expect(SESSION_RENEW_INTERVAL_MS).toBe(60 * 60 * 1000);
    expect(shouldRenewSession(at(-SESSION_RENEW_INTERVAL_MS), NOW)).toBe(false);
    expect(shouldRenewSession(at(-SESSION_RENEW_INTERVAL_MS - 1), NOW)).toBe(true);
    expect(shouldRenewSession(at(-1000), NOW)).toBe(false);
  });

  it("gives reset links sixty minutes", () => {
    expect(RESET_TOKEN_LIFETIME_MS).toBe(60 * 60 * 1000);
  });
});

describe("emailKeyPart", () => {
  it("is stable, normalized, fixed-length and does not contain the address", () => {
    const key = emailKeyPart("alex.morgan@example.test");

    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(emailKeyPart("  Alex.Morgan@Example.Test ")).toBe(key);
    expect(key).not.toContain("alex");
    expect(emailKeyPart("priya.shah@example.test")).not.toBe(key);
  });
});
