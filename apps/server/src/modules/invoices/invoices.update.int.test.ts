import {
  type AdminInvoiceDto,
  calculateDocumentTotals,
  ErrorCode,
  InvoiceStatus,
  LIMITS,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import {
  draftInvoice,
  getInvoiceRequest,
  invoiceFootprint,
  invoiceSnapshot,
  type InvoiceWorld,
  invoiceWorld,
  issued,
  patchInvoiceRequest,
  saveInvoice,
  saveInvoiceBody,
  voidInvoiceRequest,
} from "../../test/invoice-world.js";
import { dataOf, MISSING_ID } from "../../test/quotation-world.js";

const prisma = getTestPrisma();
let w: InvoiceWorld;

beforeEach(async () => {
  await resetDatabase(prisma);
  w = await invoiceWorld(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const EXTRA_PARTS = {
  description: "Contactor relay (extra part)",
  quantity: "2",
  unitPrice: "37.25",
  taxable: true,
};

describe("PATCH /admin/invoices/:id (FR-070, FR-071, BR-05)", () => {
  it("saves new lines and recomputes every total on the server", async () => {
    const { invoice: draft } = await draftInvoice(w);
    const lines = [
      ...draft.lines.map(({ description, quantity, unitPrice, taxable }) => ({
        description,
        quantity,
        unitPrice,
        taxable,
      })),
      EXTRA_PARTS,
    ];
    const expected = calculateDocumentTotals({ lines, discountAmount: "5.00", taxRate: "9.50" });

    const response = await patchInvoiceRequest(
      w,
      draft.id,
      saveInvoiceBody(draft, { lines, discountAmount: "5.00", taxRate: "9.50" }),
    );

    expect(response.status).toBe(200);
    const saved = dataOf<AdminInvoiceDto>(response);
    expect(saved.lines).toHaveLength(4);
    expect(saved.lines[3]).toMatchObject({
      position: 4,
      description: "Contactor relay (extra part)",
      quantity: "2.00",
      unitPrice: "37.25",
      lineTotal: "74.50",
    });
    expect(saved.subtotal).toBe(expected.subtotal);
    expect(saved.discountAmount).toBe("5.00");
    expect(saved.taxRate).toBe("9.50");
    expect(saved.taxableBase).toBe(expected.taxableBase);
    expect(saved.taxAmount).toBe(expected.taxAmount);
    expect(saved.totalAmount).toBe(expected.totalAmount);
    expect(saved.balanceDue).toBe(expected.totalAmount);
    expect(saved.updatedAt).not.toBe(draft.updatedAt);
    // What is stored is what was returned.
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.totalAmount.toFixed(2)).toBe(expected.totalAmount);
  });

  it("saves the dates and the note, and a null issue date means 'the day it is issued'", async () => {
    const { invoice: draft } = await draftInvoice(w);

    const saved = await saveInvoice(w, draft, {
      issueDate: "2026-03-05",
      dueDate: "2026-03-30",
      customerNote: "Thank you for your patience.",
    });
    expect(saved.issueDate).toBe("2026-03-05");
    expect(saved.dueDate).toBe("2026-03-30");
    expect(saved.customerNote).toBe("Thank you for your patience.");

    const cleared = await saveInvoice(w, saved, { issueDate: null, customerNote: null });
    expect(cleared.issueDate).toBeNull();
    expect(cleared.customerNote).toBeNull();
  });

  it("replaces the lines rather than adding to them", async () => {
    const { invoice: draft } = await draftInvoice(w);
    const saved = await saveInvoice(w, draft, { lines: [EXTRA_PARTS], discountAmount: "0.00" });
    expect(saved.lines.map((line) => line.description)).toEqual([EXTRA_PARTS.description]);
    expect(await prisma.invoiceLineItem.count({ where: { invoiceId: draft.id } })).toBe(1);
  });

  describe("totals are never taken from the client (BR-05)", () => {
    it.each([
      ["subtotal", "1.00"],
      ["taxableBase", "1.00"],
      ["taxAmount", "0.01"],
      ["totalAmount", "1.00"],
      ["amountPaid", "9999.00"],
      ["balanceDue", "0.00"],
      ["status", "PAID"],
      ["invoiceNumber", "INV-2026-99999"],
    ])(
      "refuses a body that names %s (422) and leaves the draft unchanged",
      async (field, value) => {
        const { invoice: draft } = await draftInvoice(w);
        const before = await invoiceSnapshot(prisma, draft.id);

        const response = await patchInvoiceRequest(w, draft.id, {
          ...saveInvoiceBody(draft),
          [field]: value,
        });

        expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
        expect(await invoiceSnapshot(prisma, draft.id)).toBe(before);
      },
    );

    it("refuses a line that names its own total", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const body = saveInvoiceBody(draft);
      const response = await patchInvoiceRequest(w, draft.id, {
        ...body,
        lines: body.lines.map((line) => ({ ...line, lineTotal: "0.01" })),
      });
      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    });
  });

  describe("validation (422, naming the field)", () => {
    it("requires between 1 and 50 lines", async () => {
      const { invoice: draft } = await draftInvoice(w);
      for (const lines of [
        [],
        Array.from({ length: LIMITS.lineItems.max + 1 }, () => EXTRA_PARTS),
      ]) {
        const error = expectApiError(
          await patchInvoiceRequest(w, draft.id, saveInvoiceBody(draft, { lines })),
          {
            status: 422,
            code: ErrorCode.VALIDATION_ERROR,
          },
        );
        expect(error.fieldErrors?.lines).toBe("Add between 1 and 50 lines.");
      }
      const fifty = await saveInvoice(w, draft, {
        lines: Array.from({ length: LIMITS.lineItems.max }, () => ({
          ...EXTRA_PARTS,
          quantity: "1",
          unitPrice: "1.00",
        })),
        discountAmount: "0.00",
      });
      expect(fifty.lines).toHaveLength(50);
    });

    it("names the field of a bad quantity, price and tax rate", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const error = expectApiError(
        await patchInvoiceRequest(
          w,
          draft.id,
          saveInvoiceBody(draft, {
            lines: [{ description: "Bad line", quantity: "0", unitPrice: "-1", taxable: true }],
            taxRate: "101",
          }),
        ),
        { status: 422, code: ErrorCode.VALIDATION_ERROR },
      );
      expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual([
        "lines.0.quantity",
        "lines.0.unitPrice",
        "taxRate",
      ]);
    });

    it("names the discount when it is more than the subtotal", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const error = expectApiError(
        await patchInvoiceRequest(
          w,
          draft.id,
          saveInvoiceBody(draft, { discountAmount: "9999.00" }),
        ),
        { status: 422, code: ErrorCode.VALIDATION_ERROR },
      );
      expect(Object.keys(error.fieldErrors ?? {})).toEqual(["discountAmount"]);
    });

    it("rejects a blank description and an overlong one", async () => {
      const { invoice: draft } = await draftInvoice(w);
      for (const description of ["   ", "x".repeat(LIMITS.lineDescription.maxLength + 1)]) {
        expectApiError(
          await patchInvoiceRequest(
            w,
            draft.id,
            saveInvoiceBody(draft, { lines: [{ ...EXTRA_PARTS, description }] }),
          ),
          { status: 422, code: ErrorCode.VALIDATION_ERROR },
        );
      }
    });

    it("requires a due date on or after the issue date", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const error = expectApiError(
        await patchInvoiceRequest(
          w,
          draft.id,
          saveInvoiceBody(draft, { issueDate: "2026-03-10", dueDate: "2026-03-09" }),
        ),
        { status: 422, code: ErrorCode.VALIDATION_ERROR },
      );
      expect(error.fieldErrors?.dueDate).toBe("The due date can't be before the issue date.");
      // The same day is allowed.
      const same = await saveInvoice(w, draft, { issueDate: "2026-03-10", dueDate: "2026-03-10" });
      expect(same.dueDate).toBe("2026-03-10");
    });

    it("rejects malformed dates, a missing expectedUpdatedAt and a note that is too long", async () => {
      const { invoice: draft } = await draftInvoice(w);
      for (const overrides of [
        { dueDate: "2026-02-30" },
        { dueDate: "next week" },
        { issueDate: "03/05/2026" },
        { customerNote: "x".repeat(LIMITS.notes.maxLength + 1) },
        { expectedUpdatedAt: "yesterday" },
      ]) {
        expectApiError(await patchInvoiceRequest(w, draft.id, saveInvoiceBody(draft, overrides)), {
          status: 422,
          code: ErrorCode.VALIDATION_ERROR,
        });
      }
      const { expectedUpdatedAt: _omitted, ...withoutVersion } = saveInvoiceBody(draft);
      expectApiError(await patchInvoiceRequest(w, draft.id, withoutVersion), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe("concurrent edits", () => {
    it("refuses a save made from an older version with 409 STALE_STATE", async () => {
      const { invoice: draft } = await draftInvoice(w);
      await saveInvoice(w, draft, { customerNote: "The first admin's note." });
      const before = await invoiceSnapshot(prisma, draft.id);

      const response = await patchInvoiceRequest(
        w,
        draft.id,
        saveInvoiceBody(draft, { customerNote: "The second admin's note." }),
      );

      expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
      expect(await invoiceSnapshot(prisma, draft.id)).toBe(before);
    });

    it("two saves from the same version: one wins, the other is 409", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const responses = await Promise.all([
        patchInvoiceRequest(w, draft.id, saveInvoiceBody(draft, { customerNote: "Note A" })),
        patchInvoiceRequest(w, draft.id, saveInvoiceBody(draft, { customerNote: "Note B" })),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    });
  });

  describe("an issued or voided invoice cannot be edited (BR-13)", () => {
    it("an issued invoice is 409 INVOICE_NOT_EDITABLE and the record is unchanged", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const invoice = await issued(w, draft.id);
      const before = await invoiceSnapshot(prisma, invoice.id);
      const footprint = await invoiceFootprint(w);

      const error = expectApiError(
        await patchInvoiceRequest(
          w,
          invoice.id,
          saveInvoiceBody(invoice, { lines: [EXTRA_PARTS], discountAmount: "0.00" }),
        ),
        { status: 409, code: ErrorCode.INVOICE_NOT_EDITABLE },
      );

      expect(error.details).toEqual({ currentStatus: "ISSUED" });
      expect(error.message).toContain("Void it");
      expect(await invoiceSnapshot(prisma, invoice.id)).toBe(before);
      expect(await invoiceFootprint(w)).toEqual(footprint);
      const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));
      expect(read.lines).toEqual(invoice.lines);
      expect(read.totalAmount).toBe(invoice.totalAmount);
    });

    it("every field is protected after issue, not only the lines", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const invoice = await issued(w, draft.id);
      const before = await invoiceSnapshot(prisma, invoice.id);
      for (const overrides of [
        { discountAmount: "50.00" },
        { taxRate: "0.00" },
        { issueDate: "2026-01-01" },
        { dueDate: "2027-01-01" },
        { customerNote: "Changed after issue" },
      ]) {
        expectApiError(
          await patchInvoiceRequest(w, invoice.id, saveInvoiceBody(invoice, overrides)),
          {
            status: 409,
            code: ErrorCode.INVOICE_NOT_EDITABLE,
          },
        );
      }
      expect(await invoiceSnapshot(prisma, invoice.id)).toBe(before);
    });

    it("a voided invoice is 409 INVOICE_NOT_EDITABLE", async () => {
      const { invoice: draft } = await draftInvoice(w);
      await voidInvoiceRequest(w, draft.id, {
        reason: "Raised on the wrong job.",
        expectedStatus: "DRAFT",
      });
      const voided = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, draft.id));
      expect(voided.status).toBe(InvoiceStatus.VOID);
      const before = await invoiceSnapshot(prisma, draft.id);

      const error = expectApiError(
        await patchInvoiceRequest(
          w,
          draft.id,
          saveInvoiceBody(voided, { customerNote: "Late edit" }),
        ),
        { status: 409, code: ErrorCode.INVOICE_NOT_EDITABLE },
      );

      expect(error.message).toContain("voided");
      expect(await invoiceSnapshot(prisma, draft.id)).toBe(before);
    });
  });

  describe("access", () => {
    it("is 401 without a session, 403 for a customer and 404 for an unknown invoice", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const before = await invoiceSnapshot(prisma, draft.id);
      const body = saveInvoiceBody(draft, { customerNote: "Sneaky" });

      expectApiError(await w.client.patch(`/api/v1/admin/invoices/${draft.id}`).send(body), {
        status: 401,
        code: ErrorCode.UNAUTHENTICATED,
      });
      for (const cookie of [w.alexCookie, w.priyaCookie]) {
        expectApiError(await patchInvoiceRequest(w, draft.id, body, cookie), {
          status: 403,
          code: ErrorCode.FORBIDDEN,
        });
      }
      expectApiError(await patchInvoiceRequest(w, MISSING_ID, body), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      expect(await invoiceSnapshot(prisma, draft.id)).toBe(before);
    });
  });
});
