import type { AdminServiceDto } from "@fixflow/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

import { ServiceVisibilityCard, type ServiceVisibilityCardProps } from "./service-visibility-card";

const refresh = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

const STATES: Record<string, ServiceVisibilityCardProps["service"]> = {
  published: {
    id: ID,
    name: "AC Routine Maintenance",
    status: "PUBLISHED",
    availableActions: ["EDIT", "UNPUBLISH", "ARCHIVE"],
  },
  unpublished: {
    id: ID,
    name: "AC Routine Maintenance",
    status: "UNPUBLISHED",
    availableActions: ["EDIT", "PUBLISH", "ARCHIVE"],
  },
  archived: {
    id: ID,
    name: "AC Routine Maintenance",
    status: "ARCHIVED",
    availableActions: ["EDIT", "RESTORE"],
  },
};

function renderCard(
  state: keyof typeof STATES,
  extra: Partial<ServiceVisibilityCardProps> = {},
): void {
  render(<ServiceVisibilityCard service={STATES[state] as AdminServiceDto} {...extra} />);
}

const toggle = () => screen.getByRole("switch", { name: "Published on the website" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServiceVisibilityCard: what it offers (D-43)", () => {
  it("offers unpublish and archive on a published service", () => {
    renderCard("published");

    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(toggle()).toBeChecked();
    expect(screen.getByRole("button", { name: "Archive service" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore service" })).not.toBeInTheDocument();
  });

  it("offers publish and archive on an unpublished service", () => {
    renderCard("unpublished");

    expect(screen.getByText("Unpublished")).toBeInTheDocument();
    expect(toggle()).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Archive service" })).toBeInTheDocument();
  });

  it("offers only restore on an archived service: it cannot be published", () => {
    renderCard("archived");

    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive service" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore service" })).toBeInTheDocument();
  });

  it("shows exactly what the server lists and nothing else", () => {
    render(
      <ServiceVisibilityCard service={{ ...STATES.published!, availableActions: ["EDIT"] }} />,
    );

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /service$/ })).not.toBeInTheDocument();
  });
});

describe("ServiceVisibilityCard: publishing", () => {
  it("publishes with the status it was shown, and confirms once the server has answered", async () => {
    let finish: () => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = () => {
          resolve({});
        };
      }),
    );
    const user = userEvent.setup();
    renderCard("unpublished");

    await user.click(toggle());

    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/services/${ID}`, {
      method: "PATCH",
      body: { isPublished: true, expectedStatus: "UNPUBLISHED" },
    });
    // Waiting: the switch still shows the truth (unpublished) and cannot be pressed again.
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toBeDisabled();
    expect(toastSuccess).not.toHaveBeenCalled();

    finish();

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith(
        "“AC Routine Maintenance” is published",
        expect.objectContaining({
          description: expect.stringContaining("appears on the website") as string,
        }),
      );
    });
    expect(refresh).toHaveBeenCalled();
    expect(toggle()).toBeEnabled();
  });

  it("unpublishes", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderCard("published");

    await user.click(toggle());

    expect(apiFetchMock).toHaveBeenCalledWith(`/admin/services/${ID}`, {
      method: "PATCH",
      body: { isPublished: false, expectedStatus: "PUBLISHED" },
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith(
        "“AC Routine Maintenance” is unpublished",
        expect.anything(),
      );
    });
  });

  it("shows the server's reason when it refuses, announces nothing, and reloads if the service moved on", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "STALE_STATE",
        message: "This service was changed by someone else. Reload it and try again.",
      }),
    );
    const user = userEvent.setup();
    renderCard("unpublished");

    await user.click(toggle());

    expect(await screen.findByRole("alert")).toHaveTextContent("changed by someone else");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(toggle()).not.toBeChecked();
  });

  it("does not reload for an error that is not about a changed service", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({ status: 0, code: "NETWORK_ERROR", message: "We couldn't reach the server." }),
    );
    const user = userEvent.setup();
    renderCard("unpublished");

    await user.click(toggle());

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ServiceVisibilityCard: archiving and restoring", () => {
  it("explains what archiving does before doing it", async () => {
    const user = userEvent.setup();
    renderCard("published");

    await user.click(screen.getByRole("button", { name: "Archive service" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "Archive “AC Routine Maintenance”?" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Archived services are hidden from the website and can't be requested. Existing requests are unaffected.",
    );
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when the person cancels", async () => {
    const user = userEvent.setup();
    renderCard("published");
    await user.click(screen.getByRole("button", { name: "Archive service" }));

    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("archives on confirmation, with the status it was shown", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderCard("published");
    await user.click(screen.getByRole("button", { name: "Archive service" }));

    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Archive service",
      }),
    );

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(`/admin/services/${ID}/archive`, {
        method: "POST",
        body: { expectedStatus: "PUBLISHED" },
      });
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith(
        "“AC Routine Maintenance” is archived",
        expect.anything(),
      );
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the dialog open and shows the reason when archiving is refused", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "INVALID_STATE_TRANSITION",
        message: "You can't archive a service that is archived.",
      }),
    );
    const user = userEvent.setup();
    renderCard("unpublished");
    await user.click(screen.getByRole("button", { name: "Archive service" }));

    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Archive service",
      }),
    );

    expect(
      await within(screen.getByRole("alertdialog")).findByText(
        "You can't archive a service that is archived.",
      ),
    ).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("says that a restored service comes back unpublished", async () => {
    apiFetchMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderCard("archived");

    await user.click(screen.getByRole("button", { name: "Restore service" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("comes back as unpublished");
    await user.click(within(dialog).getByRole("button", { name: "Restore service" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(`/admin/services/${ID}/restore`, {
        method: "POST",
        body: { expectedStatus: "ARCHIVED" },
      });
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith(
        "“AC Routine Maintenance” is restored",
        expect.objectContaining({ description: expect.stringContaining("unpublished") as string }),
      );
    });
  });
});

describe("ServiceVisibilityCard: disabled", () => {
  it("blocks every control and gives the reason when told to", () => {
    renderCard("published", { disabled: true, reason: "Save or discard your changes first." });

    expect(toggle()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive service" })).toBeDisabled();
    expect(screen.getByText("Save or discard your changes first.")).toBeInTheDocument();
  });

  it("does not show the reason when nothing is blocked", () => {
    renderCard("published", { reason: "Save or discard your changes first." });

    expect(screen.queryByText("Save or discard your changes first.")).not.toBeInTheDocument();
    expect(toggle()).toBeEnabled();
  });
});
