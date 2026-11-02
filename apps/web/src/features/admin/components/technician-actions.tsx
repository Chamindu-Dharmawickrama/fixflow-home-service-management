"use client";

import { type AdminTechnicianDto, TechnicianAction } from "@fixflow/shared";
import { Pencil, UserCheck, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/sonner";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import { deactivateConsequence, deactivatedMessage } from "../lib/technicians";
import { TechnicianSheet } from "./technician-sheet";

export interface TechnicianActionsProps {
  technician: AdminTechnicianDto;
}

/**
 * What the admin can do to one technician (FR-060, D-43): edit, and deactivate or reactivate. It
 * shows only the actions the server lists in `availableActions`. Deactivating asks first and says
 * what it does: the jobs they already have stay assigned, and they stop being offered for new ones;
 * the confirmation then reports how many jobs stayed, from the server's answer. Reactivating needs
 * no confirmation; it shows it is working, and says if it could not. Nothing is announced as done
 * until the server has said so.
 */
export function TechnicianActions({ technician }: TechnicianActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const can = (action: TechnicianAction) => technician.availableActions.includes(action);

  const deactivate = async () => {
    let result: AdminTechnicianDto;
    try {
      result = await apiFetch<AdminTechnicianDto>(
        `/admin/technicians/${technician.id}/deactivate`,
        { method: "POST" },
      );
    } catch (caught) {
      // Shown inside the dialog, which stays open; a technician that is gone reloads the page.
      if (isApiError(caught) && caught.status === 404) router.refresh();
      throw new Error(describeApiError(caught));
    }
    toast.success(`“${result.name}” is now inactive`, {
      description: deactivatedMessage(result.name, result.upcomingJobCount),
    });
    router.refresh();
  };

  const reactivate = async () => {
    setReactivating(true);
    try {
      const result = await apiFetch<AdminTechnicianDto>(
        `/admin/technicians/${technician.id}/activate`,
        { method: "POST" },
      );
      toast.success(`“${result.name}” is active again`, {
        description: "They can be given new jobs.",
      });
      router.refresh();
    } catch (caught) {
      toast.error("We couldn't reactivate this technician", {
        description: describeApiError(caught),
      });
      if (isApiError(caught) && caught.status === 404) router.refresh();
    } finally {
      setReactivating(false);
    }
  };

  return (
    <>
      {can(TechnicianAction.EDIT) ? (
        <TechnicianSheet
          mode="edit"
          technician={technician}
          trigger={
            <Button variant="outline">
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          }
        />
      ) : null}

      {can(TechnicianAction.DEACTIVATE) ? (
        <Button
          variant="outline"
          onClick={() => {
            setConfirming(true);
          }}
        >
          <UserX aria-hidden="true" />
          Deactivate
        </Button>
      ) : null}

      {can(TechnicianAction.ACTIVATE) ? (
        <Button
          variant="outline"
          loading={reactivating}
          loadingText="Reactivating…"
          onClick={() => {
            void reactivate();
          }}
        >
          <UserCheck aria-hidden="true" />
          Reactivate
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Deactivate ${technician.name}?`}
        consequence={deactivateConsequence(technician.name, technician.upcomingJobCount)}
        confirmLabel="Deactivate"
        onConfirm={deactivate}
      />
    </>
  );
}
