"use client";

import type { AdminTechnicianDto, TechnicianColor } from "@fixflow/shared";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/sonner";
import { changedBodyFields } from "@/features/catalogue/lib/changed-fields";
import { apiFetch, isApiError } from "@/lib/api";

import {
  emptyTechnicianValues,
  type TechnicianBody,
  technicianToFormValues,
  toTechnicianBody,
} from "../lib/technician-form";
import { adminTechnicianPath } from "../lib/technicians";
import { TechnicianForm } from "./technician-form";

export type TechnicianSheetProps = {
  /** The button that opens the sheet; focus returns to it when the sheet closes. */
  trigger: ReactNode;
} & (
  | {
      mode: "create";
      /** The colour the fewest technicians have, offered first. */
      suggestedColor: TechnicianColor;
    }
  | {
      mode: "edit";
      technician: AdminTechnicianDto;
    }
);

/**
 * "Add technician" and "Edit" (FR-060): a side sheet with the technician form. Creating goes on to
 * the new technician's page, so the admin sees what was made; editing sends only the fields that
 * changed, so two admins editing different details cannot undo each other. A technician that has
 * been removed meanwhile (`404`) reloads the page. Nothing is announced as saved until the server
 * has said so, and a failure keeps the sheet open with what was typed.
 */
export function TechnicianSheet(props: TechnicianSheetProps) {
  const { trigger } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const technician = props.mode === "edit" ? props.technician : undefined;

  const save = async (body: TechnicianBody) => {
    if (technician === undefined) {
      const created = await apiFetch<AdminTechnicianDto>("/admin/technicians", {
        method: "POST",
        body,
      });
      setOpen(false);
      toast.success(`“${created.name}” was added`, {
        description: "They can now be given jobs.",
      });
      router.push(adminTechnicianPath(created.id));
      return;
    }

    const changes = changedBodyFields(toTechnicianBody(technicianToFormValues(technician)), body);
    if (Object.keys(changes).length === 0) {
      // Only spacing differed: there is nothing to save, and the API refuses an empty change.
      setOpen(false);
      return;
    }
    try {
      const saved = await apiFetch<AdminTechnicianDto>(`/admin/technicians/${technician.id}`, {
        method: "PATCH",
        body: changes,
      });
      setOpen(false);
      toast.success("Changes saved", { description: `“${saved.name}” was updated.` });
      router.refresh();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 404) {
        router.refresh();
      }
      throw caught;
    }
  };

  const title = technician === undefined ? "Add technician" : `Edit ${technician.name}`;
  const initialValues =
    props.mode === "edit"
      ? technicianToFormValues(props.technician)
      : emptyTechnicianValues(props.suggestedColor);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton
        className="w-full max-w-md overflow-y-auto p-5 sm:p-6"
      >
        <SheetHeader className="pr-8">
          <SheetTitle className="break-words">{title}</SheetTitle>
          <SheetDescription className="text-ink-secondary">
            {technician === undefined
              ? "Technicians are records your team schedules. They don't sign in."
              : "Change their details or calendar colour. Their jobs are not affected."}
          </SheetDescription>
        </SheetHeader>
        <TechnicianForm
          label={title}
          initialValues={initialValues}
          onSubmit={save}
          onCancel={() => {
            setOpen(false);
          }}
          submitLabel={technician === undefined ? "Add technician" : "Save changes"}
          savingText={technician === undefined ? "Adding technician…" : "Saving changes…"}
          requireChange={technician !== undefined}
        />
      </SheetContent>
    </Sheet>
  );
}
