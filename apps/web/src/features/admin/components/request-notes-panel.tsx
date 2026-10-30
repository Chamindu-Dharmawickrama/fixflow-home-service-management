"use client";

import { type AdminRequestNoteDto, LIMITS, NoteVisibility } from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert } from "@/components/forms/form-alert";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField, FormFieldGroup } from "@/components/forms/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { EMPTY_NOTE, noteFormSchema, type NoteFormValues, toNoteBody } from "../lib/note-form";

export interface RequestNotesPanelProps {
  requestId: string;
  /** Newest first, as the API returns them. */
  notes: readonly AdminRequestNoteDto[];
  timeZone: string;
}

const VISIBILITY_CHOICES = [
  {
    value: NoteVisibility.INTERNAL,
    label: "Internal",
    help: "Only your team can see it.",
  },
  {
    value: NoteVisibility.CUSTOMER_VISIBLE,
    label: "Shared with the customer",
    help: "The customer reads it on their request page.",
  },
] as const;

/** Who can read a note, in words and an icon, so it is never told by colour alone. */
function VisibilityBadge({ visibility }: { visibility: NoteVisibility }) {
  return visibility === NoteVisibility.CUSTOMER_VISIBLE ? (
    <Badge tone="brand">
      <Eye aria-hidden="true" />
      Shared with the customer
    </Badge>
  ) : (
    <Badge tone="neutral">
      <Lock aria-hidden="true" />
      Internal
    </Badge>
  );
}

/**
 * The notes on a request (FR-024). A note is for the team only or for the customer too, and the
 * person chooses on every note: it starts as internal, so sharing is never an accident. After
 * saving, the page is refreshed so the list is what the server holds. A note cannot be edited or
 * deleted, so what the customer was told stays on record.
 */
export function RequestNotesPanel({ requestId, notes, timeZone }: RequestNotesPanelProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<NoteFormValues>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: EMPTY_NOTE,
    mode: "onTouched",
    shouldFocusError: true,
  });
  const { isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiFetch(`/admin/requests/${encodeURIComponent(requestId)}/notes`, {
        method: "POST",
        body: toNoteBody(values),
      });
      toast.success(
        values.visibility === NoteVisibility.CUSTOMER_VISIBLE
          ? "Note added and shared with the customer"
          : "Internal note added",
      );
      form.reset(EMPTY_NOTE);
      form.setFocus("body");
      router.refresh();
    } catch (error) {
      if (isApiError(error) && error.fieldErrors !== undefined) {
        applyApiFieldErrors(form.setError, error.fieldErrors);
      } else {
        setFormError(describeApiError(error));
      }
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Notes</CardTitle>
        <CardDescription>
          Keep track of calls, decisions and details. Each note is either for your team or shared
          with the customer, and cannot be changed afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          noValidate
          aria-label="Add a note"
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          className="flex flex-col gap-4"
        >
          {formError !== null ? <FormAlert tone="error">{formError}</FormAlert> : null}

          <FormField control={form.control} name="body" label="Note" required>
            {(field) => (
              <Textarea
                {...field}
                maxLength={LIMITS.notes.maxLength}
                showCount
                disabled={isSubmitting}
                placeholder="What should the team remember, or the customer know?"
              />
            )}
          </FormField>

          <FormFieldGroup control={form.control} name="visibility" legend="Who can see this note">
            {(field) => (
              <RadioGroup
                id={field.id}
                value={field.value}
                onValueChange={field.onChange}
                disabled={isSubmitting}
                aria-invalid={field["aria-invalid"]}
                aria-describedby={field["aria-describedby"]}
                aria-required={field["aria-required"]}
              >
                {VISIBILITY_CHOICES.map((choice) => {
                  const itemId = `${field.id}-${choice.value}`;
                  const checked = choice.value === field.value;
                  return (
                    <div
                      key={choice.value}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 transition-colors duration-150",
                        checked
                          ? "border-brand bg-brand-soft"
                          : "border-border hover:border-ink-muted",
                      )}
                    >
                      <RadioGroupItem value={choice.value} id={itemId} className="mt-0.5" />
                      <Label
                        htmlFor={itemId}
                        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 font-normal"
                      >
                        <span className="text-sm font-semibold text-ink">{choice.label}</span>
                        <span className="text-sm text-ink-secondary">{choice.help}</span>
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            )}
          </FormFieldGroup>

          <div>
            <Button type="submit" loading={isSubmitting} loadingText="Adding note…">
              Add note
            </Button>
          </div>
        </form>

        {notes.length === 0 ? (
          <p className="border-t border-border pt-4 text-sm text-ink-secondary">
            No notes yet. The first one you add appears here.
          </p>
        ) : (
          <ul
            aria-label="Notes on this request"
            className="flex flex-col gap-3 border-t border-border pt-4"
          >
            {notes.map((note) => (
              <li
                key={note.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border-l-4 bg-surface-muted p-3",
                  note.visibility === NoteVisibility.CUSTOMER_VISIBLE
                    ? "border-brand"
                    : "border-neutral-edge",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <VisibilityBadge visibility={note.visibility} />
                  <span className="text-xs text-ink-secondary">
                    {note.author.name} · <DateTimeText value={note.createdAt} timeZone={timeZone} />
                  </span>
                </div>
                <p className="whitespace-pre-line break-words text-sm text-ink">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
