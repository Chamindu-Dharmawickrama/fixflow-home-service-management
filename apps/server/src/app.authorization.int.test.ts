import { ErrorCode } from "@fixflow/shared";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RateLimitName } from "./lib/rate-limit/index.js";
import { createLocalAdmin, createLocalCustomer, signInAs } from "./test/auth-helpers.js";
import { buildTestApp } from "./test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "./test/db.js";
import { createBusinessSettings } from "./test/fixtures.js";
import { api, bodyOf } from "./test/http.js";
import { listRegisteredRoutes } from "./test/route-inventory.js";

/**
 * The authorization matrix (T25, FR-012, SEC-AUTH-03, TS-INT-01, API-02). Every route the app
 * registers is found by walking Express's router (`listRegisteredRoutes`), and every one must have
 * an entry below: **a route added without an entry fails the first test**, and an entry whose route
 * is gone fails it too. Each entry names who may call the route:
 *
 * - `public`: reachable without a session (never `401` or `403`);
 * - `signed-in`: any role (`401` without a session, never `403` for a customer or an admin);
 * - `customer`: `401` without a session, `403` for an admin;
 * - `admin`: `401` without a session, `403` for a customer.
 *
 * The probes carry no body and unknown ids, so the guard is the only thing that can answer `401` or
 * `403`, and nothing is changed by a probe that gets through (it ends in `404` or `422`). Each
 * abuse-prone route also names the rate limit that must refuse a burst; that is checked by making only
 * that limit tight and sending the same request twice.
 */

type Access = "public" | "signed-in" | "customer" | "admin";

interface MatrixEntry {
  access: Access;
  /**
   * The named limit that must refuse a burst (CLAUDE.md §9: auth, demo login and abuse-prone writes).
   * Every route that is not a `GET` must name one; a few reads do too (PDF, exports, notifications).
   */
  limit?: RateLimitName;
  /** A body for the burst check, when the limit is counted after validation (keyed by the body). */
  limitBody?: object;
}

