import { expect, test } from "@playwright/test";

test("the home page loads and has a page title", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/\S/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the API health endpoint is reachable through the web origin proxy", async ({
  request,
  baseURL,
}) => {
  const response = await request.get("/api/v1/health");

  // The request went to the web origin (not directly to the API) and was proxied.
  expect(response.url().startsWith(baseURL ?? "")).toBe(true);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ data: { status: "ok" } });
});
