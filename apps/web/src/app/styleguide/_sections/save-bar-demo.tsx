"use client";

import { FormSaveBar } from "@/components/forms/form-save-bar";

/**
 * The three states of the save bar, side by side. The real bar is sticky at the foot of the viewport
 * while a long form scrolls; here it is placed in the flow (`static`) so all three can be seen at once.
 */
export function SaveBarDemo() {
  return (
    <div className="flex flex-col gap-4">
      <FormSaveBar dirty={false} saving={false} onDiscard={() => undefined} className="static" />
      <FormSaveBar dirty saving={false} onDiscard={() => undefined} className="static" />
      <FormSaveBar
        dirty
        saving
        onDiscard={() => undefined}
        savingText="Saving settings…"
        className="static"
      />
    </div>
  );
}