const MATRIX: Record<string, MatrixEntry> = {
  // ---- Public ------------------------------------------------------------------------------
  "GET /api/v1/health": { access: "public" },
  "GET /api/v1/health/ready": { access: "public" },
  "POST /api/v1/auth/register": { access: "public", limit: "register" },
  "POST /api/v1/auth/login": { access: "public", limit: "login" },
  "POST /api/v1/auth/google": { access: "public", limit: "google" },
  "POST /api/v1/auth/password/forgot": { access: "public", limit: "forgotIp" },
  "POST /api/v1/auth/password/reset": { access: "public", limit: "reset" },
  "POST /api/v1/auth/logout": { access: "public", limit: "logout" },
  "GET /api/v1/settings/public": { access: "public" },
  "GET /api/v1/services": { access: "public" },
  "GET /api/v1/services/slug/:slug": { access: "public" },
  "GET /api/v1/services/:id": { access: "public" },

  // ---- Any signed-in person (ownership is the service's job: 404 for another's record) -----
  "GET /api/v1/auth/me": { access: "signed-in" },
  "POST /api/v1/auth/password/change": { access: "signed-in", limit: "passwordChange" },
  "GET /api/v1/notifications/me": { access: "signed-in", limit: "notificationsRead" },
  "POST /api/v1/notifications/me/read-all": { access: "signed-in", limit: "notificationsWrite" },
  "PATCH /api/v1/notifications/:id/read": { access: "signed-in", limit: "notificationsWrite" },
  "GET /api/v1/requests/:id": { access: "signed-in" },
  "GET /api/v1/quotations/:id": { access: "signed-in" },
  "GET /api/v1/work-orders/:id": { access: "signed-in" },
  "GET /api/v1/invoices/:id": { access: "signed-in" },
  "GET /api/v1/invoices/:id/pdf": { access: "signed-in", limit: "invoicePdf" },

  // ---- Customers only ------------------------------------------------------------------------
  "GET /api/v1/customers/me": { access: "customer" },
  "GET /api/v1/customers/me/overview": { access: "customer" },
  "PATCH /api/v1/customers/me": { access: "customer", limit: "customerWrite" },
  "GET /api/v1/customers/me/addresses": { access: "customer" },
  "POST /api/v1/customers/me/addresses": { access: "customer", limit: "customerWrite" },
  "PATCH /api/v1/customers/me/addresses/:id": { access: "customer", limit: "customerWrite" },
  "DELETE /api/v1/customers/me/addresses/:id": { access: "customer", limit: "customerWrite" },
  "POST /api/v1/customers/me/addresses/:id/default": {
    access: "customer",
    limit: "customerWrite",
  },
  "POST /api/v1/requests": { access: "customer", limit: "requestSubmit" },
  "GET /api/v1/requests/me": { access: "customer" },
  "GET /api/v1/quotations/me": { access: "customer" },
  "POST /api/v1/quotations/:id/accept": { access: "customer", limit: "quotationDecision" },
  "POST /api/v1/quotations/:id/decline": { access: "customer", limit: "quotationDecision" },
  "GET /api/v1/work-orders/me": { access: "customer" },
  "GET /api/v1/invoices/me": { access: "customer" },

  // ---- The business --------------------------------------------------------------------------
  "GET /api/v1/admin/settings": { access: "admin" },
  "PATCH /api/v1/admin/settings": { access: "admin", limit: "adminWrite" },
  "GET /api/v1/admin/services": { access: "admin" },
  "GET /api/v1/admin/services/:id": { access: "admin" },
  "POST /api/v1/admin/services": { access: "admin", limit: "adminWrite" },
  "PATCH /api/v1/admin/services/:id": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/services/:id/archive": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/services/:id/restore": { access: "admin", limit: "adminWrite" },
  "GET /api/v1/admin/requests": { access: "admin" },
  "GET /api/v1/admin/requests/:id": { access: "admin" },
  "PATCH /api/v1/admin/requests/:id/status": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/requests/:id/notes": { access: "admin", limit: "adminWrite" },
  "GET /api/v1/admin/customers": { access: "admin" },
  "GET /api/v1/admin/customers/:id": { access: "admin" },
  "GET /api/v1/admin/customers/:id/history": { access: "admin" },
  "POST /api/v1/admin/customers/:id/notes": { access: "admin", limit: "adminWrite" },
  "GET /api/v1/admin/technicians": { access: "admin" },
  "GET /api/v1/admin/technicians/assignable": { access: "admin" },
  "GET /api/v1/admin/technicians/:id": { access: "admin" },
  "POST /api/v1/admin/technicians": { access: "admin", limit: "adminWrite" },
  "PATCH /api/v1/admin/technicians/:id": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/technicians/:id/deactivate": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/technicians/:id/activate": { access: "admin", limit: "adminWrite" },
  "GET /api/v1/admin/dashboard/summary": { access: "admin" },
  "GET /api/v1/admin/exports/requests.csv": { access: "admin", limit: "adminExport" },
  "GET /api/v1/admin/exports/jobs.csv": { access: "admin", limit: "adminExport" },
  "GET /api/v1/admin/exports/invoices.csv": { access: "admin", limit: "adminExport" },
  "POST /api/v1/admin/requests/:id/quotations": { access: "admin", limit: "adminWrite" },
  "GET /api/v1/admin/quotations/:id": { access: "admin" },
  "PATCH /api/v1/admin/quotations/:id": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/quotations/:id/send": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/quotations/:id/void": { access: "admin", limit: "adminWrite" },
  "GET /api/v1/admin/calendar": { access: "admin" },
  "POST /api/v1/admin/quotations/:id/work-order": { access: "admin", limit: "adminWrite" },
  "GET /api/v1/admin/work-orders": { access: "admin" },
  "GET /api/v1/admin/work-orders/conflicts": { access: "admin" },
  "GET /api/v1/admin/work-orders/:id": { access: "admin" },
  "PATCH /api/v1/admin/work-orders/:id/schedule": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/work-orders/:id/transitions": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/work-orders/:id/invoice": { access: "admin", limit: "adminWrite" },
  "GET /api/v1/admin/invoices": { access: "admin" },
  "GET /api/v1/admin/invoices/:id": { access: "admin" },
  "PATCH /api/v1/admin/invoices/:id": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/invoices/:id/issue": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/invoices/:id/void": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/invoices/:id/payments": { access: "admin", limit: "adminWrite" },
  "POST /api/v1/admin/invoices/:id/payments/:paymentId/void": {
    access: "admin",
    limit: "adminWrite",
  },
};

/** An id that names nothing, so a probe that passes the guard can only end in `404` or `422`. */
const UNKNOWN_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

/** The route's path with every parameter filled in. */
function probePath(path: string): string {
  return path.replace(/:slug\b/g, "no-such-service").replace(/:[A-Za-z]+/g, UNKNOWN_ID);
}

type Method = "get" | "post" | "patch" | "put" | "delete";

function call(
  app: Express,
  key: string,
  options: { cookie?: string; body?: object } = {},
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const [method = "", path = ""] = key.split(" ");
  const verb = method.toLowerCase() as Method;
  const test = api(app)[verb](probePath(path), { cookie: options.cookie });
  return (options.body === undefined ? test : test.send(options.body)).then((response) => ({
    status: response.status,
    body: bodyOf<unknown>(response),
    headers: response.headers,
  }));
}

function errorCodeOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const { error } = body as { error: { code?: unknown } };
  return typeof error.code === "string" ? error.code : undefined;
}

const prisma = getTestPrisma();
let app: Express;
let registered: string[];
let customerCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await resetDatabase(prisma);
  // The business must exist: without its settings row most reads answer 503 (not configured).
  await createBusinessSettings(prisma);
  registered = listRegisteredRoutes(() => buildTestApp({ prisma }).app).map(
    (route) => `${route.method} ${route.path}`,
  );
  app = buildTestApp({ prisma }).app;
  const customer = await createLocalCustomer(prisma, { email: "matrix.customer@example.test" });
  await createLocalAdmin(prisma);
  customerCookie = await signInAs(app, customer.user.email);
  adminCookie = await signInAs(app, "admin@demo.fixflow.test");
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const ENTRIES = Object.entries(MATRIX);

