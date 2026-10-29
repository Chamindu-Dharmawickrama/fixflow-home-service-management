import { Save, Undo2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FormSaveBarProps {
  /** The form differs from what is saved. */
  dirty: boolean;
  /** A save is in flight: both buttons are blocked so nothing is sent twice. */
  saving: boolean;
  /** Puts the saved values back. Required: a form with unsaved changes must offer a way out. */
  onDiscard: () => void;
  saveLabel?: string | undefined;
  /** What a screen reader hears while saving: "Saving settings…". */
  savingText?: string | undefined;
  /** Extra words beside the status, for example why saving is not possible. */
  note?: ReactNode;
  className?: string | undefined;
}

/**
 * The bar at the foot of a long settings form. It stays in view while the form scrolls (the save
 * button never hides below the fold), says whether there is anything to save, and offers Discard.
 * Save is unavailable until something changed, so a click always has an effect. Place it as the last
 * child of the `<form>`, so Enter in a text box and the button submit the same form.
 */
export function FormSaveBar({
  dirty,
  saving,
  onDiscard,
  saveLabel = "Save changes",
  savingText = "Saving…",
  note,
  className,
}: FormSaveBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 shadow-lg",
        "sm:flex-row sm:items-center sm:justify-between sm:px-4",
        className,
      )}
    >
      <p
        role="status"
        className={cn("text-sm", dirty ? "font-medium text-attention" : "text-ink-secondary")}
      >
        {saving ? "Saving…" : dirty ? "You have unsaved changes." : "All changes are saved."}
        {note ? <span className="ml-2 font-normal text-ink-secondary">{note}</span> : null}
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Button variant="outline" disabled={!dirty || saving} onClick={onDiscard}>
          <Undo2 aria-hidden="true" />
          Discard changes
        </Button>
        <Button type="submit" disabled={!dirty} loading={saving} loadingText={savingText}>
          {saving ? null : <Save aria-hidden="true" />}
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
