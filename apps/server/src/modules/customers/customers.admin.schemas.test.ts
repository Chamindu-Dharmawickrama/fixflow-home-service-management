import { LIMITS } from "@fixflow/shared";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import {
  addCustomerNoteBodySchema,
  adminCustomerIdParamsSchema,
  adminCustomersQuerySchema,
  customerHistoryQuerySchema,
} from "./customers.admin.schemas.js";

const UUID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

/** The field errors the API would return for this input; fails the test if the input is accepted. */
function errorsOf(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) {
    throw new Error("The input was accepted.");
  }
  return fieldErrorsFromZod(result.error);
}

describe("adminCustomersQuerySchema (FR-031)", () => {
  it("defaults to the first page, by name from A to Z, with no search", () => {
    expect(adminCustomersQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: "name",
      order: "asc",
    });
  });

  it("accepts the three sort fields, and no other", () => {
    for (const sort of ["name", "createdAt", "lastActivityAt"]) {
      expect(adminCustomersQuerySchema.parse({ sort }).sort).toBe(sort);
    }
    for (const sort of ["email", "phone", "requestCount", "id", "NAME", "name; DROP TABLE users"]) {
      expect(adminCustomersQuerySchema.safeParse({ sort }).success, sort).toBe(false);
    }
  });

  it("trims the search, collapses runs of spaces, and treats a blank one as none", () => {
    expect(adminCustomersQuerySchema.parse({ q: "  alex   morgan " }).q).toBe("alex morgan");
    expect(adminCustomersQuerySchema.parse({ q: "   " }).q).toBeUndefined();
    expect(adminCustomersQuerySchema.parse({ q: "" }).q).toBeUndefined();
  });

  it("keeps the characters of the search as they are", () => {
    expect(adminCustomersQuerySchema.parse({ q: "100%_\\'; --" }).q).toBe("100%_\\'; --");
  });

  it("refuses a search of more than 100 characters, and one given twice", () => {
    expect(adminCustomersQuerySchema.safeParse({ q: "a".repeat(100) }).success).toBe(true);
    expect(errorsOf(adminCustomersQuerySchema, { q: "a".repeat(101) })).toHaveProperty("q");
    expect(errorsOf(adminCustomersQuerySchema, { q: ["a", "b"] })).toHaveProperty("q");
  });

  it("applies the standard page limits", () => {
    expect(adminCustomersQuerySchema.parse({ page: "3", pageSize: "100" })).toMatchObject({
      page: 3,
      pageSize: 100,
    });
    expect(errorsOf(adminCustomersQuerySchema, { pageSize: "101" })).toHaveProperty("pageSize");
    expect(errorsOf(adminCustomersQuerySchema, { page: "0" })).toHaveProperty("page");
    expect(errorsOf(adminCustomersQuerySchema, { order: "sideways" })).toHaveProperty("order");
  });
});

describe("adminCustomerIdParamsSchema", () => {
  it("takes a UUID and nothing else", () => {
    expect(adminCustomerIdParamsSchema.parse({ id: UUID }).id).toBe(UUID);
    expect(errorsOf(adminCustomerIdParamsSchema, { id: "FF-2026-00012" })).toHaveProperty("id");
    expect(errorsOf(adminCustomerIdParamsSchema, { id: "alex" })).toHaveProperty("id");
  });
});

describe("customerHistoryQuerySchema", () => {
  it("needs a type, and takes the four kinds of record", () => {
    for (const type of ["requests", "quotations", "jobs", "invoices"]) {
      expect(customerHistoryQuerySchema.parse({ type })).toEqual({ type, page: 1, pageSize: 20 });
    }
    expect(errorsOf(customerHistoryQuerySchema, {})).toHaveProperty("type");
    expect(errorsOf(customerHistoryQuerySchema, { type: "payments" })).toHaveProperty("type");
    expect(errorsOf(customerHistoryQuerySchema, { type: "REQUESTS" })).toHaveProperty("type");
  });

  it("pages, and has no sort of its own", () => {
    expect(customerHistoryQuerySchema.parse({ type: "jobs", page: "2", pageSize: "5" })).toEqual({
      type: "jobs",
      page: 2,
      pageSize: 5,
    });
    const parsed = customerHistoryQuerySchema.parse({ type: "jobs", sort: "createdAt" });
    expect(parsed).not.toHaveProperty("sort");
    expect(errorsOf(customerHistoryQuerySchema, { type: "jobs", pageSize: "101" })).toHaveProperty(
      "pageSize",
    );
  });
});

describe("addCustomerNoteBodySchema (FR-033)", () => {
  it("trims the note and keeps its line breaks", () => {
    expect(addCustomerNoteBodySchema.parse({ body: "  Prefers calls.\nAfter 5pm only. " })).toEqual(
      {
        body: "Prefers calls.\nAfter 5pm only.",
      },
    );
  });

  it("needs a note, within the limit", () => {
    expect(errorsOf(addCustomerNoteBodySchema, {})).toHaveProperty("body");
    expect(errorsOf(addCustomerNoteBodySchema, { body: "   " })).toHaveProperty("body");
    expect(
      addCustomerNoteBodySchema.safeParse({ body: "a".repeat(LIMITS.notes.maxLength) }).success,
    ).toBe(true);
    expect(
      errorsOf(addCustomerNoteBodySchema, { body: "a".repeat(LIMITS.notes.maxLength + 1) }),
    ).toHaveProperty("body");
  });

  it("refuses any other key: there is no visibility, author or customer to send", () => {
    for (const extra of [
      { visibility: "CUSTOMER_VISIBLE" },
      { authorUserId: UUID },
      { customerId: UUID },
      { createdAt: "2026-01-01T00:00:00.000Z" },
    ]) {
      expect(addCustomerNoteBodySchema.safeParse({ body: "A note.", ...extra }).success).toBe(
        false,
      );
    }
  });
});
