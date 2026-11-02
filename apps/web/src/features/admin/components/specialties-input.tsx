"use client";

import { LIMITS } from "@fixflow/shared";
import { Plus, X } from "lucide-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { addSpecialties } from "../lib/technician-form";

const { maxItems } = LIMITS.technician.specialties;

export interface SpecialtiesInputProps {
  /** The tags added so far. */
  tags: readonly string[];
  onTagsChange: (tags: string[]) => void;
  /** What has been typed and not yet added; kept by the form so saving takes it along. */
  draft: string;
  onDraftChange: (draft: string) => void;
  disabled?: boolean | undefined;
  /** The text box's DOM id, as `FormFieldGroup` passes it (the error summary moves focus to it). */
  id?: string | undefined;
  "aria-invalid"?: true | undefined;
  "aria-describedby"?: string | undefined;
}

/**
 * A technician's specialties as tags (FR-060): type one and press Enter, comma or "Add"; remove one
 * with the × beside it. At most 8 tags of 40 characters (`LIMITS.technician.specialties`); a repeat
 * is not added twice. Pasting a comma-separated list adds each. A tag that cannot be added says why
 * and stays in the box. Wrap it in a `FormFieldGroup` for the legend and the form's own error.
 */
export function SpecialtiesInput({
  tags,
  onTagsChange,
  draft,
  onDraftChange,
  disabled = false,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: SpecialtiesInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const atLimit = tags.length >= maxItems;

  const add = () => {
    if (draft.trim() === "") return;
    const result = addSpecialties(tags, draft);
    onTagsChange(result.tags);
    onDraftChange(result.rest);
    setProblem(result.problem);
    input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter with nothing typed submits the form, as it would anywhere else.
    if ((event.key === "Enter" || event.key === ",") && draft.trim() !== "") {
      event.preventDefault();
      add();
    }
  };

  const remove = (index: number) => {
    onTagsChange(tags.filter((_, position) => position !== index));
    setProblem(null);
    input.current?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      {tags.length === 0 ? (
        <p className="text-sm text-ink-secondary">No specialties added yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag, index) => (
            <li
              key={tag}
              className="flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-muted py-0.5 pl-3 pr-1 text-sm text-ink"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">{tag}</span>
              <IconButton
                label={`Remove ${tag}`}
                icon={X}
                size="sm"
                variant="ghost"
                tooltip={false}
                disabled={disabled}
                className="size-7 shrink-0"
                onClick={() => {
                  remove(index);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={inputId} className="sr-only">
            Add a specialty
          </Label>
          <Input
            ref={input}
            id={inputId}
            value={draft}
            onChange={(event) => {
              onDraftChange(event.target.value);
              setProblem(null);
            }}
            onKeyDown={onKeyDown}
            placeholder={atLimit ? "You have added the most you can" : "For example: Heat pumps"}
            autoComplete="off"
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            disabled={disabled || atLimit}
          />
        </div>
        <Button
          variant="outline"
          disabled={disabled || atLimit || draft.trim() === ""}
          onClick={add}
          className="shrink-0"
        >
          <Plus aria-hidden="true" />
          Add
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {problem !== null ? (
          <p role="alert" className="font-medium text-danger">
            {problem}
          </p>
        ) : (
          <span />
        )}
        <span className="text-ink-secondary">
          {tags.length} of {maxItems}
        </span>
      </div>
    </div>
  );
}
