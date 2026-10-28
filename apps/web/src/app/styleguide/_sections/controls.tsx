import { ArrowRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { Field, FieldGroup } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput, TimeInput } from "@/components/ui/date-input";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { Section, Specimen } from "../_lib/section";

const VARIANTS = ["primary", "secondary", "outline", "ghost", "destructive", "link"] as const;
const LABELS: Record<(typeof VARIANTS)[number], string> = {
  primary: "Send quotation",
  secondary: "Save draft",
  outline: "Preview",
  ghost: "Cancel",
  destructive: "Void invoice",
  link: "View history",
};

export function ControlsSection() {
  return (
    <>
      <Section
        id="buttons"
        title="Buttons"
        description="One primary action per view. Buttons are 44 px tall on phones and 40 px from 640 px up. A loading button stays focusable, ignores clicks and tells screen readers what it is doing."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen title="Variants">
            <div className="flex flex-wrap items-center gap-3">
              {VARIANTS.map((variant) => (
                <Button key={variant} variant={variant}>
                  {LABELS[variant]}
                </Button>
              ))}
            </div>
          </Specimen>
          <Specimen title="Sizes: sm 36, md 44→40, lg 48 px">
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </div>
          </Specimen>
          <Specimen title="With icons">
            <div className="flex flex-wrap items-center gap-3">
              <Button>
                <Plus aria-hidden="true" />
                New request
              </Button>
              <Button variant="outline">
                Review quotation
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </Specimen>
          <Specimen title="Icon buttons (the label is required and shows as a tooltip)">
            <div className="flex flex-wrap items-center gap-2">
              <IconButton label="Edit request" icon={Pencil} />
              <IconButton label="Delete note" icon={Trash2} variant="outline" />
              <IconButton label="More actions" icon={MoreHorizontal} variant="secondary" />
            </div>
          </Specimen>
          <Specimen title="Disabled">
            <div className="flex flex-wrap items-center gap-3">
              {VARIANTS.map((variant) => (
                <Button key={variant} variant={variant} disabled>
                  {LABELS[variant]}
                </Button>
              ))}
            </div>
          </Specimen>
          <Specimen title="Loading (static examples; announces its action)">
            <div className="flex flex-wrap items-center gap-3">
              <Button loading loadingText="Sending quotation…">
                Send quotation
              </Button>
              <Button variant="destructive" loading loadingText="Voiding invoice…">
                Void invoice
              </Button>
              <Button variant="outline" loading loadingText="Saving…">
                Save draft
              </Button>
            </div>
          </Specimen>
        </div>
      </Section>

      <Section
        id="form-controls"
        title="Form controls"
        description="Every control sits in a Field: the label is tied to the control, help and error text are announced with it, an error marks the control invalid, and required fields are marked with an asterisk and aria-required."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen title="Text input: default, required, error, disabled, read-only">
            <div className="flex flex-col gap-5">
              <Field
                id="sg-in-default"
                label="Email address"
                description="We'll send quotation updates here."
              >
                {(control) => (
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    {...control}
                  />
                )}
              </Field>
              <Field id="sg-in-required" label="Full name" required>
                {(control) => (
                  <Input autoComplete="name" defaultValue="Morgan Reyes" {...control} />
                )}
              </Field>
              <Field
                id="sg-in-error"
                label="Phone number"
                required
                error="Enter a phone number with at least 10 digits."
              >
                {(control) => (
                  <Input type="tel" autoComplete="tel" defaultValue="212 555" {...control} />
                )}
              </Field>
              <Field id="sg-in-disabled" label="Customer reference">
                {(control) => <Input defaultValue="FF-2026-00125" disabled {...control} />}
              </Field>
              <Field
                id="sg-in-readonly"
                label="Email on file"
                description="Contact the business to change it."
              >
                {(control) => (
                  <Input defaultValue="morgan.reyes@demo.fixflow.test" readOnly {...control} />
                )}
              </Field>
            </div>
          </Specimen>

          <Specimen title="Textarea with counter, select, date and time">
            <div className="flex flex-col gap-5">
              <Field
                id="sg-textarea"
                label="Describe the problem"
                required
                description="Include what you noticed and when it started."
              >
                {(control) => (
                  <Textarea
                    maxLength={500}
                    showCount
                    defaultValue="The upstairs unit is blowing warm air and the drain line drips onto the landing."
                    {...control}
                  />
                )}
              </Field>
              <Field id="sg-select" label="Service" required>
                {(control) => (
                  <Select placeholder="Choose a service" defaultValue="" required {...control}>
                    <option value="ac-diagnostic-visit">AC Diagnostic Visit</option>
                    <option value="ac-routine-maintenance">AC Routine Maintenance</option>
                    <option value="washing-machine-repair">Washing Machine Repair</option>
                  </Select>
                )}
              </Field>
              <Field id="sg-select-error" label="Preferred window" error="Choose a time window.">
                {(control) => (
                  <Select placeholder="Select a window" {...control}>
                    <option value="MORNING">Morning</option>
                    <option value="AFTERNOON">Afternoon</option>
                  </Select>
                )}
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="sg-date" label="Preferred date" description="Day, month and year.">
                  {(control) => (
                    <DateInput defaultValue="2026-11-03" min="2026-10-28" {...control} />
                  )}
                </Field>
                <Field id="sg-time" label="Arrival from">
                  {(control) => <TimeInput defaultValue="09:00" {...control} />}
                </Field>
              </div>
            </div>
          </Specimen>

          <Specimen title="Checkbox and switch (control before label)">
            <div className="flex flex-col gap-5">
              <Field
                id="sg-check"
                layout="inline"
                label="I have read the privacy notice"
                required
                description="We use your details only to respond to your request."
              >
                {(control) => <Checkbox {...control} />}
              </Field>
              <Field id="sg-check-on" layout="inline" label="Email me when the quotation is ready">
                {(control) => <Checkbox defaultChecked {...control} />}
              </Field>
              <Field
                id="sg-check-error"
                layout="inline"
                label="Accept the terms"
                error="You need to accept the terms to continue."
              >
                {(control) => <Checkbox {...control} />}
              </Field>
              <Field id="sg-check-disabled" layout="inline" label="Customer email is verified">
                {(control) => <Checkbox disabled checked {...control} />}
              </Field>
              <Field
                id="sg-switch"
                layout="inline"
                label="Publish on the website"
                description="Visitors can see and request this service."
              >
                {(control) => <Switch defaultChecked {...control} />}
              </Field>
              <Field id="sg-switch-off" layout="inline" label="Send weekly summary">
                {(control) => <Switch {...control} />}
              </Field>
            </div>
          </Specimen>

          <Specimen title="Radio group (fieldset and legend)">
            <div className="flex flex-col gap-5">
              <FieldGroup
                id="sg-radio"
                legend="Preferred time"
                required
                description="We'll confirm the exact slot by email."
              >
                {(control) => (
                  <RadioGroup defaultValue="MORNING" {...control}>
                    {(
                      [
                        ["MORNING", "Morning (8 AM – 12 PM)"],
                        ["AFTERNOON", "Afternoon (12 – 5 PM)"],
                        ["EVENING", "Evening (5 – 8 PM)"],
                      ] as const
                    ).map(([value, label]) => (
                      <div key={value} className="flex items-center gap-3">
                        <RadioGroupItem value={value} id={`sg-radio-${value}`} />
                        <Label htmlFor={`sg-radio-${value}`}>{label}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              </FieldGroup>
              <FieldGroup
                id="sg-radio-error"
                legend="How should we contact you?"
                error="Choose one option."
              >
                {(control) => (
                  <RadioGroup {...control}>
                    {(
                      [
                        ["EMAIL", "Email"],
                        ["PHONE", "Phone call"],
                      ] as const
                    ).map(([value, label]) => (
                      <div key={value} className="flex items-center gap-3">
                        <RadioGroupItem value={value} id={`sg-contact-${value}`} />
                        <Label htmlFor={`sg-contact-${value}`}>{label}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              </FieldGroup>
            </div>
          </Specimen>
        </div>
      </Section>
    </>
  );
}
