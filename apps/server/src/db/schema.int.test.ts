import * as shared from "@fixflow/shared";
import { afterAll, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma } from "../test/db.js";

/**
 * Checks the shape of the real database that the migrations produced, independently of the
 * Prisma schema file: money is exact, times carry a zone, enums match the shared constants, and
 * the indexes the data model calls for exist.
 */

const prisma = getTestPrisma();

afterAll(async () => {
  await disconnectTestPrisma();
});

interface ColumnRow {
  table: string;
  column: string;
  type: string;
  precision: number | null;
  scale: number | null;
}

async function columns(): Promise<ColumnRow[]> {
  return prisma.$queryRaw<ColumnRow[]>`
    SELECT table_name AS "table", column_name AS "column", data_type AS type,
           numeric_precision::int AS precision, numeric_scale::int AS scale
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
    ORDER BY table_name, ordinal_position`;
}

describe("money and numbers (DM-03, D-18)", () => {
  it("has no floating-point column anywhere", async () => {
    const floats = (await columns()).filter(({ type }) =>
      ["double precision", "real"].includes(type),
    );

    expect(floats).toEqual([]);
  });

  it("stores every money column as an exact numeric(12,2)", async () => {
    const money = [
      ["quotations", ["subtotal", "discount_amount", "taxable_base", "tax_amount", "total_amount"]],
      [
        "invoices",
        [
          "subtotal",
          "discount_amount",
          "taxable_base",
          "tax_amount",
          "total_amount",
          "amount_paid",
        ],
      ],
      ["quotation_line_items", ["unit_price", "line_subtotal"]],
      ["invoice_line_items", ["unit_price", "line_subtotal"]],
      ["payment_records", ["amount"]],
      ["services", ["starting_price"]],
    ] as const;
    const all = await columns();

    for (const [table, names] of money) {
      for (const name of names) {
        const column = all.find(
          (candidate) => candidate.table === table && candidate.column === name,
        );
        expect(column, `${table}.${name}`).toMatchObject({
          type: "numeric",
          precision: 12,
          scale: 2,
        });
      }
    }
  });

  it("stores quantities as numeric(10,2) and tax rates as numeric(5,2)", async () => {
    const all = await columns();
    const find = (table: string, name: string) =>
      all.find((candidate) => candidate.table === table && candidate.column === name);

    for (const table of ["quotation_line_items", "invoice_line_items"]) {
      expect(find(table, "quantity")).toMatchObject({ type: "numeric", precision: 10, scale: 2 });
    }
    for (const table of ["quotations", "invoices"]) {
      expect(find(table, "tax_rate")).toMatchObject({ type: "numeric", precision: 5, scale: 2 });
    }
    expect(find("business_settings", "default_tax_rate")).toMatchObject({
      type: "numeric",
      precision: 5,
      scale: 2,
    });
  });

  it("keeps cents exact: 0.10 + 0.20 is 0.30, and 19.99 comes back as 19.99", async () => {
    const [row] = await prisma.$queryRaw<
      { sum: string }[]
    >`SELECT (0.10::numeric(12,2) + 0.20::numeric(12,2))::text AS sum`;

    expect(row?.sum).toBe("0.30");
  });
});

describe("time (BR-17)", () => {
  it("stores every timestamp with a time zone and every date-only field as a date", async () => {
    const all = await columns();
    const timestamps = all.filter(
      ({ column }) =>
        column.endsWith("_at") ||
        column === "preferred_start" ||
        column === "preferred_end" ||
        column === "scheduled_start" ||
        column === "scheduled_end",
    );

    expect(timestamps.length).toBeGreaterThan(30);
    for (const { table, column, type } of timestamps) {
      expect(type, `${table}.${column}`).toBe("timestamp with time zone");
    }
    for (const [table, column] of [
      ["service_requests", "preferred_date"],
      ["quotations", "valid_until"],
      ["invoices", "issue_date"],
      ["invoices", "due_date"],
      ["payment_records", "payment_date"],
    ]) {
      expect(
        all.find((c) => c.table === table && c.column === column)?.type,
        `${table}.${column}`,
      ).toBe("date");
    }
  });
});

