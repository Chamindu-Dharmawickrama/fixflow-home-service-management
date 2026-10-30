import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";

type Props = Partial<Omit<ConfirmDialogProps, "open" | "onOpenChange">>;

/** Opens the dialog from a real button, like a page does, so focus return can be checked. */
function Harness(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Void invoice INV-2026-00007?"
        consequence={<p>The invoice stays in the history marked Void.</p>}
        confirmLabel="Void invoice"
        onConfirm={() => undefined}
        {...props}
      />
    </>
  );
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  return screen.findByRole("alertdialog");
}

const REASON = { label: "Reason for voiding", minLength: 10 };

describe("ConfirmDialog", () => {
  it("names the action and explains the consequence", async () => {
    render(<Harness />);
    const dialog = await openDialog();

    expect(dialog).toHaveAccessibleName("Void invoice INV-2026-00007?");
    expect(dialog).toHaveAccessibleDescription("The invoice stays in the history marked Void.");
    expect(screen.getByRole("button", { name: "Void invoice" })).toBeEnabled();
  });

  it("starts on Cancel, the safe choice, when there is no reason to type", async () => {
    render(<Harness />);
    await openDialog();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  it("calls onConfirm and closes when confirmed", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Void invoice" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("does not call onConfirm when cancelled, and returns focus to the control that opened it", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    // Radix restores focus on the next tick after the dialog unmounts.
    await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toHaveFocus());
  });

  it("closes on Escape and returns focus", async () => {
    render(<Harness />);
    await openDialog();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    // Radix restores focus on the next tick after the dialog unmounts.
    await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toHaveFocus());
  });

  it("uses the destructive style and a custom cancel label when asked", async () => {
    render(<Harness destructive cancelLabel="Keep invoice" />);
    await openDialog();
    expect(screen.getByRole("button", { name: "Void invoice" }).className).toContain("bg-danger");
    expect(screen.getByRole("button", { name: "Keep invoice" })).toBeVisible();
  });

  describe("with a required reason", () => {
    it("keeps confirm disabled until the reason is long enough", async () => {
      const onConfirm = vi.fn();
      render(<Harness reason={REASON} onConfirm={onConfirm} />);
      await openDialog();

      const confirm = screen.getByRole("button", { name: "Void invoice" });
      const reason = screen.getByLabelText(/Reason for voiding/);

      expect(confirm).toBeDisabled();

      await userEvent.type(reason, "too short");
      expect(confirm).toBeDisabled();

      await userEvent.type(reason, " but now long enough");
      expect(confirm).toBeEnabled();
    });

    it("does not count surrounding spaces towards the minimum", async () => {
      render(<Harness reason={REASON} />);
      await openDialog();
      await userEvent.type(screen.getByLabelText(/Reason for voiding/), "      abc      ");
      expect(screen.getByRole("button", { name: "Void invoice" })).toBeDisabled();
    });

    it("passes the trimmed reason to onConfirm", async () => {
      const onConfirm = vi.fn();
      render(<Harness reason={REASON} onConfirm={onConfirm} />);
      await openDialog();

      await userEvent.type(
        screen.getByLabelText(/Reason for voiding/),
        "  Issued to the wrong address  ",
      );
      await userEvent.click(screen.getByRole("button", { name: "Void invoice" }));

      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("Issued to the wrong address"));
    });

    it("moves focus to the reason box when it opens, and states the minimum", async () => {
      render(<Harness reason={{ ...REASON, description: "Shown in the history." }} />);
      await openDialog();

      const reason = screen.getByLabelText(/Reason for voiding/);
      expect(reason).toHaveFocus();
      expect(reason).toHaveAccessibleDescription(
        /Shown in the history\. Enter at least 10 characters\./,
      );
      expect(reason).toHaveAttribute("aria-required", "true");
    });

    it("starts empty again the next time it opens", async () => {
      render(<Harness reason={REASON} />);
      await openDialog();
      await userEvent.type(screen.getByLabelText(/Reason for voiding/), "something typed earlier");
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

      await openDialog();
      expect(screen.getByLabelText(/Reason for voiding/)).toHaveValue("");
      expect(screen.getByRole("button", { name: "Void invoice" })).toBeDisabled();
    });
  });

  describe("with a second, optional piece of text", () => {
    const SECONDARY = {
      label: "Message to the customer",
      description: "The customer reads this.",
    };

    it("shows it beside the reason, optional, and never blocks confirm", async () => {
      render(<Harness reason={REASON} secondary={SECONDARY} />);
      await openDialog();

      const secondary = screen.getByLabelText("Message to the customer");
      expect(secondary).toHaveAccessibleDescription(/The customer reads this\./);
      expect(secondary).not.toHaveAttribute("aria-required");
      await userEvent.type(screen.getByLabelText(/Reason for voiding/), "A long enough reason");
      expect(screen.getByRole("button", { name: "Void invoice" })).toBeEnabled();
    });

    it("passes the trimmed reason and the trimmed secondary text to onConfirm", async () => {
      const onConfirm = vi.fn();
      render(<Harness reason={REASON} secondary={SECONDARY} onConfirm={onConfirm} />);
      await openDialog();

      await userEvent.type(screen.getByLabelText(/Reason for voiding/), "A long enough reason");
      await userEvent.type(
        screen.getByLabelText("Message to the customer"),
        "  Sorry about this.  ",
      );
      await userEvent.click(screen.getByRole("button", { name: "Void invoice" }));

      await waitFor(() =>
        expect(onConfirm).toHaveBeenCalledWith("A long enough reason", "Sorry about this."),
      );
    });

    it("passes undefined when the secondary text is left empty or blank", async () => {
      const onConfirm = vi.fn();
      render(<Harness reason={REASON} secondary={SECONDARY} onConfirm={onConfirm} />);
      await openDialog();

      await userEvent.type(screen.getByLabelText(/Reason for voiding/), "A long enough reason");
      await userEvent.type(screen.getByLabelText("Message to the customer"), "    ");
      await userEvent.click(screen.getByRole("button", { name: "Void invoice" }));

      await waitFor(() =>
        expect(onConfirm).toHaveBeenCalledWith("A long enough reason", undefined),
      );
    });

    it("starts empty again the next time it opens", async () => {
      render(<Harness reason={REASON} secondary={SECONDARY} />);
      await openDialog();
      await userEvent.type(screen.getByLabelText("Message to the customer"), "typed earlier");
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

      await openDialog();
      expect(screen.getByLabelText("Message to the customer")).toHaveValue("");
    });

    it("does not appear, and does not change what onConfirm receives, when it is not asked for", async () => {
      const onConfirm = vi.fn();
      render(<Harness reason={REASON} onConfirm={onConfirm} />);
      await openDialog();

      expect(screen.queryByLabelText("Message to the customer")).toBeNull();
      await userEvent.type(screen.getByLabelText(/Reason for voiding/), "A long enough reason");
      await userEvent.click(screen.getByRole("button", { name: "Void invoice" }));

      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("A long enough reason"));
    });
  });

  describe("while the action is pending", () => {
    function deferred() {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("blocks a second confirm, the cancel button and Escape", async () => {
      const pending = deferred();
      const onConfirm = vi.fn(() => pending.promise);
      render(<Harness onConfirm={onConfirm} />);
      await openDialog();

      await userEvent.click(screen.getByRole("button", { name: "Void invoice" }));
      const confirm = screen.getByRole("button", { name: "Void invoice" });
      expect(confirm).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

      await userEvent.click(confirm);
      await userEvent.keyboard("{Escape}");
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("alertdialog")).toBeVisible();

      pending.resolve();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });

    it("stays open and shows the error when the action fails, then lets the person try again", async () => {
      const onConfirm = vi
        .fn<ConfirmDialogProps["onConfirm"]>()
        .mockRejectedValueOnce(new Error("The invoice was changed by someone else."))
        .mockResolvedValueOnce(undefined);
      render(<Harness onConfirm={onConfirm} />);
      await openDialog();

      await userEvent.click(screen.getByRole("button", { name: "Void invoice" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The invoice was changed by someone else.",
      );
      expect(screen.getByRole("alertdialog")).toBeVisible();
      expect(screen.getByRole("button", { name: "Void invoice" })).not.toHaveAttribute("aria-busy");

      await userEvent.click(screen.getByRole("button", { name: "Void invoice" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });

    it("shows a generic message when the failure has no usable message", async () => {
      render(<Harness onConfirm={() => Promise.reject(new Error(""))} />);
      await openDialog();
      await userEvent.click(screen.getByRole("button", { name: "Void invoice" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The action could not be completed. Please try again.",
      );
    });
  });
});
