import type { ApiErrorBody, ApiResponse, PaginatedResponse } from "@fixflow/shared";
import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { buildTestApp, TEST_WEB_ORIGIN, type TestApp } from "../test/build-test-app.js";
import { bodyOf, expectApiError } from "../test/http.js";
import { errorHandler } from "./error-handler.js";
import { validate } from "./validate.js";

const BASE = "/api/v1/__test__";
const ORDER_ID = "7b0f9a52-52c2-4d4e-9d46-0d2d8f3f0a11";
const validBody = {
  customerName: "Alex Morgan",
  lines: [{ description: "Condenser clean", quantity: 2 }],
};

type ItemsBody = PaginatedResponse<{ id: string }> & {
  meta: { prisma: { skip: number; take: number; orderBy: unknown[] }; search: string | null };
};

let testApp: TestApp;

beforeAll(() => {
  testApp = buildTestApp({ testRoutes: true });
});

describe("validate()", () => {
  it("passes parsed params, query and body to the handler", async () => {
    const response = await request(testApp.app)
      .post(`${BASE}/orders/${ORDER_ID}`)
      .set("Origin", TEST_WEB_ORIGIN)
      .send(validBody);

    expect(response.status).toBe(200);
    expect(bodyOf<ApiResponse<unknown>>(response).data).toEqual({
      params: { orderId: ORDER_ID },
      query: { dryRun: "false" },
      body: validBody,
    });
  });

  it("replaces the raw input with the parsed values (defaults and coercion applied)", async () => {
    const response = await request(testApp.app)
      .post(`${BASE}/orders/${ORDER_ID}?dryRun=true&ignored=1`)
      .set("Origin", TEST_WEB_ORIGIN)
      .send(validBody);

    expect(bodyOf<ApiResponse<{ query: unknown }>>(response).data.query).toEqual({
      dryRun: "true",
    });
  });

  it("reports params, query and body errors together, keyed by dotted path", async () => {
    const response = await request(testApp.app)
      .post(`${BASE}/orders/not-a-uuid?dryRun=maybe`)
      .set("Origin", TEST_WEB_ORIGIN)
      .send({
        customerName: "A",
        lines: [
          { description: "Filter", quantity: 1 },
          { description: "Gas", quantity: 2 },
          { description: "Labour", quantity: -1 },
        ],
      });

    const error = expectApiError(response, { status: 422, code: "VALIDATION_ERROR" });
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual([
      "customerName",
      "dryRun",
      "lines.2.quantity",
      "orderId",
    ]);
  });

  it("rejects unknown body keys", async () => {
    const response = await request(testApp.app)
      .post(`${BASE}/orders/${ORDER_ID}`)
      .set("Origin", TEST_WEB_ORIGIN)
      .send({
        ...validBody,
        role: "BUSINESS_ADMIN",
        lines: [{ description: "x", quantity: 1, price: 0 }],
      });

    const error = expectApiError(response, { status: 422, code: "VALIDATION_ERROR" });
    expect(error.fieldErrors).toEqual({
      role: "Unknown field.",
      "lines.0.price": "Unknown field.",
    });
  });

  it("reports each required field when the body is missing, rather than one vague error", async () => {
    const response = await request(testApp.app)
      .post(`${BASE}/orders/${ORDER_ID}`)
      .set("Origin", TEST_WEB_ORIGIN);

    const error = expectApiError(response, { status: 422, code: "VALIDATION_ERROR" });
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(["customerName", "lines"]);
  });

  it("ignores a body that was not sent as JSON", async () => {
    // A bare app, without the CSRF layer: that layer (D-11) rejects non-JSON bodies with 400
    // before validation ever runs, which csrf.test.ts covers. This is about validate() itself.
    const bare = express();
    bare.use(express.json());
    bare.post(
      "/orders",
      validate({ body: z.strictObject({ customerName: z.string().min(2) }) }),
      (_req, res) => {
        res.json({ data: { ok: true } });
      },
    );
    bare.use(errorHandler);

    const response = await request(bare)
      .post("/orders")
      .set("Content-Type", "text/plain")
      .send(JSON.stringify(validBody));

    expect(response.status).toBe(422);
    expect(bodyOf<ApiErrorBody>(response).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a body that was not sent as JSON before it reaches validation (D-11)", async () => {
    const response = await request(testApp.app)
      .post(`${BASE}/orders/${ORDER_ID}`)
      .set("Origin", TEST_WEB_ORIGIN)
      .set("Content-Type", "text/plain")
      .send(JSON.stringify(validBody));

    expectApiError(response, { status: 400, code: "BAD_REQUEST" });
  });

  it("does not run the handler when validation fails", async () => {
    const { app, logs } = buildTestApp({ testRoutes: true, logLevel: "info" });

    const response = await request(app)
      .post(`${BASE}/orders/${ORDER_ID}`)
      .set("Origin", TEST_WEB_ORIGIN)
      .send({});

    expect(response.status).toBe(422);
    expect(bodyOf<Partial<ApiResponse<unknown>>>(response).data).toBeUndefined();
    expect(logs.entries().some((entry) => entry.level === "error")).toBe(false);
  });
});

describe("pagination through validate()", () => {
  it("applies the defaults", async () => {
    const response = await request(testApp.app).get(`${BASE}/items`);

    expect(response.status).toBe(200);
    expect(bodyOf<ItemsBody>(response).pagination).toEqual({
      page: 1,
      pageSize: 20,
      totalItems: 45,
      totalPages: 3,
    });
    expect(bodyOf<ItemsBody>(response).meta.prisma).toEqual({
      skip: 0,
      take: 20,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  });

  it("turns page, pageSize, sort and order into skip, take and orderBy", async () => {
    const response = await request(testApp.app).get(
      `${BASE}/items?page=3&pageSize=10&sort=name&order=asc&search=filter`,
    );

    expect(response.status).toBe(200);
    expect(bodyOf<ItemsBody>(response).pagination).toEqual({
      page: 3,
      pageSize: 10,
      totalItems: 45,
      totalPages: 5,
    });
    expect(bodyOf<ItemsBody>(response).meta).toEqual({
      prisma: { skip: 20, take: 10, orderBy: [{ name: "asc" }, { id: "asc" }] },
      search: "filter",
    });
  });

  it("accepts the maximum page size", async () => {
    const response = await request(testApp.app).get(`${BASE}/items?pageSize=100`);

    expect(response.status).toBe(200);
    expect(bodyOf<ItemsBody>(response).meta.prisma.take).toBe(100);
  });

  it("rejects pageSize above 100 with 422", async () => {
    const response = await request(testApp.app).get(`${BASE}/items?pageSize=101`);

    const error = expectApiError(response, { status: 422, code: "VALIDATION_ERROR" });
    expect(error.fieldErrors).toEqual({ pageSize: "pageSize must be at most 100." });
  });

  it("rejects a sort field that is not allowlisted with 422", async () => {
    const response = await request(testApp.app).get(`${BASE}/items?sort=passwordHash`);

    const error = expectApiError(response, { status: 422, code: "VALIDATION_ERROR" });
    expect(error.fieldErrors).toEqual({ sort: "sort must be one of: createdAt, name." });
  });

  it("rejects an invalid order with 422", async () => {
    const response = await request(testApp.app).get(`${BASE}/items?order=sideways`);

    const error = expectApiError(response, { status: 422, code: "VALIDATION_ERROR" });
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["order"]);
  });

  it.each(["page=0", "page=-1", "page=abc", "pageSize=0", "pageSize=1.5"])(
    "rejects %s with 422",
    async (query) => {
      const response = await request(testApp.app).get(`${BASE}/items?${query}`);

      expectApiError(response, { status: 422, code: "VALIDATION_ERROR" });
    },
  );

  it("rejects repeated parameters instead of silently picking one", async () => {
    const response = await request(testApp.app).get(`${BASE}/items?page=1&page=2`);

    expectApiError(response, { status: 422, code: "VALIDATION_ERROR" });
  });
});
