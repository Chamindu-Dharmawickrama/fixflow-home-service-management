import type { ApiErrorBody } from "@fixflow/shared";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPrismaClient, createUnavailablePrisma, type PrismaClient } from "../../lib/db.js";
import { createLogger } from "../../lib/logger.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { bodyOf, expectApiError } from "../../test/http.js";
import { createLogCapture } from "../../test/log-capture.js";
import { isDatabaseReady } from "./health.service.js";

/** A client whose only capability is `$queryRaw`, which is all the readiness check uses. */
function fakeClient(queryRaw: () => Promise<unknown>): PrismaClient {
  return { $queryRaw: vi.fn(queryRaw) } as unknown as PrismaClient;
}

describe("GET /api/v1/health/ready", () => {
  it("returns 200 when the database answers", async () => {
    const queryRaw = vi.fn(() => Promise.resolve([{ "?column?": 1 }]));
    const { app } = buildTestApp({ prisma: { $queryRaw: queryRaw } as unknown as PrismaClient });

    const response = await request(app).get("/api/v1/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: "ready" } });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns 503 with the error contract when the query fails", async () => {
    const { app, logs } = buildTestApp({
      prisma: fakeClient(() => Promise.reject(new Error("connect ECONNREFUSED 10.1.2.3:5432"))),
      logLevel: "warn",
    });

    const response = await request(app).get("/api/v1/health/ready");

    const error = expectApiError(response, { status: 503, code: "SERVICE_UNAVAILABLE" });
    expect(error.details).toEqual({ database: "unreachable" });
    // The driver's message (it can name hosts) is logged for operators, never sent to the caller.
    expect(response.text).not.toContain("ECONNREFUSED");
    expect(response.text).not.toContain("10.1.2.3");
    expect(logs.text()).toContain("ECONNREFUSED");
  });

  it("returns 503 when no database is configured", async () => {
    const { app } = buildTestApp({
      prisma: createUnavailablePrisma("DATABASE_URL is not configured"),
    });

    const response = await request(app).get("/api/v1/health/ready");

    expectApiError(response, { status: 503, code: "SERVICE_UNAVAILABLE" });
  });

  it("returns 503 against a real client whose server refuses the connection", async () => {
    // Port 1 has no listener, so the driver is refused immediately; no database is needed.
    const prisma = createPrismaClient("postgresql://nobody:nothing@127.0.0.1:1/missing");
    try {
      const { app } = buildTestApp({ prisma });

      const response = await request(app).get("/api/v1/health/ready");

      expectApiError(response, { status: 503, code: "SERVICE_UNAVAILABLE" });
      expect(bodyOf<ApiErrorBody>(response).error.message).toBe(
        "The service is not ready to handle requests.",
      );
    } finally {
      await prisma.$disconnect();
    }
  });

  it("is a public endpoint that needs no session and sets no cookie", async () => {
    const { app } = buildTestApp({ prisma: fakeClient(() => Promise.resolve([])) });

    const response = await request(app).get("/api/v1/health/ready");

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
});

describe("isDatabaseReady", () => {
  const logs = createLogCapture();
  const logger = createLogger({ level: "warn", pretty: false }, logs.stream);

  it("is true when the query resolves", async () => {
    await expect(
      isDatabaseReady(
        fakeClient(() => Promise.resolve([])),
        logger,
      ),
    ).resolves.toBe(true);
  });

  it("is false, without throwing, when the query rejects", async () => {
    await expect(
      isDatabaseReady(
        fakeClient(() => Promise.reject(new Error("boom"))),
        logger,
      ),
    ).resolves.toBe(false);
  });

  it("is false when the database does not answer within the timeout", async () => {
    const hangs = fakeClient(() => new Promise(() => undefined));
    const started = Date.now();

    await expect(isDatabaseReady(hangs, logger, 40)).resolves.toBe(false);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(logs.text()).toContain("did not answer within 40 ms");
  });

  it("does not leave a timer running after a quick answer", async () => {
    vi.useFakeTimers();
    try {
      await isDatabaseReady(
        fakeClient(() => Promise.resolve([])),
        logger,
        5_000,
      );

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
