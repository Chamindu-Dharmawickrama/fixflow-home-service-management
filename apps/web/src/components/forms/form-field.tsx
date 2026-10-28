"use client";

import type { ReactNode } from "react";
import {
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  useController,
} from "react-hook-form";

import { Field, type FieldControlProps, FieldGroup } from "@/components/forms/field";
import { getFieldId } from "@/components/forms/field-id";

/**
 * Everything a control needs, ready to spread: React Hook Form's field (`name`, `value`,
 * `onChange`, `onBlur`, `ref`) plus the ARIA wiring and DOM id from `Field`.
 */
export type FormControlProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = ControllerRenderProps<TFieldValues, TName> & FieldControlProps;

interface FormFieldBaseProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  control: Control<TFieldValues>;
  name: TName;
  description?: ReactNode;
  required?: boolean | undefined;
  /** Prefix for the DOM id; needed only when two forms on one page share field names. */
  idPrefix?: string | undefined;
  className?: string | undefined;
  children: (props: FormControlProps<TFieldValues, TName>) => ReactNode;
}

export interface FormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> extends FormFieldBaseProps<TFieldValues, TName> {
  label: ReactNode;
  layout?: "stacked" | "inline" | undefined;
}

/**
 * A `Field` connected to React Hook Form. It reads the field's value and error from the form, so
 * the validation message appears beside the control and survives a failed submit.
 *
 * ```tsx
 * <FormField control={form.control} name="email" label="Email address" required>
 *   {(field) => <Input type="email" autoComplete="email" {...field} />}
 * </FormField>
 * ```
 *
 * `onChange` accepts either a DOM change event or a plain value, so it works for `Input` and for
 * Radix controls (`onCheckedChange={field.onChange}`). `ref` lets `form.setFocus(name)` and the
 * error summary move focus to the control. Provide `defaultValues` to `useForm` for every field.
 */
export function FormField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  control,
  name,
  label,
  description,
  required,
  idPrefix,
  layout,
  className,
  children,
}: FormFieldProps<TFieldValues, TName>) {
  const { field, fieldState } = useController({ control, name });

  return (
    <Field
      id={getFieldId(name, idPrefix)}
      label={label}
      description={description}
      error={fieldState.error?.message}
      required={required}
      layout={layout}
      className={className}
    >
      {(aria) => children({ ...field, ...aria })}
    </Field>
  );
}

export interface FormFieldGroupProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> extends FormFieldBaseProps<TFieldValues, TName> {
  legend: ReactNode;
}

/** A `FieldGroup` (fieldset and legend) connected to React Hook Form, for radio groups. */
export function FormFieldGroup<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  control,
  name,
  legend,
  description,
  required,
  idPrefix,
  className,
  children,
}: FormFieldGroupProps<TFieldValues, TName>) {
  const { field, fieldState } = useController({ control, name });

  return (
    <FieldGroup
      id={getFieldId(name, idPrefix)}
      legend={legend}
      description={description}
      error={fieldState.error?.message}
      required={required}
      className={className}
    >
      {(aria) => children({ ...field, ...aria })}
    </FieldGroup>
  );
}