describe("the route inventory", () => {
  it("finds the app's routes by walking the router", () => {
    // A sanity check of the introspection itself: a few routes of each kind, including the nested
    // admin services router and the routers mounted on the bare `/admin` prefix.
    expect(registered).toEqual(
      expect.arrayContaining([
        "GET /api/v1/health",
        "GET /api/v1/admin/services/:id",
        "POST /api/v1/admin/invoices/:id/payments/:paymentId/void",
        "GET /api/v1/admin/calendar",
        "POST /api/v1/quotations/:id/accept",
      ]),
    );
    expect(registered.length).toBeGreaterThan(80);
  });

  it("has a matrix entry for every registered route, and no entry for a route that is gone", () => {
    const missing = registered.filter((key) => !(key in MATRIX));
    const stale = Object.keys(MATRIX).filter((key) => !registered.includes(key));
    expect(missing, "routes with no authorization matrix entry").toEqual([]);
    expect(stale, "matrix entries for routes that are not registered").toEqual([]);
  });

  it("names a rate limit for every route that is not a read", () => {
    const unlimited = ENTRIES.filter(
      ([key, entry]) => !key.startsWith("GET ") && entry.limit === undefined,
    ).map(([key]) => key);
    expect(unlimited).toEqual([]);
  });
});

describe("without a session", () => {
  it.each(ENTRIES)("%s", async (key, entry) => {
    const response = await call(app, key);
    if (entry.access === "public") {
      expect([401, 403], `${key} answered ${String(response.status)}`).not.toContain(
        response.status,
      );
      expect(response.status).toBeLessThan(500);
    } else {
      expect(response.status, key).toBe(401);
      expect(errorCodeOf(response.body)).toBe(ErrorCode.UNAUTHENTICATED);
    }
  });
});

// Signing out, signing in and the other public auth routes are left out of the signed-in probes:
// a probe of `/auth/logout` would end the very session the next probes use.
const SIGNED_IN_PROBES = ENTRIES.filter(([, entry]) => entry.access !== "public");

describe("as a customer", () => {
  it.each(SIGNED_IN_PROBES)("%s", async (key, entry) => {
    const response = await call(app, key, { cookie: customerCookie });
    if (entry.access === "admin") {
      expect(response.status, key).toBe(403);
      expect(errorCodeOf(response.body)).toBe(ErrorCode.FORBIDDEN);
    } else {
      expect([401, 403], `${key} answered ${String(response.status)}`).not.toContain(
        response.status,
      );
      expect(response.status, key).toBeLessThan(500);
    }
  });
});

describe("as an admin", () => {
  it.each(SIGNED_IN_PROBES)("%s", async (key, entry) => {
    const response = await call(app, key, { cookie: adminCookie });
    if (entry.access === "customer") {
      expect(response.status, key).toBe(403);
      expect(errorCodeOf(response.body)).toBe(ErrorCode.FORBIDDEN);
    } else {
      expect([401, 403], `${key} answered ${String(response.status)}`).not.toContain(
        response.status,
      );
      expect(response.status, key).toBeLessThan(500);
    }
  });
});

describe("rate limits on the abuse-prone routes", () => {
  const LIMITED = ENTRIES.filter(
    (entry): entry is [string, MatrixEntry & { limit: RateLimitName }] =>
      entry[1].limit !== undefined,
  );
  const BODIES: Partial<Record<string, object>> = {
    // Counted per address after the body is read, so both requests need a valid one.
    "POST /api/v1/auth/password/forgot": { email: "nobody.here@example.test" },
    "POST /api/v1/auth/login": { email: "nobody.here@example.test", password: "wrong password 1" },
  };

  it.each(LIMITED)("%s is refused on a burst by its %s limit", async (key, entry) => {
    // A fresh app with only this route's named limit tight: if another limit (or none) guarded the
    // route, the second request would not be refused.
    const limited = buildTestApp({
      prisma,
      rateLimits: { [entry.limit]: { limit: 1, windowSeconds: 3600 } },
    }).app;
    // A customer for the customers' routes, the admin for the business's, nobody for the public ones.
    // Signing out is probed without a session, so the shared session survives.
    const cookie =
      entry.access === "public"
        ? undefined
        : entry.access === "admin"
          ? adminCookie
          : customerCookie;
    const body = BODIES[key] ?? entry.limitBody;
    const options = {
      ...(cookie !== undefined && { cookie }),
      ...(body !== undefined && { body }),
    };

    const first = await call(limited, key, options);
    expect(first.status, `${key}: the first request is not limited`).not.toBe(429);
    const second = await call(limited, key, options);
    expect(second.status, `${key}: the second request is limited`).toBe(429);
    expect(errorCodeOf(second.body)).toBe(ErrorCode.RATE_LIMITED);
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
  });
});
