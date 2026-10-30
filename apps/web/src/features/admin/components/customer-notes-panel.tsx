"use client";

import { type AdminCustomerNoteDto, LIMITS } from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert } from "@/components/forms/form-alert";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import {
  customerNoteFormSchema,
  type CustomerNoteFormValues,
  EMPTY_CUSTOMER_NOTE,
  toCustomerNoteBody,
} from "../lib/note-form";

export interface CustomerNotesPanelProps {
  customerId: string;
  /** Newest first, as the API returns them. */
  notes: readonly AdminCustomerNoteDto[];
  /** How many notes exist in all; more than `notes` holds when the list is cut short. */
  noteCount: number;
  timeZone: string;
}

/**
 * The team's private notes about a customer (FR-033). The panel says in words and with an icon, in
 * a banner that does not depend on colour, that nothing here is ever shown to the customer. A note
 * is only ever added: it cannot be edited or deleted, so the record of what the team knew stays
 * whole. After saving, the page is refreshed so the list is what the server holds.
 */
export function CustomerNotesPanel({
  customerId,
  notes,
  noteCount,
  timeZone,
}: CustomerNotesPanelProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<CustomerNoteFormValues>({
    resolver: zodResolver(customerNoteFormSchema),
    defaultValues: EMPTY_CUSTOMER_NOTE,
    mode: "onTouched",
    shouldFocusError: true,
  });
  const { isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiFetch(`/admin/customers/${encodeURIComponent(customerId)}/notes`, {
        method: "POST",
        body: toCustomerNoteBody(values),
      });
      toast.success("Internal note added");
      form.reset(EMPTY_CUSTOMER_NOTE);
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
        <CardTitle as="h2">Internal notes</CardTitle>
        <CardDescription>
          What the team should remember about this customer: preferences, history, things to watch
          for. A note cannot be changed afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="flex items-center gap-2 rounded-lg border border-attention-edge bg-attention-soft px-3 py-2 text-sm font-medium text-attention">
          <Lock aria-hidden="true" className="size-4 shrink-0" />
          Internal — never shown to the customer
        </p>

        <form
          noValidate
          aria-label="Add an internal note"
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
                placeholder="For example: prefers a call after 5pm; the gate code changes monthly."
              />
            )}
          </FormField>

          <div>
            <Button type="submit" loading={isSubmitting} loadingText="Adding note…">
              Add note
            </Button>
          </div>
        </form>

        {notes.length === 0 ? (
          <p className="border-t border-border pt-4 text-sm text-ink-secondary">
            No internal notes yet. The first one you add appears here.
          </p>
        ) : (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <ul aria-label="Internal notes about this customer" className="flex flex-col gap-3">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="flex flex-col gap-2 rounded-lg border-l-4 border-neutral-edge bg-surface-muted p-3"
                >
                  <span className="text-xs text-ink-secondary">
                    {note.author.name} · <DateTimeText value={note.createdAt} timeZone={timeZone} />
                  </span>
                  <p className="whitespace-pre-line break-words text-sm text-ink">{note.body}</p>
                </li>
              ))}
            </ul>
            {noteCount > notes.length ? (
              <p className="text-sm text-ink-secondary">
                Showing the latest {notes.length} of {noteCount} notes.
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