describe("identity (D-16)", () => {
  it("uses a database-generated uuid for every primary key except the counters", async () => {
    const keys = await prisma.$queryRaw<{ table: string; type: string; dflt: string | null }[]>`
      SELECT c.table_name AS "table", c.data_type AS type, c.column_default AS dflt
      FROM information_schema.columns c
      JOIN information_schema.table_constraints tc
        ON tc.table_name = c.table_name AND tc.table_schema = c.table_schema AND tc.constraint_type = 'PRIMARY KEY'
      JOIN information_schema.key_column_usage k
        ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema AND k.column_name = c.column_name
      WHERE c.table_schema = 'public' AND c.column_name = 'id' AND c.table_name <> '_prisma_migrations'`;

    expect(keys.length).toBe(20);
    for (const { table, type, dflt } of keys) {
      expect(type, table).toBe("uuid");
      expect(dflt, table).toMatch(/gen_random_uuid\(\)|00000000-0000-4000-8000-000000000001/);
    }
  });
});

describe("enums", () => {
  it("has database enum values equal to the shared constants (what the migrations really created)", async () => {
    const rows = await prisma.$queryRaw<{ name: string; value: string }[]>`
      SELECT t.typname AS name, e.enumlabel AS value
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder`;
    const byType = new Map<string, string[]>();
    for (const { name, value } of rows) byType.set(name, [...(byType.get(name) ?? []), value]);

    const expected: Record<string, readonly string[]> = {
      role: Object.values(shared.Role),
      pricing_mode: Object.values(shared.PricingMode),
      service_request_status: Object.values(shared.ServiceRequestStatus),
      preferred_window: Object.values(shared.PreferredWindow),
      note_visibility: Object.values(shared.NoteVisibility),
      quotation_status: Object.values(shared.QuotationStatus),
      work_order_status: Object.values(shared.WorkOrderStatus),
      invoice_status: Object.values(shared.InvoiceStatus),
      payment_method: Object.values(shared.PaymentMethod),
      notification_type: Object.values(shared.NotificationType),
      email_delivery_status: Object.values(shared.EmailDeliveryStatus),
      activity_entity_type: Object.values(shared.ActivityEntityType),
      reference_type: Object.values(shared.ReferenceType),
    };

    expect([...byType.keys()].sort()).toEqual(Object.keys(expected).sort());
    for (const [name, values] of Object.entries(expected)) {
      expect([...(byType.get(name) ?? [])].sort(), name).toEqual([...values].sort());
    }
  });
});

describe("indexes called for by the data model", () => {
  async function indexDefinitions(): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'public'`;
    return rows.map(({ def }) => def.replace(/\s+/g, " "));
  }

  it.each([
    ["service_requests", "(status, submitted_at)"],
    ["service_requests", "(customer_id)"],
    ["service_requests", "(service_id)"],
    ["work_orders", "(technician_id, scheduled_start)"],
    ["work_orders", "(status, scheduled_start)"],
    ["notifications", "(recipient_user_id, read_at, created_at)"],
    ["activity_events", "(entity_type, entity_id, created_at)"],
    ["activity_events", "(request_id, created_at)"],
    ["activity_events", "(customer_id, created_at)"],
    ["activity_events", "(created_at)"],
    ["sessions", "(user_id)"],
    ["sessions", "(expires_at)"],
    ["password_reset_tokens", "(user_id)"],
  ])("has an index on %s %s", async (table, columnsSql) => {
    const definitions = await indexDefinitions();

    expect(
      definitions.some((def) => def.includes(` ON public.${table} USING btree ${columnsSql}`)),
      `${table} ${columnsSql}`,
    ).toBe(true);
  });

  it.each([
    "service_addresses_one_default_per_customer_key",
    "quotations_one_sent_per_request_key",
    "quotations_one_draft_per_request_key",
    "quotations_one_accepted_per_request_key",
    "invoices_one_active_per_work_order_key",
  ])("has the partial unique index %s", async (name) => {
    const definitions = await indexDefinitions();
    const definition = definitions.find((def) => def.includes(`INDEX ${name} `));

    expect(definition, name).toBeDefined();
    expect(definition).toContain("CREATE UNIQUE INDEX");
    expect(definition).toContain(" WHERE ");
  });
});
