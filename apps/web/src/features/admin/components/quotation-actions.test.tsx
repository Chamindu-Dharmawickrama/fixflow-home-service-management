import { QuotationAction } from "@fixflow/shared";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { adminQuotation } from "../test-fixtures";
import { QuotationActions } from "./quotation-actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QuotationActions: creating the job (T17)", () => {
  it("offers Create job on an accepted quotation whose request is still accepted", () => {
    render(
      <QuotationActions
        quotation={adminQuotation({
          status: "ACCEPTED",
          requestStatus: "ACCEPTED",
          availableActions: [QuotationAction.CREATE_WORK_ORDER],
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Create job" })).toBeEnabled();
  });

  it("offers it first, before printing", () => {
    render(
      <QuotationActions
        quotation={adminQuotation({
          status: "ACCEPTED",
          availableActions: [QuotationAction.CREATE_WORK_ORDER],
        })}
      />,
    );
    const names = screen.getAllByRole("button").map((button) => button.textContent?.trim());
    expect(names[0]).toBe("Create job");
    expect(names).toContain("Print");
  });

  it("offers nothing to create once the server stops listing it (the job exists, or the request ended)", () => {
    render(
      <QuotationActions
        quotation={adminQuotation({
          status: "ACCEPTED",
          requestStatus: "CONVERTED_TO_JOB",
          availableActions: [],
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Create job" })).not.toBeInTheDocument();
  });

  it("does not offer it on a sent quotation, which the customer has not answered", () => {
    render(
      <QuotationActions
        quotation={adminQuotation({
          status: "SENT",
          availableActions: [QuotationAction.REPLACE, QuotationAction.VOID],
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Create job" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Replace with a new draft/ })).toBeVisible();
  });
});
