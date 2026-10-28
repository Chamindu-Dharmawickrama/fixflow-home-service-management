import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildTestApp } from "../test/build-test-app.js";
import { createLogCapture } from "../test/log-capture.js";
import { createLogger, pathOf, REDACT_PATHS, REDACTED, REDACTED_FIELD_NAMES } from "./logger.js";

const BASE = "/api/v1/__test__";

describe("createLogger", () => {
  function capture(level: "info" | "silent" = "info") {
    const logs = createLogCapture();
    return { logger: createLogger({ level, pretty: false }, logs.stream), logs };
  }

  it("writes one JSON object per line with a named level and an ISO timestamp", () => {
    const { logger, logs } = capture();

    logger.info({ orderId: 7 }, "Order placed");

    const [entry] = logs.entries();
    expect(entry).toMatchObject({ level: "info", msg: "Order placed", orderId: 7 });
    expect(new Date(String(entry?.time)).toISOString()).toBe(entry?.time);
  });

  it("respects the configured level", () => {
    const { logger, logs } = capture("silent");

    logger.error("nobody hears this");

    expect(logs.text()).toBe("");
  });

  it.each(REDACTED_FIELD_NAMES)(
    "redacts a field named %s at any depth up to four levels",
    (name) => {
      const { logger, logs } = capture();

      logger.info({
        [name]: "top-value",
        a: { [name]: "depth-two-value" },
        b: { c: { [name]: "depth-three-value" } },
        d: { e: { f: { [name]: "depth-four-value" } } },
      });

      expect(logs.text()).not.toMatch(
        /top-value|depth-two-value|depth-three-value|depth-four-value/,
      );
      expect(logs.text()).toContain(REDACTED);
    },
  );

  it("redacts the cookie and authorization request headers and the set-cookie response header", () => {
    const { logger, logs } = capture();

    logger.info({
      req: {
        headers: {
          cookie: "fixflow_session=cookie-secret",
          authorization: "Bearer bearer-secret",
          "proxy-authorization": "Basic proxy-secret",
          "user-agent": "vitest",
        },
      },
      res: { headers: { "set-cookie": ["fixflow_session=set-cookie-secret; HttpOnly"] } },
    });

    expect(logs.text()).not.toMatch(/cookie-secret|bearer-secret|proxy-secret|set-cookie-secret/);
    expect(logs.entries()[0]).toMatchObject({
      req: {
        headers: {
          cookie: REDACTED,
          authorization: REDACTED,
          "proxy-authorization": REDACTED,
          "user-agent": "vitest",
        },
      },
      res: { headers: { "set-cookie": REDACTED } },
    });
  });

  it("leaves other fields readable", () => {
    const { logger, logs } = capture();

    logger.info({ user: { id: "u-1", role: "CUSTOMER" } });

    expect(logs.entries()[0]).toMatchObject({ user: { id: "u-1", role: "CUSTOMER" } });
  });

  it("registers a path for every name at every depth", () => {
    for (const name of REDACTED_FIELD_NAMES) {
      expect(REDACT_PATHS).toContain(name);
      expect(REDACT_PATHS).toContain(`*.${name}`);
      expect(REDACT_PATHS).toContain(`*.*.${name}`);
    }
  });
});

describe("pathOf", () => {
  it("drops the query string", () => {
    expect(pathOf("/api/v1/customers?search=jane%40example.test&page=2")).toBe("/api/v1/customers");
    expect(pathOf("/api/v1/health")).toBe("/api/v1/health");
    expect(pathOf(undefined)).toBe("");
  });
});

describe("request logging", () => {
  it("logs one line per request with the method, path, status and duration", async () => {
    const { app, logs } = buildTestApp({ logLevel: "info" });

    await request(app).get("/api/v1/health");

    expect(logs.entries()).toHaveLength(1);
    const [entry] = logs.entries();
    expect(entry).toMatchObject({
      level: "info",
      req: { method: "GET", path: "/api/v1/health" },
      res: { statusCode: 200 },
    });
    expect(typeof entry?.responseTime).toBe("number");
  });

  it("logs client errors as warnings and server errors as errors", async () => {
    const { app, logs } = buildTestApp({ testRoutes: true, logLevel: "info" });

    await request(app).get("/api/v1/missing");
    await request(app).get(`${BASE}/errors/unknown`);

    expect(logs.entries().map((entry) => entry.level)).toEqual(["warn", "error"]);
  });

  it("does not log the query string", async () => {
    const { app, logs } = buildTestApp({ logLevel: "info" });

    await request(app).get("/api/v1/health?email=jane.doe%40example.test&q=leaking-search-term");

    expect(logs.text()).not.toContain("jane.doe");
    expect(logs.text()).not.toContain("leaking-search-term");
    expect(logs.entries()[0]).toMatchObject({ req: { path: "/api/v1/health" } });
  });

  it("does not log request bodies by default", async () => {
    const { app, logs } = buildTestApp({ testRoutes: true, logLevel: "info" });

    await request(app)
      .post(`${BASE}/orders/7b0f9a52-52c2-4d4e-9d46-0d2d8f3f0a11`)
      .send({
        customerName: "Private Person",
        lines: [{ description: "Sensitive description text", quantity: 1 }],
      });

    expect(logs.text()).not.toContain("Private Person");
    expect(logs.text()).not.toContain("Sensitive description text");
  });

  it("does not log response bodies", async () => {
    const { app, logs } = buildTestApp({ testRoutes: true, logLevel: "info" });

    await request(app).get(`${BASE}/ip`);

    expect(logs.text()).not.toContain('"ip"');
  });
});

describe("log redaction through the app", () => {
  it("never writes cookies, authorization headers or Set-Cookie values", async () => {
    const { app, logs } = buildTestApp({ testRoutes: true, logLevel: "info" });

    await request(app)
      .get(`${BASE}/set-cookie`)
      .set("Cookie", "fixflow_session=incoming-cookie-secret")
      .set("Authorization", "Bearer incoming-bearer-secret");

    const text = logs.text();
    expect(text).not.toContain("incoming-cookie-secret");
    expect(text).not.toContain("incoming-bearer-secret");
    expect(text).not.toContain("super-secret-session-token");
    expect(logs.entries()[0]).toMatchObject({
      req: { headers: { cookie: REDACTED, authorization: REDACTED } },
    });
    // The response is logged by status only, so its Set-Cookie header never reaches the log.
    expect(logs.entries()[0]?.res).toEqual({ statusCode: 200 });
  });

  it("redacts sensitive fields in anything a handler logs", async () => {
    const { app, logs } = buildTestApp({ testRoutes: true, logLevel: "info" });

    await request(app).post(`${BASE}/log-secret`).send({
      password: "pw-secret-value",
      credential: "google-credential-secret",
      token: "reset-token-secret",
      secret: "client-secret-value",
      newPassword: "new-pw-secret",
      note: "visible note",
    });

    const text = logs.text();
    for (const secret of [
      "pw-secret-value",
      "google-credential-secret",
      "reset-token-secret",
      "client-secret-value",
      "new-pw-secret",
      "tok-nested-secret",
    ]) {
      expect(text).not.toContain(secret);
    }
    const handlerLog = logs.entries().find((entry) => entry.msg === "Logging a body on purpose");
    expect(handlerLog).toMatchObject({
      body: {
        password: REDACTED,
        credential: REDACTED,
        token: REDACTED,
        secret: REDACTED,
        note: "visible note",
      },
      nested: { deeper: { token: REDACTED } },
    });
  });
});
