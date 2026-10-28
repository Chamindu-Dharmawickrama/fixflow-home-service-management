import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** What a control needs to be correctly labelled, described and flagged by assistive technology. */
export interface FieldControlProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
  "aria-required": true | undefined;
}

interface FieldBaseProps {
  /** The id of the control (or, for a group, of the fieldset). The error summary links to it. */
  id: string;
  description?: ReactNode;
  /** The message to show. Its presence marks the control `aria-invalid`. */
  error?: string | undefined;
  required?: boolean | undefined;
  className?: string | undefined;
}

function describedBy(id: string, hasDescription: boolean, hasError: boolean): string | undefined {
  const ids = [hasDescription ? `${id}-description` : null, hasError ? `${id}-error` : null].filter(
    Boolean,
  );
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function controlProps(
  id: string,
  { description, error, required }: Pick<FieldBaseProps, "description" | "error" | "required">,
): FieldControlProps {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy(id, Boolean(description), Boolean(error)),
    "aria-required": required ? true : undefined,
  };
}

function RequiredMarker() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-danger">
      *
    </span>
  );
}

function Description({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={`${id}-description`} className="text-sm text-ink-secondary">
      {children}
    </p>
  );
}

/**
 * The error slot is always in the DOM, so a message added later is announced politely. It is only
 * referenced by `aria-describedby` while it has content.
 */
function ErrorSlot({ id, error }: { id: string; error: string | undefined }) {
  return (
    <div id={`${id}-error`} aria-live="polite">
      {error ? (
        <p className="flex items-start gap-1.5 text-sm font-medium text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface FieldProps extends FieldBaseProps {
  label: ReactNode;
  /** `inline` puts the control before its label, for checkboxes and switches. */
  layout?: "stacked" | "inline" | undefined;
  /** Render the control and spread the supplied props onto it. */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * A label, optional help text, one control and an inline error, wired together:
 * `<label for>` → control `id`; help and error → `aria-describedby`; error → `aria-invalid`.
 *
 * ```tsx
 * <Field id="email" label="Email address" required error={error}>
 *   {(control) => <Input type="email" autoComplete="email" {...control} />}
 * </Field>
 * ```
 */
export function Field({
  id,
  label,
  description,
  error,
  required,
  layout = "stacked",
  className,
  children,
}: FieldProps) {
  const control = controlProps(id, { description, error, required });

  if (layout === "inline") {
    return (
      <div className={cn("flex items-start gap-3", className)}>
        <div className="flex h-6 shrink-0 items-center">{children(control)}</div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={id} className="leading-6">
            {label}
            {required ? <RequiredMarker /> : null}
          </Label>
          {description ? <Description id={id}>{description}</Description> : null}
          <ErrorSlot id={id} error={error} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <RequiredMarker /> : null}
      </Label>
      {description ? <Description id={id}>{description}</Description> : null}
      {children(control)}
      <ErrorSlot id={id} error={error} />
    </div>
  );
}

export interface FieldGroupProps extends FieldBaseProps {
  legend: ReactNode;
  /** Render the group's controls; spread the props onto the group element (for example `RadioGroup`). */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Several related controls under one question, such as a radio group. A `fieldset` and `legend`
 * give the group its name, which a single `label` cannot.
 */
export function FieldGroup({
  id,
  legend,
  description,
  error,
  required,
  className,
  children,
}: FieldGroupProps) {
  const control = controlProps(id, { description, error, required });

  return (
    <fieldset
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      aria-describedby={control["aria-describedby"]}
    >
      <legend className="mb-1.5 text-sm font-medium text-ink">
        {legend}
        {required ? <RequiredMarker /> : null}
      </legend>
      {description ? <Description id={id}>{description}</Description> : null}
      {children(control)}
      <ErrorSlot id={id} error={error} />
    </fieldset>
  );
}
