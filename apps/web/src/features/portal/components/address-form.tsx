"use client";

import { LIMITS } from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert } from "@/components/forms/form-alert";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describeApiError, isApiError } from "@/lib/api";

import {
  ADDRESS_FIELD_LABELS,
  type AddressBody,
  addressFormSchema,
  type AddressFormValues,
  EMPTY_ADDRESS_VALUES,
  toAddressBody,
} from "../lib/address-form";

export interface AddressFormProps {
  /** The form's accessible name: "Add address", "Edit Home". */
  label: string;
  /** Empty for a new address; the saved values when editing. */
  initialValues?: AddressFormValues | undefined;
  /**
   * Saves the address. Throw the {@link ApiError} the request raised: a validation failure
   * (`fieldErrors`) appears beside the fields and anything else above the form, and what was typed
   * stays in the form either way. The form does not close itself; the caller does that once saved.
   */
  onSubmit: (body: AddressBody) => Promise<void>;
  onCancel?: (() => void) | undefined;
  submitLabel: string;
  /** What a screen reader hears while saving: "Saving address…". */
  savingText?: string | undefined;
  /** Editing: Save stays unavailable until something has changed, so a click always has an effect. */
  requireChange?: boolean | undefined;
  /** Needed only when two address forms share a page. */
  idPrefix?: string | undefined;
}

const A = LIMITS.address;

/**
 * A service address (FR-013): the form behind "Add address" and "Edit", and the one the request form
 * (T11) reuses to add an address on the spot. It validates for early feedback, shows the API's
 * messages beside the fields, keeps what was typed after any failure, and blocks a second submit
 * while one is pending. Access notes are private to the customer and the business team.
 */
export function AddressForm({
  label,
  initialValues = EMPTY_ADDRESS_VALUES,
  onSubmit,
  onCancel,
  submitLabel,
  savingText = "Saving address…",
  requireChange = false,
  idPrefix,
}: AddressFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressFormSchema),
    defaultValues: initialValues,
    mode: "onTouched",
    shouldFocusError: false,
  });
  const { errors, isDirty, isSubmitting, submitCount } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(toAddressBody(values));
    } catch (error) {
      if (isApiError(error) && error.fieldErrors !== undefined) {
        applyApiFieldErrors(form.setError, error.fieldErrors);
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
        labels={ADDRESS_FIELD_LABELS}
        submitCount={submitCount}
        idPrefix={idPrefix}
      />
      {formError !== null ? <FormAlert tone="error">{formError}</FormAlert> : null}

      <FormField
        control={form.control}
        name="label"
        label="Label"
        required
        description="What you call this place, like Home or Rental unit."
        idPrefix={idPrefix}
      >
        {(field) => (
          <Input
            {...field}
            autoComplete="off"
            maxLength={A.label.maxLength}
            disabled={isSubmitting}
          />
        )}
      </FormField>

      <FormField
        control={form.control}
        name="line1"
        label="Street address"
        required
        idPrefix={idPrefix}
      >
        {(field) => <Input {...field} autoComplete="address-line1" disabled={isSubmitting} />}
      </FormField>

      <FormField
        control={form.control}
        name="line2"
        label="Address line 2"
        description="Apartment, unit or building. Optional."
        idPrefix={idPrefix}
      >
        {(field) => <Input {...field} autoComplete="address-line2" disabled={isSubmitting} />}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField control={form.control} name="city" label="City" required idPrefix={idPrefix}>
          {(field) => <Input {...field} autoComplete="address-level2" disabled={isSubmitting} />}
        </FormField>
        <FormField control={form.control} name="region" label="State or region" idPrefix={idPrefix}>
          {(field) => <Input {...field} autoComplete="address-level1" disabled={isSubmitting} />}
        </FormField>
      </div>

      <FormField
        control={form.control}
        name="postalCode"
        label="Postal code"
        required
        className="sm:max-w-48"
        idPrefix={idPrefix}
      >
        {(field) => <Input {...field} autoComplete="postal-code" disabled={isSubmitting} />}
      </FormField>

      <FormField
        control={form.control}
        name="accessNotes"
        label="Access notes"
        description="Gate code, parking, pets… Only you and our team can see this."
        idPrefix={idPrefix}
      >
        {(field) => (
          <Textarea
            {...field}
            maxLength={A.accessNotes.maxLength}
            showCount
            disabled={isSubmitting}
          />
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
