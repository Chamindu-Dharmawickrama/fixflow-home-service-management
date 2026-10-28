"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/sonner";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Accept and decline, each behind a confirmation that spells out the consequence (UX-INT-02).
 * The buttons stack and fill the width on phones, where these are the page's primary actions.
 */
export function DecisionActions() {
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" onClick={() => setAccepting(true)}>
          Accept quotation
        </Button>
        <Button size="lg" variant="outline" onClick={() => setDeclining(true)}>
          Decline
        </Button>
      </div>

      <ConfirmDialog
        open={accepting}
        onOpenChange={setAccepting}
        title="Accept this quotation?"
        consequence={
          <p>
            You agree to the work and prices in QT-2026-00042, <strong>$360.18</strong> including
            tax. We will then contact you to confirm a date. You can&apos;t change your answer
            afterwards.
          </p>
        }
        confirmLabel="Accept quotation"
        onConfirm={async () => {
          await wait(600);
          toast.info("Example screen: nothing was changed.");
        }}
      />
      <ConfirmDialog
        open={declining}
        onOpenChange={setDeclining}
        title="Decline this quotation?"
        consequence={
          <p>
            No work will be scheduled and the request will be closed. You can always send a new
            request later. You can&apos;t change your answer afterwards.
          </p>
        }
        confirmLabel="Decline quotation"
        cancelLabel="Go back"
        destructive
        onConfirm={async () => {
          await wait(600);
          toast.info("Example screen: nothing was changed.");
        }}
      />
    </>
  );
}
