import { InvoiceStatus, WorkOrderStatus } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { Prisma } from "../../generated/prisma/client.js";
import {
  customerSearchPatterns,
  invoiceBalanceDue,
  isOutstandingInvoice,
  OPEN_JOB_STATUSES,
  OUTSTANDING_INVOICE_STATUSES,
  outstandingBalance,
  phoneSearchDigits,
} from "./customers.admin.domain.js";

describe("open jobs", () => {
  it("are every job that is not completed or cancelled", () => {
    expect([...OPEN_JOB_STATUSES].sort()).toEqual(
      [
        WorkOrderStatus.PENDING_SCHEDULING,
        WorkOrderStatus.SCHEDULED,
        WorkOrderStatus.IN_PROGRESS,
        WorkOrderStatus.NEEDS_RESCHEDULING,
      ].sort(),
    );
  });

  it("leaves out exactly the closed statuses, whatever statuses exist", () => {
    const all = Object.values(WorkOrderStatus);
    const closed = all.filter((status) => !OPEN_JOB_STATUSES.includes(status));
    expect(closed.sort()).toEqual([WorkOrderStatus.CANCELLED, WorkOrderStatus.COMPLETED].sort());
  });
});

describe("outstanding invoices (D-26)", () => {
  it("are the issued, partially paid and overdue ones", () => {
    expect([...OUTSTANDING_INVOICE_STATUSES].sort()).toEqual(
      [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE].sort(),
    );
  });

  it.each([
    [InvoiceStatus.DRAFT, false],
    [InvoiceStatus.ISSUED, true],
    [InvoiceStatus.PARTIALLY_PAID, true],
    [InvoiceStatus.OVERDUE, true],
    [InvoiceStatus.PAID, false],
    [InvoiceStatus.VOID, false],
  ])("%s → %s", (status, expected) => {
    expect(isOutstandingInvoice(status)).toBe(expected);
  });
});

describe("invoiceBalanceDue", () => {
  it("is the total less the amount paid for an invoice that is owed", () => {
    expect(
      invoiceBalanceDue({ status: "PARTIALLY_PAID", totalAmount: "108.00", amountPaid: "40.25" }),
    ).toBe("67.75");
    expect(invoiceBalanceDue({ status: "ISSUED", totalAmount: "108.00", amountPaid: "0.00" })).toBe(
      "108.00",
    );
    expect(invoiceBalanceDue({ status: "OVERDUE", totalAmount: "20.10", amountPaid: "0.10" })).toBe(
      "20.00",
    );
  });

  it.each([InvoiceStatus.DRAFT, InvoiceStatus.PAID, InvoiceStatus.VOID])(
    "is 0.00 for a %s invoice, whatever its amounts",
    (status) => {
      expect(invoiceBalanceDue({ status, totalAmount: "108.00", amountPaid: "0.00" })).toBe("0.00");
    },
  );

  it("never goes below zero", () => {
    expect(invoiceBalanceDue({ status: "ISSUED", totalAmount: "10.00", amountPaid: "12.00" })).toBe(
      "0.00",
    );
  });

  it("is exact where a floating-point sum would not be", () => {
    // 0.1 + 0.2 and 0.3 − 0.1 are the classic float traps.
    expect(invoiceBalanceDue({ status: "ISSUED", totalAmount: "0.30", amountPaid: "0.10" })).toBe(
      "0.20",
    );
  });

  it("accepts the decimals the database returns", () => {
    expect(
      invoiceBalanceDue({
        status: "ISSUED",
        totalAmount: new Prisma.Decimal("1284.50"),
        amountPaid: new Prisma.Decimal("284.5"),
      }),
    ).toBe("1000.00");
  });
});

describe("outstandingBalance", () => {
  it("is 0.00 for a customer with no outstanding invoice", () => {
    expect(outstandingBalance({ totalAmount: null, amountPaid: null })).toBe("0.00");
  });

  it("is the sum of the totals less the sum of the payments", () => {
    expect(
      outstandingBalance({
        totalAmount: new Prisma.Decimal("216.00"),
        amountPaid: new Prisma.Decimal("40.50"),
      }),
    ).toBe("175.50");
  });

  it("treats a missing payment sum as nothing paid", () => {
    expect(outstandingBalance({ totalAmount: "108.00", amountPaid: null })).toBe("108.00");
  });

  it("is written with two places and does not round a large balance", () => {
    expect(outstandingBalance({ totalAmount: "1234567.89", amountPaid: "0" })).toBe("1234567.89");
    expect(outstandingBalance({ totalAmount: "50", amountPaid: "50" })).toBe("0.00");
  });
});

describe("phoneSearchDigits", () => {
  it.each([
    ["212", "212"],
    ["(212) 555", "212555"],
    ["212-555-0100", "2125550100"],
    ["212.555.0100", "2125550100"],
    ["+1 212 555", "1212555"],
    ["  212 555 ", "212555"],
  ])("%j → %j", (input, expected) => {
    expect(phoneSearchDigits(input)).toBe(expected);
  });

  it.each([
    "",
    "21",
    "(2)",
    "alex",
    "alex2125550100",
    "a@b.com",
    "212 abc",
    "FF-2026-00012",
    "2 1",
  ])("%j is not a phone search", (input) => {
    expect(phoneSearchDigits(input)).toBeUndefined();
  });
});

describe("customerSearchPatterns", () => {
  it("wraps the text in wildcards", () => {
    expect(customerSearchPatterns("alex")).toEqual({ text: "%alex%", phoneDigits: undefined });
  });

  it("takes the wildcard characters of the text literally", () => {
    expect(customerSearchPatterns("100%_\\").text).toBe("%100\\%\\_\\\\%");
  });

  it("adds the digits of a phone-like search", () => {
    expect(customerSearchPatterns("(212) 555")).toEqual({
      text: "%(212) 555%",
      phoneDigits: "%212555%",
    });
  });
});
