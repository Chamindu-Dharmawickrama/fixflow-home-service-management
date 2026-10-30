import type { AdminCustomerNoteDto } from "@fixflow/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { CUSTOMER_ID } from "../test-fixtures";
import { CustomerNotesPanel } from "./customer-notes-panel";

const refresh = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const TZ = "America/New_York";

const OLDER: AdminCustomerNoteDto = {
  id: "n1",
  body: "Prefers calls after 5pm.\nDo not text.",
  author: { name: "Dana Whitfield" },
  createdAt: "2026-10-30T15:00:00.000Z",
};
const NEWER: AdminCustomerNoteDto = {
  id: "n2",
  body: "Gate code changed to 7712.",
  author: { name: "Jordan Lee" },
  createdAt: "2026-10-31T16:30:00.000Z",
};

function renderPanel(notes: AdminCustomerNoteDto[] = [], noteCount = notes.length) {
  const user = userEvent.setup();
  render(
    <CustomerNotesPanel
      customerId={CUSTOMER_ID}
      notes={notes}
      noteCount={noteCount}
      timeZone={TZ}
    />,
  );
  return user;
}

const noteBox = () => screen.getByRole("textbox", { name: /^Note/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CustomerNotesPanel: what it says", () => {
  it("states in words that nothing here reaches the customer", () => {
    renderPanel();

    expect(screen.getByRole("heading", { level: 2, name: "Internal notes" })).toBeVisible();
    expect(screen.getByText("Internal — never shown to the customer")).toBeVisible();
  });

  it("invites the first note when there are none", () => {
    renderPanel();

    expect(screen.getByText(/No internal notes yet/)).toBeVisible();
    expect(
      screen.queryByRole("list", { name: "Internal notes about this customer" }),
    ).not.toBeInTheDocument();
  });

  it("lists the notes as given, each with its author and time", () => {
    renderPanel([NEWER, OLDER]);

    const items = within(
      screen.getByRole("list", { name: "Internal notes about this customer" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(2);

    const newer = within(items[0] as HTMLElement);
    expect(newer.getByText("Gate code changed to 7712.")).toBeVisible();
    expect(newer.getByText(/Jordan Lee ·/)).toBeVisible();
    expect(newer.getByText("Oct 31, 2026, 12:30 PM")).toBeVisible();

    const older = within(items[1] as HTMLElement);
    expect(older.getByText(/Dana Whitfield ·/)).toBeVisible();
    expect(older.getByText("Oct 30, 2026, 11:00 AM")).toBeVisible();
  });

  it("keeps the line breaks of a note", () => {
    renderPanel([OLDER]);

    expect(screen.getByText(/Prefers calls after 5pm\./)).toHaveClass("whitespace-pre-line");
  });

  it("has nothing to choose about who can see a note", () => {
    renderPanel();

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Who can see/ })).not.toBeInTheDocument();
  });

  it("says when the list is cut short and how many notes there are", () => {
    renderPanel([NEWER, OLDER], 63);

    expect(screen.getByText("Showing the latest 2 of 63 notes.")).toBeVisible();
  });

  it("says nothing about a cut when every note is shown", () => {
    renderPanel([NEWER, OLDER]);

    expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument();
  });
});

describe("CustomerNotesPanel: adding a note", () => {
  it("will not send an empty note, and says why beside the field", async () => {
    const user = renderPanel();

    await user.type(noteBox(), "   ");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByText("Write the note before adding it.")).toBeVisible();
    expect(noteBox()).toBeInvalid();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("sends the note to the customer's own address, trimmed, and nothing else", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = renderPanel();

    await user.type(noteBox(), "  Prefers calls after 5pm.  ");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/customers/${CUSTOMER_ID}/notes`, {
      method: "POST",
      body: { body: "Prefers calls after 5pm." },
    });
  });

  it("confirms only after the server answers, then clears the form and reloads", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = renderPanel();

    await user.type(noteBox(), "Prefers calls after 5pm.");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Internal note added"));
    expect(noteBox()).toHaveValue("");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("blocks a second send while the first is pending", async () => {
    let finish: () => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({});
      }),
    );
    const user = renderPanel();

    await user.type(noteBox(), "Prefers calls after 5pm.");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    const busy = screen.getByRole("button", { name: "Add note" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    await user.click(busy);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
  });

  it("keeps what was typed and says why when saving fails, and announces nothing as done", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Something went wrong." }),
    );
    const user = renderPanel();

    await user.type(noteBox(), "Prefers calls after 5pm.");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(noteBox()).toHaveValue("Prefers calls after 5pm.");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the API's message beside the note when it refuses the text", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Please check the highlighted fields.",
        fieldErrors: { body: "A note must be 2000 characters or fewer." },
      }),
    );
    const user = renderPanel();

    await user.type(noteBox(), "Prefers calls after 5pm.");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByText("A note must be 2000 characters or fewer.")).toBeVisible();
    expect(noteBox()).toBeInvalid();
    expect(noteBox()).toHaveValue("Prefers calls after 5pm.");
  });

  it("shows how much of the limit is used", async () => {
    const user = renderPanel();

    await user.type(noteBox(), "abc");

    expect(screen.getByText(/3 \/ 2000/)).toBeVisible();
  });
});
