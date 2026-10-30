import type { AdminRequestNoteDto } from "@fixflow/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { REQUEST_ID } from "../test-fixtures";
import { RequestNotesPanel } from "./request-notes-panel";

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

const INTERNAL: AdminRequestNoteDto = {
  id: "n1",
  body: "Called twice, no answer.\nTry again after 5pm.",
  visibility: "INTERNAL",
  author: { name: "Dana Whitfield" },
  createdAt: "2026-10-31T15:00:00.000Z",
};
const SHARED: AdminRequestNoteDto = {
  id: "n2",
  body: "We will bring a replacement capacitor.",
  visibility: "CUSTOMER_VISIBLE",
  author: { name: "Dana Whitfield" },
  createdAt: "2026-10-31T16:30:00.000Z",
};

function renderPanel(notes: AdminRequestNoteDto[] = []) {
  const user = userEvent.setup();
  render(<RequestNotesPanel requestId={REQUEST_ID} notes={notes} timeZone={TZ} />);
  return user;
}

const noteBox = () => screen.getByRole("textbox", { name: /^Note/ });
const internalChoice = () => screen.getByRole("radio", { name: /^Internal/ });
const sharedChoice = () => screen.getByRole("radio", { name: /^Shared with the customer/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RequestNotesPanel: the notes", () => {
  it("says so, and invites the first note, when there are none", () => {
    renderPanel();

    expect(screen.getByRole("heading", { level: 2, name: "Notes" })).toBeVisible();
    expect(screen.getByText(/No notes yet/)).toBeVisible();
    expect(screen.queryByRole("list", { name: "Notes on this request" })).not.toBeInTheDocument();
  });

  it("lists every note with who can read it, in words, who wrote it and when", () => {
    renderPanel([SHARED, INTERNAL]);

    const items = within(screen.getByRole("list", { name: "Notes on this request" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(2);

    const shared = within(items[0] as HTMLElement);
    expect(shared.getByText("Shared with the customer")).toBeVisible();
    expect(shared.getByText("We will bring a replacement capacitor.")).toBeVisible();
    expect(shared.getByText(/Dana Whitfield ·/)).toBeVisible();
    expect(shared.getByText("Oct 31, 2026, 12:30 PM")).toBeVisible();

    const internal = within(items[1] as HTMLElement);
    expect(internal.getByText("Internal")).toBeVisible();
    expect(internal.getByText(/Called twice, no answer\./)).toBeVisible();
    expect(internal.queryByText("Shared with the customer")).not.toBeInTheDocument();
  });

  it("keeps the line breaks of a note", () => {
    renderPanel([INTERNAL]);

    expect(screen.getByText(/Called twice, no answer\./)).toHaveClass("whitespace-pre-line");
  });
});

describe("RequestNotesPanel: adding a note", () => {
  it("starts as an internal note, so sharing is always a choice", () => {
    renderPanel();

    expect(internalChoice()).toBeChecked();
    expect(sharedChoice()).not.toBeChecked();
    expect(screen.getByRole("group", { name: /Who can see this note/ })).toBeVisible();
    expect(screen.getByText("The customer reads it on their request page.")).toBeVisible();
  });

  it("will not send an empty note, and says why beside the field", async () => {
    const user = renderPanel();

    await user.type(noteBox(), "   ");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByText("Write the note before adding it.")).toBeVisible();
    expect(noteBox()).toBeInvalid();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("sends an internal note, confirms after the server answers, clears the form and reloads", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = renderPanel();

    await user.type(noteBox(), "  Left a voicemail.  ");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/requests/${REQUEST_ID}/notes`, {
      method: "POST",
      body: { body: "Left a voicemail.", visibility: "INTERNAL" },
    });
    expect(toastSuccess).toHaveBeenCalledWith("Internal note added");
    expect(noteBox()).toHaveValue("");
    expect(internalChoice()).toBeChecked();
  });

  it("sends a note for the customer when that is chosen, and says so", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = renderPanel();

    await user.type(noteBox(), "We will call you tomorrow morning.");
    await user.click(sharedChoice());
    expect(sharedChoice()).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/requests/${REQUEST_ID}/notes`, {
      method: "POST",
      body: { body: "We will call you tomorrow morning.", visibility: "CUSTOMER_VISIBLE" },
    });
    expect(toastSuccess).toHaveBeenCalledWith("Note added and shared with the customer");
  });

  it("goes back to internal after a shared note, so the next note is not shared by accident", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = renderPanel();

    await user.type(noteBox(), "We will call you tomorrow morning.");
    await user.click(sharedChoice());
    await user.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => expect(internalChoice()).toBeChecked());
    expect(sharedChoice()).not.toBeChecked();
  });

  it("lets the visibility be chosen with the arrow keys", async () => {
    const user = renderPanel();

    await user.type(noteBox(), "Gate code is 4821.");
    await user.tab();
    expect(internalChoice()).toHaveFocus();
    // Radix moves focus on the next tick and selects only if the arrow is still held down.
    await user.keyboard("{ArrowDown>}");
    await waitFor(() => expect(sharedChoice()).toBeChecked());
    await user.keyboard("{/ArrowDown}");
    expect(internalChoice()).not.toBeChecked();
  });

  it("blocks a second send while the first is pending", async () => {
    let finish: () => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({});
      }),
    );
    const user = renderPanel();

    await user.type(noteBox(), "Left a voicemail.");
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

    await user.type(noteBox(), "Left a voicemail.");
    await user.click(sharedChoice());
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(noteBox()).toHaveValue("Left a voicemail.");
    expect(sharedChoice()).toBeChecked();
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

    await user.type(noteBox(), "Left a voicemail.");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByText("A note must be 2000 characters or fewer.")).toBeVisible();
    expect(noteBox()).toBeInvalid();
    expect(noteBox()).toHaveValue("Left a voicemail.");
  });

  it("shows how much of the limit is used", async () => {
    const user = renderPanel();

    await user.type(noteBox(), "abc");

    expect(screen.getByText(/3 \/ 2000/)).toBeVisible();
  });
});
