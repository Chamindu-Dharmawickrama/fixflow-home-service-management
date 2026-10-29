import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../../config/env.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./auth.cookie.js";

const PRODUCTION_ENV = {
  NODE_ENV: "production",
  WEB_ORIGIN: "https://fixflow.example.com",
  DATABASE_URL: "postgresql://app:pw@db.example.com:5432/fixflow",
  SESSION_SECRET: "session-secret-for-tests-0123456789abcdef",
  UPSTASH_REDIS_REST_URL: "https://eu1-example-12345.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok-example-not-a-real-token",
};
const NOW = new Date("2026-10-28T12:00:00.000Z");
const EXPIRES = new Date("2026-11-04T12:00:00.000Z");

function appFor(env: Record<string, string>) {
  const config = loadConfig(env);
  const app = express();
  app.get("/set", (_req, res) => {
    setSessionCookie(res, config, "the-token", EXPIRES, NOW);
    res.json({});
  });
  app.get("/clear", (_req, res) => {
    clearSessionCookie(res, config);
    res.json({});
  });
  app.get("/read", (req, res) => {
    res.json({ token: readSessionToken(req, config) ?? null });
  });
  return app;
}

async function setCookieLine(app: express.Express, path: string): Promise<string> {
  const response = await request(app).get(path);
  const header = response.headers["set-cookie"] as string[] | undefined;
  return header?.[0] ?? "";
}

describe("session cookie attributes (D-10)", () => {
  it("is HttpOnly, SameSite=Lax, Path=/ and lasts seven days in development", async () => {
    const line = await setCookieLine(appFor({}), "/set");

    expect(line).toMatch(/^fixflow_session=the-token;/);
    expect(line).toMatch(/; HttpOnly/);
    expect(line).toMatch(/; SameSite=Lax/);
    expect(line).toMatch(/; Path=\//);
    expect(line).toMatch(/; Max-Age=604800/);
    expect(line).not.toMatch(/; Secure/);
    expect(line).not.toMatch(/; Domain=/i);
  });

  it("is Secure and uses the __Host- prefix in production, still with no Domain", async () => {
    const line = await setCookieLine(appFor(PRODUCTION_ENV), "/set");

    expect(line).toMatch(/^__Host-fixflow_session=the-token;/);
    expect(line).toMatch(/; Secure/);
    expect(line).toMatch(/; HttpOnly/);
    expect(line).toMatch(/; SameSite=Lax/);
    expect(line).toMatch(/; Path=\//);
    expect(line).not.toMatch(/; Domain=/i);
  });

  it("clears the cookie with the same attributes, so the browser really removes it", async () => {
    const line = await setCookieLine(appFor(PRODUCTION_ENV), "/clear");

    expect(line).toMatch(/^__Host-fixflow_session=;/);
    expect(line).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(line).toMatch(/; Secure/);
    expect(line).toMatch(/; Path=\//);
  });

  it("never gives a negative lifetime for an expiry in the past", async () => {
    const config = loadConfig({});
    const app = express();
    app.get("/set", (_req, res) => {
      setSessionCookie(res, config, "t", new Date(NOW.getTime() - 5000), NOW);
      res.json({});
    });

    expect(await setCookieLine(app, "/set")).toMatch(/Max-Age=0/);
  });
});

describe("readSessionToken", () => {
  it("reads the cookie by the environment's name", async () => {
    const dev = await request(appFor({})).get("/read").set("Cookie", "fixflow_session=abc; x=1");
    const prod = await request(appFor(PRODUCTION_ENV))
      .get("/read")
      .set("Cookie", "__Host-fixflow_session=xyz");

    expect((dev.body as { token: string }).token).toBe("abc");
    expect((prod.body as { token: string }).token).toBe("xyz");
  });

  it("does not accept the other environment's cookie name", async () => {
    const response = await request(appFor(PRODUCTION_ENV))
      .get("/read")
      .set("Cookie", "fixflow_session=abc");

    expect((response.body as { token: unknown }).token).toBeNull();
  });
});
