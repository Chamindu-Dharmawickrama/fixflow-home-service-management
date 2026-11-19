import { expect, test } from "@playwright/test";

import { demoAccount, loginAs } from "../support/auth.js";

/**
 * Checks of a hosted deployment (T09). They only run with `BASE_URL=https://<web>` (see the Playwright
 * config), where the demo passwords are those of the hosted seed. They prove what `next dev` cannot:
 * the production session cookie arrives on the web origin through Vercel's rewrite, and the CSRF
 * `Origin` check still sees the browser's Origin behind two proxies.
 */
const hostedUrl = process.env.BASE_URL;

test.describe("hosted deployment", () => {
  test.skip(hostedUrl === undefined, "Set BASE_URL to check a hosted deployment.");

  test(
    "the admin signs in through the login form and the session cookie is first-party",
    {
      tag: "@smoke",
    },
    async ({ page, context, baseURL }) => {
      const loginResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/auth/login") && response.request().method() === "POST",
      );
      const landedOn = await loginAs(page, "admin");
      expect(landedOn).toBe("/app/dashboard");

      // SameSite is read from what the server sent: WebKit's cookie jar reports Lax as "None" on Windows.
      const sent = (await (await loginResponse).headersArray())
        .filter((header) => header.name.toLowerCase() === "set-cookie")
        .map((header) => header.value);
      expect(sent.find((value) => value.startsWith("__Host-fixflow_session="))).toMatch(
        /;\s*SameSite=Lax(;|$)/i,
      );

      const host = new URL(baseURL ?? "").host;
      const session = (await context.cookies()).find((cookie) =>
        cookie.name.endsWith("fixflow_session"),
      );
      expect(session, "a session cookie").toBeDefined();
      expect(session?.name).toBe("__Host-fixflow_session");
      expect(session?.secure).toBe(true);
      expect(session?.httpOnly).toBe(true);
      expect(session?.path).toBe("/");
      // Host-only: set for the web origin itself, not for a parent domain and not for the API's host.
      expect(session?.domain).toBe(host);

      const me = await page.request.get("/api/v1/auth/me");
      expect(me.status()).toBe(200);
      const body = (await me.json()) as { data: { user: { email: string } } };
      expect(body.data.user.email).toBe(demoAccount("admin").email);
    },
  );

  test(
    "the customer signs in through the login form and lands in the portal",
    {
      tag: "@smoke",
    },
    async ({ page }) => {
      const landedOn = await loginAs(page, "customer");
      expect(landedOn.startsWith("/portal")).toBe(true);
    },
  );

  test(
    "a sign-in request is refused without the right Origin, and accepted with it",
    {
      tag: "@smoke",
    },
    async ({ request, baseURL }) => {
      const credentials = { email: demoAccount("admin").email, password: "not-the-password-1" };

      const foreign = await request.post("/api/v1/auth/login", {
        data: credentials,
        headers: { Origin: "https://evil.example" },
      });
      expect(foreign.status()).toBe(403);

      const none = await request.post("/api/v1/auth/login", { data: credentials });
      expect(none.status()).toBe(403);

      // The right Origin passes the CSRF check, so it is the credentials that fail: 401, not 403.
      const wrongPassword = await request.post("/api/v1/auth/login", {
        data: credentials,
        headers: { Origin: new URL(baseURL ?? "").origin },
      });
      expect(wrongPassword.status()).toBe(401);
    },
  );

  // ---- Production checks (T26) ----------------------------------------------------------------------

  test(
    "the site is served over HTTPS and sends the security headers (D-113)",
    { tag: "@smoke" },
    async ({ request, baseURL }) => {
      expect(new URL(baseURL ?? "").protocol, "the deployment is served over HTTPS").toBe("https:");

      for (const path of ["/", "/services", "/privacy", "/login", "/register"]) {
        const headers = (await request.get(path, { maxRedirects: 0 })).headers();
        const csp = headers["content-security-policy"] ?? "";
        expect(csp, `${path}: CSP`).toContain("default-src 'self'");
        expect(csp, `${path}: no framing`).toContain("frame-ancestors 'none'");
        // Only the production policy asks the browser to upgrade insecure requests.
        expect(csp, `${path}: production CSP`).toContain("upgrade-insecure-requests");
        expect(csp, `${path}: no eval in production`).not.toContain("unsafe-eval");
        expect(csp, `${path}: GIS script`).toContain("https://accounts.google.com/gsi/client");
        expect(headers["strict-transport-security"], `${path}: HSTS`).toMatch(/max-age=\d{7,}/);
        expect(headers["x-content-type-options"], path).toBe("nosniff");
        expect(headers["x-frame-options"], path).toBe("DENY");
        expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
        expect(headers["cross-origin-opener-policy"], path).toBe("same-origin-allow-popups");
        expect(headers["permissions-policy"], path).toContain("camera=()");
        expect(headers["x-powered-by"], `${path}: the framework is not advertised`).toBeUndefined();
      }
    },
  );

  test(
    "the API answers through the proxy: ready, private and not advertised",
    { tag: "@smoke" },
    async ({ request }) => {
      // Ready means the API reached the database (liveness `/health` never queries it, D-14).
      const ready = await request.get("/api/v1/health/ready");
      expect(ready.status()).toBe(200);
      expect(await ready.json()).toEqual({ data: { status: "ready" } });

      // A private answer is never cached by a browser or an intermediary (D-75).
      const me = await request.get("/api/v1/auth/me");
      expect(me.status()).toBe(401);
      expect(me.headers()["cache-control"]).toBe("no-store");
      expect(me.headers()["x-powered-by"]).toBeUndefined();
    },
  );

  test(
    "the shared demo accounts cannot change their password (SEC-AUTH-02, D-09)",
    { tag: "@smoke" },
    async ({ page, baseURL }) => {
      await loginAs(page, "customer");
      // A wrong current password, so that if the lock were ever missing this changes nothing: the
      // request would be refused as an incorrect password instead (and this test would fail).
      const response = await page.request.post("/api/v1/auth/password/change", {
        data: {
          currentPassword: "not-the-current-password-1",
          newPassword: "a-new-passphrase-that-is-unused-7",
          newPasswordConfirmation: "a-new-passphrase-that-is-unused-7",
        },
        headers: { Origin: new URL(baseURL ?? "").origin },
      });
      expect(response.status()).toBe(403);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("DEMO_ACCOUNT_LOCKED");
    },
  );

  test(
    "repeated failed sign-ins are rate limited through the shared counter (NFR-08)",
    { tag: "@smoke" },
    async ({ request, baseURL }, testInfo) => {
      // Server-side behaviour, so one project is enough, and six sign-ins from one address per project would
      // eat into the API's own limit of 20 sign-in attempts a minute for the other tests (four projects).
      test.skip(
        testInfo.project.name !== "chromium",
        "Checked once, on the desktop Chromium project.",
      );
      // An address nobody has: only this address's counter (per client IP + email) fills up, so the demo
      // accounts stay usable. The API counts in Upstash, so the sixth attempt is refused wherever it lands.
      const credentials = {
        email: `rate-limit-check-${Date.now().toString(36)}@example.test`,
        password: "not-the-password-1",
      };
      const headers = { Origin: new URL(baseURL ?? "").origin };
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const refused = await request.post("/api/v1/auth/login", { data: credentials, headers });
        expect(refused.status(), `failed sign-in ${attempt}`).toBe(401);
      }
      const limited = await request.post("/api/v1/auth/login", { data: credentials, headers });
      expect(limited.status()).toBe(429);
      expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    },
  );
});
