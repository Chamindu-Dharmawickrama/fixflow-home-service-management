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
      const landedOn = await loginAs(page, "admin");
      expect(landedOn).toBe("/app/dashboard");

      const host = new URL(baseURL ?? "").host;
      const session = (await context.cookies()).find((cookie) =>
        cookie.name.endsWith("fixflow_session"),
      );
      expect(session, "a session cookie").toBeDefined();
      expect(session?.name).toBe("__Host-fixflow_session");
      expect(session?.secure).toBe(true);
      expect(session?.httpOnly).toBe(true);
      expect(session?.sameSite).toBe("Lax");
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
});
