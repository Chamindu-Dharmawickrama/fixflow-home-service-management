import { randomUUID } from "node:crypto";

import type { AdminServiceDto, PricingMode } from "@fixflow/shared";
import { expect, type Page } from "@playwright/test";

import { WEB_URL } from "../support/env.js";
import { E2E_SERVICE_PREFIX } from "./catalogue.js";

/**
 * Helpers for the public-website specs (T08). They act as the signed-in business admin through the
 * real admin API (the page must already be signed in), exactly as the admin screens do: the
 * browser's session cookie, and an `Origin` that matches the web origin (the CSRF check, D-11).
 */

const ORIGIN_HEADER = { Origin: WEB_URL };

export interface TestService {
  id: string;
  name: string;
  slug: string;
}

/** A name no other test or run shares, with the prefix `deleteServicesNamed` is allowed to clean up. */
export function uniqueServiceName(label: string): string {
  return `${E2E_SERVICE_PREFIX}${label} ${randomUUID().slice(0, 8)}`;
}

/**
 * Creates and publishes a service. It sorts after the five seeded ones, so it never changes which
 * services the homepage highlights, and it has its own category, so the seeded category filters are
 * unaffected.
 */
export async function createPublishedService(
  page: Page,
  options: {
    name: string;
    pricingMode?: PricingMode;
    startingPrice?: string | null;
    inclusions?: string[];
  },
): Promise<TestService> {
  const pricingMode = options.pricingMode ?? "QUOTE_REQUIRED";
  const response = await page.request.post("/api/v1/admin/services", {
    headers: ORIGIN_HEADER,
    data: {
      name: options.name,
      category: "E2E checks",
      shortDescription: "A service created by the public-site checks. It is removed after the run.",
      fullDescription:
        "Created by an automated browser test, to see a service appear on and disappear from the public website.\n\nIt is removed again at the end of the test.",
      inclusions: options.inclusions ?? ["One included item"],
      estimatedDurationMinutes: 60,
      pricingMode,
      startingPrice: pricingMode === "FIXED" ? (options.startingPrice ?? "99.00") : null,
      sortOrder: 900,
      isPublished: true,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { data } = (await response.json()) as { data: AdminServiceDto };
  return { id: data.id, name: data.name, slug: data.slug };
}

export async function archiveService(page: Page, service: TestService): Promise<void> {
  const response = await page.request.post(`/api/v1/admin/services/${service.id}/archive`, {
    headers: ORIGIN_HEADER,
    data: { expectedStatus: "PUBLISHED" },
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** Changes the business name through the admin settings API and returns the name it replaced. */
export async function setBusinessName(page: Page, businessName: string): Promise<string> {
  const current = await page.request.get("/api/v1/admin/settings");
  const { data } = (await current.json()) as { data: { businessName: string } };
  const response = await page.request.patch("/api/v1/admin/settings", {
    headers: ORIGIN_HEADER,
    data: { businessName },
  });
  expect(response.status(), await response.text()).toBe(200);
  return data.businessName;
}
