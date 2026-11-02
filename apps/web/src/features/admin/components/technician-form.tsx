"use client";

import { LIMITS } from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormAlert } from "@/components/forms/form-alert";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField, FormFieldGroup } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describeApiError, isApiError } from "@/lib/api";

import {
  addSpecialties,
  formFieldForApiError,
  TECHNICIAN_FIELD_LABELS,
  type TechnicianBody,
  technicianFormSchema,
  type TechnicianFormValues,
  toTechnicianBody,
} from "../lib/technician-form";
import { ColorPicker } from "./color-picker";
import { SpecialtiesInput } from "./specialties-input";

export interface TechnicianFormProps {
  /** The form's accessible name: "Add technician", "Edit Jordan Lee". */
  label: string;
  initialValues: TechnicianFormValues;
  /**
   * Saves the technician. Throw the {@link ApiError} the request raised: a validation failure
   * (`fieldErrors`) appears beside the fields and anything else above the form, and what was typed
   * stays in the form either way. The form does not close itself; the caller does that once saved.
   */
  onSubmit: (body: TechnicianBody) => Promise<void>;
  onCancel?: (() => void) | undefined;
  submitLabel: string;
  /** What a screen reader hears while saving: "Saving technician…". */
  savingText?: string | undefined;
  /** Editing: Save stays unavailable until something has changed, so a click always has an effect. */
  requireChange?: boolean | undefined;
}

const T = LIMITS.technician;

/**
 * A technician (FR-060): name, how to reach them, what they are good at, the colour of their jobs on
 * the calendar and private notes. It validates for early feedback, shows the API's messages beside
 * the fields, keeps what was typed after any failure and blocks a second submit while one is
 * pending. A specialty typed but not yet added is added on Save, so it is not lost. Notes are
 * internal: customers never see them.
 */
export function TechnicianForm({
  label,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  savingText = "Saving technician…",
  requireChange = false,
}: TechnicianFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<TechnicianFormValues>({
    resolver: zodResolver(technicianFormSchema),
    defaultValues: initialValues,
    mode: "onTouched",
    shouldFocusError: false,
  });
  const { errors, isDirty, isSubmitting, submitCount } = form.formState;
  const specialtyDraft = useWatch({ control: form.control, name: "specialtyDraft" });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);

    // A specialty that was typed but not added is part of what the person means to save.
    const merged = addSpecialties(values.specialties, values.specialtyDraft);
    if (merged.problem !== null) {
      form.setError("specialties", { type: "validate", message: merged.problem });
      return;
    }

    try {
      await onSubmit(toTechnicianBody({ ...values, specialties: merged.tags }));
    } catch (error) {
      if (isApiError(error) && error.fieldErrors !== undefined) {
        applyApiFieldErrors(
          form.setError,
          Object.fromEntries(
            Object.entries(error.fieldErrors).map(([field, message]) => [
              formFieldForApiError(field),
              message,
            ]),
          ),
        );
      } else {
        setFormError(describeApiError(error));
      }
    }
  });

  return (
    <form
      noValidate
      aria-label={label}
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <FormErrorSummary
        errors={errors}
        labels={TECHNICIAN_FIELD_LABELS}
        submitCount={submitCount}
        idPrefix="technician-"
      />
      {formError !== null ? <FormAlert tone="error">{formError}</FormAlert> : null}

      <FormField
        control={form.control}
        name="name"
        label="Name"
        required
        idPrefix="technician-"
        description="How the technician appears on jobs and the calendar."
      >
        {(field) => (
          <Input
            {...field}
            autoComplete="off"
            maxLength={LIMITS.personName.maxLength}
            disabled={isSubmitting}
          />
        )}
      </FormField>

      <FormField
        control={form.control}
        name="phone"
        label="Phone number"
        idPrefix="technician-"
        description="Optional."
      >
        {(field) => <Input {...field} type="tel" autoComplete="off" disabled={isSubmitting} />}
      </FormField>

      <FormField
        control={form.control}
        name="email"
        label="Email address"
        idPrefix="technician-"
        description="Optional. They cannot sign in; this is only so your team can reach them."
      >
        {(field) => (
          <Input
            {...field}
            type="email"
            autoComplete="off"
            maxLength={LIMITS.email.maxLength}
            disabled={isSubmitting}
          />
        )}
      </FormField>

      <FormFieldGroup
        control={form.control}
        name="specialties"
        legend="Specialties"
        idPrefix="technician-"
        description="What they work on, like “Heat pumps”. Optional; up to 8."
      >
        {(field) => (
          <SpecialtiesInput
            id={field.id}
            tags={field.value}
            onTagsChange={(tags) => {
              field.onChange(tags);
            }}
            draft={specialtyDraft}
            onDraftChange={(draft) => {
              form.setValue("specialtyDraft", draft, { shouldDirty: true });
            }}
            disabled={isSubmitting}
            aria-invalid={field["aria-invalid"]}
            aria-describedby={field["aria-describedby"]}
          />
        )}
      </FormFieldGroup>

      <FormFieldGroup
        control={form.control}
        name="calendarColor"
        legend="Calendar colour"
        required
        idPrefix="technician-"
        description="Their jobs show in this colour on the calendar."
      >
        {(field) => (
          <ColorPicker
            id={field.id}
            value={field.value}
            onChange={field.onChange}
            disabled={isSubmitting}
            aria-invalid={field["aria-invalid"]}
            aria-describedby={field["aria-describedby"]}
            aria-required={field["aria-required"]}
          />
        )}
      </FormFieldGroup>

      <FormField
        control={form.control}
        name="notes"
        label="Notes"
        idPrefix="technician-"
        description="Only you and your team can see this. Customers never do."
      >
        {(field) => (
          <Textarea {...field} maxLength={T.notes.maxLength} showCount disabled={isSubmitting} />
        )}
      </FormField>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel !== undefined ? (
          <Button variant="outline" disabled={isSubmitting} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          type="submit"
          disabled={requireChange && !isDirty}
          loading={isSubmitting}
          loadingText={savingText}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
