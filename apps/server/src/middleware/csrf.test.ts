import { ErrorCode } from "@fixflow/shared";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { expectApiError } from "../test/http.js";
import { csrfProtection } from "./csrf.js";
import { errorHandler } from "./error-handler.js";
import { requestId } from "./request-id.js";

const WEB_ORIGIN = "http://localhost:3000";

function buildApp() {
  const app = express();
  app.use(requestId);
  app.use(csrfProtection({ webOrigin: WEB_ORIGIN }));
  app.use(express.json());
  app.all("/probe", (_req, res) => {
    res.json({ data: { ok: true } });
  });
  app.use(errorHandler);
  return app;
}

describe("csrfProtection", () => {
  const app = buildApp();

  it.each(["get", "head", "options"] as const)(
    "lets %s through without an Origin",
    async (method) => {
      const response = await request(app)[method]("/probe");

      expect(response.status).toBe(200);
    },
  );

  it.each(["post", "put", "patch", "delete"] as const)(
    "accepts %s from the web origin",
    async (method) => {
      const response = await request(app)[method]("/probe").set("Origin", WEB_ORIGIN);

      expect(response.status).toBe(200);
    },
  );

  it.each([
    ["another site", "https://evil.example.com"],
    ["a look-alike host", "http://localhost:3000.evil.example.com"],
    ["another port", "http://localhost:3001"],
    ["another scheme", "https://localhost:3000"],
    ["a trailing slash", "http://localhost:3000/"],
    ["null (sandboxed frames, redirects)", "null"],
  ])("rejects an unsafe request from %s with 403", async (_label, origin) => {
    const response = await request(app).post("/probe").set("Origin", origin).send({});

    expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
  });

  it("rejects an unsafe request that names no origin at all", async () => {
    const response = await request(app).post("/probe").send({});

    expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
  });

  it("falls back to Sec-Fetch-Site: same-origin when there is no Origin", async () => {
    const same = await request(app).post("/probe").set("Sec-Fetch-Site", "same-origin").send({});
    const cross = await request(app).post("/probe").set("Sec-Fetch-Site", "cross-site").send({});
    const site = await request(app).post("/probe").set("Sec-Fetch-Site", "same-site").send({});

    expect(same.status).toBe(200);
    expect(cross.status).toBe(403);
    expect(site.status).toBe(403);
  });

  it("does not let Sec-Fetch-Site override a wrong Origin", async () => {
    const response = await request(app)
      .post("/probe")
      .set("Origin", "https://evil.example.com")
      .set("Sec-Fetch-Site", "same-origin")
      .send({});

    expect(response.status).toBe(403);
  });

  it("requires a JSON body when there is one", async () => {
    const form = await request(app)
      .post("/probe")
      .set("Origin", WEB_ORIGIN)
      .type("form")
      .send({ email: "a@b.co" });
    const text = await request(app)
      .post("/probe")
      .set("Origin", WEB_ORIGIN)
      .type("text/plain")
      .send("hello");

    expectApiError(form, { status: 400, code: ErrorCode.BAD_REQUEST });
    expectApiError(text, { status: 400, code: ErrorCode.BAD_REQUEST });
  });

  it("accepts JSON with a charset, and a request with no body at all", async () => {
    const json = await request(app)
      .post("/probe")
      .set("Origin", WEB_ORIGIN)
      .set("Content-Type", "application/json; charset=utf-8")
      .send(JSON.stringify({ a: 1 }));
    const empty = await request(app).post("/probe").set("Origin", WEB_ORIGIN);

    expect(json.status).toBe(200);
    expect(empty.status).toBe(200);
  });
});
