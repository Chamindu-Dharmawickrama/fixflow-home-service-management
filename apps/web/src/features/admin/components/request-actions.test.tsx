import { RequestAction } from "@fixflow/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { REQUEST_ID } from "../test-fixtures";
import { RequestActions, type RequestActionsProps } from "./request-actions";

const refresh = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/components/ui/sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn(), info: toastInfo },
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const { START_REVIEW, REOPEN, CANCEL, CREATE_QUOTATION } = RequestAction;

function renderActions(props: Partial<RequestActionsProps> = {}) {
  const user = userEvent.setup();
  render(
    <RequestActions
      requestId={REQUEST_ID}
      reference="FF-2026-00012"
      customerName="Amara Okafor"
      status="SUBMITTED"
      actions={[START_REVIEW, CANCEL]}
      {...props}
    />,
  );
  return user;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

async function openCancelDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(button("More actions"));
  await user.click(await screen.findByRole("menuitem", { name: "Cancel request" }));
  return screen.findByRole("alertdialog", { name: "Cancel FF-2026-00012?" });
}

function conflict(code: string, message: string) {
  return new ApiError({ status: 409, code: code as never, message });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RequestActions: what it offers", () => {
  it("offers the main step as a button and cancel in a menu, for a new request", async () => {
    const user = renderActions();

    expect(button("Start review")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cancel request" })).not.toBeInTheDocument();

    await user.click(button("More actions"));
    expect(await screen.findByRole("menuitem", { name: "Cancel request" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Start review" })).not.toBeInTheDocument();
  });

  it("offers Reopen as the main step for a declined request", () => {
    renderActions({ status: "DECLINED", actions: [REOPEN, CANCEL] });

    expect(button("Reopen request")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Start review" })).not.toBeInTheDocument();
  });

  it("offers only the menu when cancelling is all that can be done", () => {
    renderActions({ status: "UNDER_REVIEW", actions: [CANCEL] });

    expect(button("More actions")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Start review" })).not.toBeInTheDocument();
  });

  it("offers nothing when the server allows nothing, so no control leads nowhere", () => {
    const { container } = render(
      <RequestActions
        requestId={REQUEST_ID}
        reference="FF-2026-00012"
        customerName="Amara Okafor"
        status="CANCELLED"
        actions={[]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("offers only what the server lists", () => {
    renderActions({ actions: [START_REVIEW] });

    expect(button("Start review")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });
});

describe("RequestActions: starting the review", () => {
  it("sends the action with the status the page showed, confirms only after the server answers, then reloads", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = renderActions();

    await user.click(button("Start review"));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/requests/${REQUEST_ID}/status`, {
      method: "PATCH",
      body: { action: "START_REVIEW", expectedStatus: "SUBMITTED" },
    });
    expect(toastSuccess).toHaveBeenCalledWith("FF-2026-00012 is under review", {
      description: "Amara Okafor sees it as Under review.",
    });
  });

  it("blocks a second click while the change is pending", async () => {
    let finish: () => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({});
      }),
    );
    const user = renderActions();

    await user.click(button("Start review"));
    const pending = button("Start review");
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Starting review…");
    await user.click(pending);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(button("More actions")).toBeDisabled();
    expect(toastSuccess).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
  });

  it("says why it failed, announces nothing as done, and offers the button again", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const user = renderActions();

    await user.click(button("Start review"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(button("Start review")).toBeEnabled();
  });

  it("reloads the page and says so when someone else changed the request first", async () => {
    apiFetchMock.mockRejectedValue(
      conflict(
        "STALE_STATE",
        "This request was updated by someone else. Refresh to see the latest status.",
      ),
    );
    const user = renderActions();

    await user.click(button("Start review"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Someone else changed this request, so the page has been reloaded.",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("reloads the page and gives the server's reason when the change is not allowed", async () => {
    apiFetchMock.mockRejectedValue(
      conflict(
        "INVALID_STATE_TRANSITION",
        "This request is cancelled, so it can no longer be changed.",
      ),
    );
    const user = renderActions();

    await user.click(button("Start review"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This request is cancelled, so it can no longer be changed.",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("RequestActions: cancelling", () => {
  it("asks what will happen and who reads what, before anything is sent", async () => {
    const user = renderActions();
    const dialog = await openCancelDialog(user);

    expect(dialog).toHaveAccessibleDescription(/cannot be reopened/);
    expect(dialog).toHaveAccessibleDescription(/Amara Okafor is told it was cancelled/);
    expect(dialog).toHaveAccessibleDescription(/Your reason stays inside the business/);
    expect(within(dialog).getByLabelText(/Reason \(internal\)/)).toBeVisible();
    expect(within(dialog).getByLabelText("Message to the customer")).toBeVisible();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("needs a reason before the cancel button can be used, but not a message", async () => {
    const user = renderActions();
    const dialog = await openCancelDialog(user);
    const confirm = within(dialog).getByRole("button", { name: "Cancel request" });

    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason \(internal\)/), "abcd");
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason \(internal\)/), "e");
    expect(confirm).toBeEnabled();
  });

  it("sends the reason and the customer's message separately, with the status the page showed", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = renderActions();
    const dialog = await openCancelDialog(user);

    await user.type(
      within(dialog).getByLabelText(/Reason \(internal\)/),
      "Outside our service area",
    );
    await user.type(
      within(dialog).getByLabelText("Message to the customer"),
      "Sorry, we can't reach your street.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel request" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/requests/${REQUEST_ID}/status`, {
      method: "PATCH",
      body: {
        action: "CANCEL",
        expectedStatus: "SUBMITTED",
        reason: "Outside our service area",
        customerMessage: "Sorry, we can't reach your street.",
      },
    });
    expect(toastSuccess).toHaveBeenCalledWith("FF-2026-00012 was cancelled", expect.anything());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("sends no message at all when none is written, so the customer gets the standard wording", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = renderActions();
    const dialog = await openCancelDialog(user);

    await user.type(
      within(dialog).getByLabelText(/Reason \(internal\)/),
      "Duplicate of FF-2026-00009",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel request" }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const body = (apiFetchMock.mock.calls[0]?.[1] as { body: Record<string, unknown> }).body;
    expect(body).toEqual({
      action: "CANCEL",
      expectedStatus: "SUBMITTED",
      reason: "Duplicate of FF-2026-00009",
    });
    expect(body).not.toHaveProperty("customerMessage");
  });

  it("keeps the dialog open with the server's reason when the cancellation fails, and keeps what was typed", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 422, code: "VALIDATION_ERROR", message: "Enter a reason." }),
    );
    const user = renderActions();
    const dialog = await openCancelDialog(user);
    await user.type(
      within(dialog).getByLabelText(/Reason \(internal\)/),
      "Outside our service area",
    );

    await user.click(within(dialog).getByRole("button", { name: "Cancel request" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Enter a reason.");
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(within(dialog).getByLabelText(/Reason \(internal\)/)).toHaveValue(
      "Outside our service area",
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reloads the page behind the dialog when the request has moved on", async () => {
    apiFetchMock.mockRejectedValue(
      conflict(
        "INVALID_STATE_TRANSITION",
        "This request is cancelled, so it can no longer be changed.",
      ),
    );
    const user = renderActions();
    const dialog = await openCancelDialog(user);
    await user.type(
      within(dialog).getByLabelText(/Reason \(internal\)/),
      "Outside our service area",
    );

    await user.click(within(dialog).getByRole("button", { name: "Cancel request" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This request is cancelled, so it can no longer be changed.",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the person keeps the request", async () => {
    const user = renderActions();
    const dialog = await openCancelDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Keep request" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("gives focus back to the menu button when the dialog closes", async () => {
    const user = renderActions();
    const dialog = await openCancelDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Keep request" }));

    await waitFor(() => expect(button("More actions")).toHaveFocus());
  });
});

describe("RequestActions: reopening", () => {
  it("asks for a reason, says where the request goes, and sends the reason", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = renderActions({ status: "DECLINED", actions: [REOPEN, CANCEL] });

    await user.click(button("Reopen request"));
    const dialog = await screen.findByRole("alertdialog", { name: "Reopen FF-2026-00012?" });
    expect(dialog).toHaveAccessibleDescription(/back under review/);
    expect(dialog).toHaveAccessibleDescription(/saved as an internal note/);
    expect(within(dialog).queryByLabelText("Message to the customer")).not.toBeInTheDocument();

    await user.type(
      within(dialog).getByLabelText(/Reason \(internal\)/),
      "Customer changed their mind",
    );
    await user.click(within(dialog).getByRole("button", { name: "Reopen request" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/requests/${REQUEST_ID}/status`, {
      method: "PATCH",
      body: {
        action: "REOPEN",
        expectedStatus: "DECLINED",
        reason: "Customer changed their mind",
      },
    });
    expect(toastSuccess).toHaveBeenCalledWith("FF-2026-00012 was reopened", expect.anything());
  });
});

describe("RequestActions: creating a quotation (FR-040)", () => {
  const DRAFT_ID = "6f1c7a0e-5d0b-4f55-9d52-0d8d1c3b8a11";

  it("offers Create quotation as the main step of a request under review", async () => {
    const user = renderActions({ status: "UNDER_REVIEW", actions: [CREATE_QUOTATION, CANCEL] });

    expect(button("Create quotation")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Start review" })).not.toBeInTheDocument();
    await user.click(button("More actions"));
    expect(await screen.findByRole("menuitem", { name: "Cancel request" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Create quotation" })).not.toBeInTheDocument();
  });

  it("creates the draft on the server and opens its editor, announcing nothing it has not done", async () => {
    apiFetchMock.mockResolvedValue({ id: DRAFT_ID });
    const user = renderActions({ status: "UNDER_REVIEW", actions: [CREATE_QUOTATION, CANCEL] });

    await user.click(button("Create quotation"));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/quotations/${DRAFT_ID}`));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/requests/${REQUEST_ID}/quotations`, {
      method: "POST",
      body: {},
    });
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("blocks a second click while the draft is being created, and the rest of the actions too", async () => {
    let finish: () => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ id: DRAFT_ID });
      }),
    );
    const user = renderActions({ status: "UNDER_REVIEW", actions: [CREATE_QUOTATION, CANCEL] });

    await user.click(button("Create quotation"));
    const pending = button("Create quotation");
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Creating the draft…");
    await user.click(pending);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(button("More actions")).toBeDisabled();

    finish();
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it("opens the draft that already exists instead of failing when a colleague just made one", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "DRAFT_EXISTS",
        message: "This request already has a draft quotation (QT-2026-00004).",
        details: { quotationId: DRAFT_ID },
      }),
    );
    const user = renderActions({ status: "UNDER_REVIEW", actions: [CREATE_QUOTATION, CANCEL] });

    await user.click(button("Create quotation"));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/quotations/${DRAFT_ID}`));
    expect(toastInfo).toHaveBeenCalledWith("This request already has a draft", expect.anything());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says why it failed, frees the button, and reloads the page when the request has moved on", async () => {
    apiFetchMock.mockRejectedValue(
      conflict("INVALID_STATE_TRANSITION", "This request is cancelled, so it can't be quoted."),
    );
    const user = renderActions({ status: "UNDER_REVIEW", actions: [CREATE_QUOTATION, CANCEL] });

    await user.click(button("Create quotation"));

    expect(await screen.findByRole("alert")).toHaveTextContent("This request is cancelled");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(button("Create quotation")).toBeEnabled();
  });
});

describe("RequestActions: creating the job (T17)", () => {
  const QUOTATION = "6f1c7a0e-5d0b-4f55-9d52-0d8d1c3b8a11";
  const { CREATE_WORK_ORDER } = RequestAction;

  it("puts 'Create job' on the button of an accepted request, with cancelling in the menu", async () => {
    const user = renderActions({
      status: "ACCEPTED",
      actions: [CREATE_WORK_ORDER, CANCEL],
      acceptedQuotationId: QUOTATION,
    });

    expect(button("Create job")).toBeEnabled();
    await user.click(button("More actions"));
    expect(await screen.findByRole("menuitem", { name: "Cancel request" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Create job" })).not.toBeInTheDocument();
  });

  it("makes the job from the accepted quotation and opens it for scheduling", async () => {
    apiFetchMock.mockResolvedValue({ id: "job-1" });
    const user = renderActions({
      status: "ACCEPTED",
      actions: [CREATE_WORK_ORDER, CANCEL],
      acceptedQuotationId: QUOTATION,
    });

    await user.click(button("Create job"));

    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/quotations/${QUOTATION}/work-order`, {
      method: "POST",
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/jobs/job-1?schedule=1"));
  });

  it("draws no button when the server lists the action but the accepted quotation is not known", () => {
    renderActions({ status: "ACCEPTED", actions: [CREATE_WORK_ORDER], acceptedQuotationId: null });
    expect(screen.queryByRole("button", { name: "Create job" })).not.toBeInTheDocument();
  });

  it("offers no 'Create job' for a request the server does not list it for", () => {
    renderActions({ status: "UNDER_REVIEW", actions: [CREATE_QUOTATION, CANCEL] });
    expect(screen.queryByRole("button", { name: "Create job" })).not.toBeInTheDocument();
  });
});
