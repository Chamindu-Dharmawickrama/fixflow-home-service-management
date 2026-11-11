import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportCsvButton } from "./export-csv-button";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

function csvResponse(headers: Record<string, string> = {}) {
  return new Response(new Blob(["Reference,Status\r\n"], { type: "text/csv" }), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="fixflow-requests-2026-03-05.csv"',
      ...headers,
    },
  });
}

function errorResponse(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message, requestId: "req-1" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let clicked: { download: string; href: string }[];

beforeEach(() => {
  toastError.mockReset();
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ download: this.download, href: this.href });
  });
  Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:http://localhost/fake"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ExportCsvButton (FR-084)", () => {
  it("asks for the file with the list's filters and the session, and saves it under the server's name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(csvResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<ExportCsvButton kind="requests" query="status=SUBMITTED&page=2&pageSize=20" />);

    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/exports/requests.csv?status=SUBMITTED&page=2&pageSize=20",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
    expect(clicked[0]).toEqual({
      download: "fixflow-requests-2026-03-05.csv",
      href: "blob:http://localhost/fake",
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it.each(["requests", "jobs", "invoices"] as const)("asks the %s endpoint", async (kind) => {
    const fetchMock = vi.fn().mockResolvedValue(csvResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<ExportCsvButton kind={kind} query="" />);
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/admin/exports/${kind}.csv`);
  });

  it("names the file itself when the server does not", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(csvResponse({ "Content-Disposition": "attachment" })),
    );
    render(<ExportCsvButton kind="jobs" query="" />);
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(clicked[0]?.download).toBe("fixflow-jobs.csv");
  });

  it("shows it is working, and a second click meanwhile asks for nothing more", async () => {
    let finish: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ExportCsvButton kind="requests" query="" />);
    const button = screen.getByRole("button", { name: "Export CSV" });

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the file…");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finish(csvResponse());
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
    expect(clicked).toHaveLength(1);
  });

  it.each([
    [429, "RATE_LIMITED", "Too many requests."],
    [403, "FORBIDDEN", "You can't do that."],
    [500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again."],
  ])(
    "tells the admin when the API answers %s, saves nothing, and lets them try again",
    async (status, code, message) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(status, code, message)));
      render(<ExportCsvButton kind="invoices" query="" />);
      const button = screen.getByRole("button", { name: "Export CSV" });

      await userEvent.click(button);

      await waitFor(() => {
        expect(toastError).toHaveBeenCalledTimes(1);
      });
      const [title, options] = toastError.mock.calls[0] as [string, { description: string }];
      expect(title).toBe("The invoices could not be exported");
      expect(options.description.length).toBeGreaterThan(5);
      expect(clicked).toHaveLength(0);
      expect(button).toBeEnabled();
    },
  );

  it("tells the admin when the API cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<ExportCsvButton kind="requests" query="" />);
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledTimes(1);
    });
    expect(clicked).toHaveLength(0);
  });
});
