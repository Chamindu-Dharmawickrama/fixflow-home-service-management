import { ErrorCode } from "@fixflow/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { JOB_ID, QUOTATION_ID } from "../test-fixtures";
import { CreateJobButton } from "./create-job-button";

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreateJobButton", () => {
  it("asks the server to make the job from the accepted quotation, then opens it for scheduling", async () => {
    apiFetchMock.mockResolvedValue({ id: JOB_ID });
    const user = userEvent.setup();
    render(<CreateJobButton quotationId={QUOTATION_ID} />);

    await user.click(screen.getByRole("button", { name: "Create job" }));

    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/quotations/${QUOTATION_ID}/work-order`, {
      method: "POST",
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/jobs/${JOB_ID}?schedule=1`));
  });

  it("sends nothing the server must take on trust: no body at all", async () => {
    apiFetchMock.mockResolvedValue({ id: JOB_ID });
    const user = userEvent.setup();
    render(<CreateJobButton quotationId={QUOTATION_ID} />);
    await user.click(screen.getByRole("button", { name: "Create job" }));

    expect(apiFetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("is blocked while the job is being made, so a second press makes no second request", async () => {
    let finish: (value: { id: string }) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<CreateJobButton quotationId={QUOTATION_ID} />);

    const button = screen.getByRole("button", { name: "Create job" });
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    finish({ id: JOB_ID });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it("stays blocked after success, until the page has moved on", async () => {
    apiFetchMock.mockResolvedValue({ id: JOB_ID });
    const user = userEvent.setup();
    render(<CreateJobButton quotationId={QUOTATION_ID} />);
    const button = screen.getByRole("button", { name: "Create job" });

    await user.click(button);
    await waitFor(() => expect(push).toHaveBeenCalled());

    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("shows the server's words when the quotation can no longer become a job, and reloads the page", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: ErrorCode.INVALID_STATE_TRANSITION,
        message: "Request FF-2026-00012 is cancelled, so it cannot become a job.",
      }),
    );
    const user = userEvent.setup();
    render(<CreateJobButton quotationId={QUOTATION_ID} />);

    await user.click(screen.getByRole("button", { name: "Create job" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Request FF-2026-00012 is cancelled, so it cannot become a job.",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create job" })).not.toHaveAttribute("aria-busy");
  });

  it("says when the server cannot be reached, and lets the person try again", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "We couldn't reach the server. Check your connection and try again.",
      }),
    );
    apiFetchMock.mockResolvedValueOnce({ id: JOB_ID });
    const user = userEvent.setup();
    render(<CreateJobButton quotationId={QUOTATION_ID} />);

    await user.click(screen.getByRole("button", { name: "Create job" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach the server");
    expect(refresh).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Create job" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/jobs/${JOB_ID}?schedule=1`));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
