"use client";

import { ClipboardCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/sonner";

type Action = "review" | "cancel";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The request's actions: the single most likely next step first, then the destructive one behind
 * a confirmation that asks for a reason. On the real screen the server decides which actions are
 * available (`availableActions`) and these call the API; here they only demonstrate the pattern.
 */
export function RequestActions() {
  const [action, setAction] = useState<Action>("review");
  const [open, setOpen] = useState(false);

  const start = (next: Action) => {
    setAction(next);
    setOpen(true);
  };

  return (
    <>
      <Button onClick={() => start("review")}>
        <ClipboardCheck aria-hidden="true" />
        Start review
      </Button>
      <Button variant="outline" onClick={() => start("cancel")}>
        Cancel request
      </Button>

      {action === "review" ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Start reviewing FF-2026-00125?"
          consequence={
            <p>
              The request moves to <strong>Under review</strong> and Morgan Reyes sees that you are
              looking at it. You can then prepare a quotation.
            </p>
          }
          confirmLabel="Start review"
          onConfirm={async () => {
            await wait(600);
            toast.info("Example screen: nothing was changed.");
          }}
        />
      ) : (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Cancel request FF-2026-00125?"
          consequence={
            <p>
              The request is closed and Morgan Reyes is told it was cancelled. It stays in the
              history with your reason and cannot be reopened.
            </p>
          }
          confirmLabel="Cancel request"
          cancelLabel="Keep request"
          destructive
          reason={{
            label: "Reason for cancelling",
            minLength: 10,
            description: "The customer sees this reason.",
            placeholder: "For example: outside our service area",
          }}
          onConfirm={async () => {
            await wait(600);
            toast.info("Example screen: nothing was changed.");
          }}
        />
      )}
    </>
  );
}
