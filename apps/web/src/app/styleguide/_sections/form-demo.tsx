"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField, FormFieldGroup } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name."),
  email: z.string().trim().pipe(z.email("Enter a valid email address, like name@example.com.")),
  service: z.string().min(1, "Choose a service."),
  preferredWindow: z.string().min(1, "Choose a time window."),
  description: z
    .string()
    .trim()
    .min(20, "Describe the problem in at least 20 characters so we can prepare."),
  acceptedPrivacy: z.boolean().refine((value) => value, "You need to accept the privacy notice."),
});

type Values = z.infer<typeof schema>;

const DEFAULTS: Values = {
  fullName: "",
  email: "",
  service: "",
  preferredWindow: "",
  description: "",
  acceptedPrivacy: false,
};

const LABELS: Record<string, string> = {
  fullName: "Full name",
  email: "Email address",
  service: "Service",
  preferredWindow: "Preferred time",
  description: "Describe the problem",
  acceptedPrivacy: "Privacy notice",
};

const WINDOWS = [
  ["MORNING", "Morning (8 AM – 12 PM)"],
  ["AFTERNOON", "Afternoon (12 – 5 PM)"],
  ["EVENING", "Evening (5 – 8 PM)"],
] as const;

/**
 * A complete validation example: React Hook Form with a Zod schema, inline errors beside the
 * fields, an error summary that takes focus when a submit fails, a loading submit button, values
 * kept after errors, and a button that applies API-style `fieldErrors` the way a real submit will.
 */
export function FormDemo() {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULTS,
    mode: "onTouched",
    shouldFocusError: false,
  });
  const [passed, setPassed] = useState(false);
  const { errors, isSubmitting, submitCount } = form.formState;

  const onSubmit = async () => {
    // Stands in for the request a real form would make; nothing is sent anywhere.
    await new Promise((resolve) => setTimeout(resolve, 900));
    setPassed(true);
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        setPassed(false);
        void form.handleSubmit(onSubmit)(event);
      }}
      className="flex flex-col gap-5"
      aria-label="Request a service (validation example)"
    >
      <FormErrorSummary errors={errors} labels={LABELS} submitCount={submitCount} />

      {passed ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-success-soft p-3 text-sm font-medium text-success"
        >
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Validation passed. This example form does not send anything.
        </p>
      ) : null}

      <FormField control={form.control} name="fullName" label="Full name" required>
        {(field) => <Input autoComplete="name" {...field} />}
      </FormField>

      <FormField
        control={form.control}
        name="email"
        label="Email address"
        required
        description="We'll send the quotation here."
      >
        {(field) => <Input type="email" autoComplete="email" {...field} />}
      </FormField>

      <FormField control={form.control} name="service" label="Service" required>
        {(field) => (
          <Select placeholder="Choose a service" {...field}>
            <option value="ac-diagnostic-visit">AC Diagnostic Visit</option>
            <option value="ac-routine-maintenance">AC Routine Maintenance</option>
            <option value="washing-machine-repair">Washing Machine Repair</option>
          </Select>
        )}
      </FormField>

      <FormFieldGroup
        control={form.control}
        name="preferredWindow"
        legend="Preferred time"
        required
      >
        {({ value, onChange, ...field }) => (
          <RadioGroup value={value} onValueChange={onChange} {...field}>
            {WINDOWS.map(([windowValue, label]) => (
              <div key={windowValue} className="flex items-center gap-3">
                <RadioGroupItem value={windowValue} id={`demo-window-${windowValue}`} />
                <Label htmlFor={`demo-window-${windowValue}`}>{label}</Label>
              </div>
            ))}
          </RadioGroup>
        )}
      </FormFieldGroup>

      <FormField control={form.control} name="description" label="Describe the problem" required>
        {(field) => <Textarea maxLength={500} showCount {...field} />}
      </FormField>

      <FormField
        control={form.control}
        name="acceptedPrivacy"
        layout="inline"
        label="I have read the privacy notice"
        required
      >
        {({ value, onChange, ...field }) => (
          <Checkbox
            checked={value}
            onCheckedChange={(checked) => onChange(checked === true)}
            {...field}
          />
        )}
      </FormField>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={isSubmitting} loadingText="Checking your request…">
          Check request
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            applyApiFieldErrors(form.setError, {
              email: "That email is already registered. Sign in instead.",
              _: "We couldn't save this just now. Please try again.",
            })
          }
        >
          Simulate server errors
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            form.reset(DEFAULTS);
            setPassed(false);
          }}
        >
          Reset
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        <span aria-hidden="true" className="text-danger">
          *
        </span>{" "}
        Required field
      </p>
    </form>
  );
}
