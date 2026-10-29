"use client";

import { LIMITS } from "@fixflow/shared";
import { Plus, X } from "lucide-react";
import { useRef } from "react";
import { type Control, useFieldArray, useFormState } from "react-hook-form";

import { FieldGroup } from "@/components/forms/field";
import { getFieldId } from "@/components/forms/field-id";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";

import type { ServiceFormValues } from "../lib/service-form";

const { maxItems } = LIMITS.service.inclusions;

/**
 * "What's included": a short list of points, one box each (FR-101). Rows can be added up to the
 * limit and removed one by one; blank rows are ignored when the service is saved. Each box has a
 * hidden label ("Inclusion 3"), so a screen reader can tell them apart, and its own error.
 */
export function InclusionsEditor({
  control,
  disabled,
}: {
  control: Control<ServiceFormValues>;
  disabled?: boolean | undefined;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "inclusions" });
  const { errors } = useFormState({ control, name: "inclusions" });
  const addButton = useRef<HTMLButtonElement>(null);
  const listError = errors.inclusions?.root?.message ?? errors.inclusions?.message;

  return (
    <FieldGroup
      id={getFieldId("inclusions")}
      legend="What's included"
      description={`Up to ${maxItems} short points, such as "Filter cleaning". Customers see them on the service page.`}
      error={listError}
    >
      {() => (
        <div className="flex flex-col gap-3">
          {fields.length === 0 ? (
            <p className="text-sm text-ink-secondary">No inclusions yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {fields.map((row, index) => (
                <li key={row.id} className="flex items-start gap-2">
                  <FormField
                    control={control}
                    name={`inclusions.${index}.text`}
                    label={<span className="sr-only">Inclusion {index + 1}</span>}
                    className="min-w-0 flex-1"
                  >
                    {(field) => (
                      <Input
                        {...field}
                        disabled={disabled}
                        placeholder="For example: Filter and coil cleaning"
                      />
                    )}
                  </FormField>
                  <IconButton
                    label={`Remove inclusion ${index + 1}`}
                    icon={X}
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      remove(index);
                      // The removed row's button is gone; keep keyboard focus somewhere stable.
                      addButton.current?.focus();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              ref={addButton}
              variant="outline"
              size="sm"
              disabled={disabled || fields.length >= maxItems}
              onClick={() => {
                append({ text: "" }, { shouldFocus: true });
              }}
            >
              <Plus aria-hidden="true" />
              Add inclusion
            </Button>
            <span className="text-sm text-ink-secondary">
              {fields.length} of {maxItems}
            </span>
          </div>
        </div>
      )}
    </FieldGroup>
  );
}
