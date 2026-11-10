import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DownloadInvoicePdfButton, fileNameFrom } from "./download-invoice-pdf-button";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

const INVOICE_ID = "7d3c9b1a-2e4f-4a6b-8c5d-1f0e9d8c7b6a";

function pdfResponse(headers: Record<string, string> = {}) {
  return new Response(new Blob(["%PDF-1.7 fake"], { type: "application/pdf" }), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="INV-2026-00004.pdf"',
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

function renderButton(props: Partial<Parameters<typeof DownloadInvoicePdfButton>[0]> = {}) {
  return render(
    <DownloadInvoicePdfButton invoiceId={INVOICE_ID} label="INV-2026-00004" {...props} />,
  );
}

describe("fileNameFrom", () => {
  it("reads the name the server chose", () => {
    expect(fileNameFrom('attachment; filename="INV-2026-00012.pdf"', "x.pdf")).toBe(
      "INV-2026-00012.pdf",
    );
    expect(fileNameFrom('inline; filename="invoice-draft.pdf"', "x.pdf")).toBe("invoice-draft.pdf");
  });

  it("falls back when there is none, or when it would name a path", () => {
    expect(fileNameFrom(null, "fallback.pdf")).toBe("fallback.pdf");
    expect(fileNameFrom("attachment", "fallback.pdf")).toBe("fallback.pdf");
    expect(fileNameFrom('attachment; filename="../evil.pdf"', "fallback.pdf")).toBe("fallback.pdf");
    expect(fileNameFrom('attachment; filename="a\\b.pdf"', "fallback.pdf")).toBe("fallback.pdf");
  });
});

describe("DownloadInvoicePdfButton", () => {
  it("asks the API for the PDF with the session, and saves it under the server's file name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pdfResponse());
    vi.stubGlobal("fetch", fetchMock);
    renderButton();

    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));

    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/invoices/${INVOICE_ID}/pdf`,
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
    expect(clicked[0]).toEqual({
      download: "INV-2026-00004.pdf",
      href: "blob:http://localhost/fake",
    });
    expect(toastError).not.toHaveBeenCalled();
    // The saved file is not left in the page.
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("falls back to the invoice's number for the file name when the server gives none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(pdfResponse({ "Content-Disposition": "attachment" })),
    );
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(clicked[0]?.download).toBe("INV-2026-00004.pdf");
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
    renderButton();
    const button = screen.getByRole("button", { name: "Download PDF" });

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the PDF…");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finish(pdfResponse());
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
    expect(clicked).toHaveLength(1);
  });

  it.each([
    [404, "NOT_FOUND", "We couldn't find that."],
    [429, "RATE_LIMITED", "Too many requests."],
    [500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again."],
    [401, "UNAUTHENTICATED", "Please sign in."],
  ])(
    "tells the customer when the API answers %s, saves nothing, and lets them try again",
    async (status, code, message) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(status, code, message)));
      renderButton();
      const button = screen.getByRole("button", { name: "Download PDF" });

      await userEvent.click(button);

      await waitFor(() => {
        expect(toastError).toHaveBeenCalledTimes(1);
      });
      expect(toastError).toHaveBeenCalledWith(
        "The PDF could not be downloaded",
        expect.objectContaining({ description: expect.any(String) as string }),
      );
      expect(clicked).toHaveLength(0);
      await waitFor(() => {
        expect(button).not.toHaveAttribute("aria-busy");
      });
      expect(button).toBeEnabled();
    },
  );

  it("quotes the API's own message in the toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errorResponse(404, "NOT_FOUND", "We couldn't find that invoice.")),
    );
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    expect(toastError).toHaveBeenCalledWith("The PDF could not be downloaded", {
      description: "We couldn't find that invoice.",
    });
  });

  it("tells the customer when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    expect(toastError).toHaveBeenCalledWith("The PDF could not be downloaded", {
      description: expect.stringContaining("couldn't reach the server") as string,
    });
    expect(clicked).toHaveLength(0);
  });

  it("does not leak a raw exception message into the toast", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pdfResponse()));
    (URL.createObjectURL as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("secret internal detail");
    });
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    const [, options] = toastError.mock.calls[0] as [string, { description: string }];
    expect(options.description).toBe("Something went wrong. Please try again.");
  });

  it("can be held back, for a draft with changes that are not saved yet", () => {
    renderButton({ disabled: true, "aria-describedby": "save-first" });
    const button = screen.getByRole("button", { name: "Download PDF" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-describedby", "save-first");
  });

  it("is not printed", () => {
    renderButton();
    expect(screen.getByRole("button", { name: "Download PDF" }).className).toContain(
      "print:hidden",
    );
  });
});
