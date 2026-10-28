import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../../lib/db.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { databaseName, disconnectTestPrisma, getTestPrisma } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";

afterAll(async () => {
  await disconnectTestPrisma();
});

describe("GET /api/v1/health/ready against a real database", () => {
  it("returns 200 while the database is up", async () => {
    const { app } = buildTestApp({ prisma: getTestPrisma() });

    const response = await request(app).get("/api/v1/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: "ready" } });
  });

  it("returns 503 when the database cannot be reached, while liveness stays 200", async () => {
    // Nothing listens on port 1, so this client behaves like a database that is down.
    const unreachable = createPrismaClient("postgresql://nobody:nothing@127.0.0.1:1/missing");
    try {
      const { app } = buildTestApp({ prisma: unreachable });

      expectApiError(await request(app).get("/api/v1/health/ready"), {
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      });
      expect((await request(app).get("/api/v1/health")).body).toEqual({ data: { status: "ok" } });
    } finally {
      await unreachable.$disconnect();
    }
  });

  it("is served from the database named by TEST_DATABASE_URL", async () => {
    const [row] = await getTestPrisma().$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;

    expect(row?.name).toBe(databaseName("TEST_DATABASE_URL", process.env.TEST_DATABASE_URL ?? ""));
  });
});
