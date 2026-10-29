import type { AdminServiceListResponse } from "@fixflow/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serverApiGetEnvelope = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/server", () => ({ serverApiGetEnvelope }));

import { loadCatalogueContext } from "./load-context";

function list(categories: string[], currencyCode = "USD"): AdminServiceListResponse {
  return {
    data: categories.map((category, index) => ({ category, id: String(index) })) as never,
    pagination: { page: 1, pageSize: 100, totalItems: categories.length, totalPages: 1 },
    meta: { counts: { all: 0, published: 0, unpublished: 0, archived: 0 }, currencyCode },
  };
}

beforeEach(() => {
  serverApiGetEnvelope.mockReset();
});

describe("loadCatalogueContext", () => {
  it("returns the distinct categories in use, sorted, and the business currency", async () => {
    serverApiGetEnvelope.mockResolvedValue(
      list(["Cleaning", "Air conditioning", "Cleaning", "Electrical"], "EUR"),
    );

    await expect(loadCatalogueContext()).resolves.toEqual({
      categories: ["Air conditioning", "Cleaning", "Electrical"],
      currencyCode: "EUR",
    });
  });

  it("asks for the biggest page the API allows, so the suggestions are complete", async () => {
    serverApiGetEnvelope.mockResolvedValue(list([]));

    await loadCatalogueContext();

    expect(serverApiGetEnvelope).toHaveBeenCalledWith(
      "/admin/services?page=1&pageSize=100&sort=category&order=asc",
    );
  });

  it("has no categories for an empty catalogue", async () => {
    serverApiGetEnvelope.mockResolvedValue(list([]));

    await expect(loadCatalogueContext()).resolves.toEqual({ categories: [], currencyCode: "USD" });
  });

  it("lets an API failure through, for the page to show", async () => {
    serverApiGetEnvelope.mockRejectedValue(new Error("down"));

    await expect(loadCatalogueContext()).rejects.toThrow("down");
  });
});
