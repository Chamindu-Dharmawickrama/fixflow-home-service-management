"use client";

import {
  type AdminSettingsDto,
  BUNDLED_LOGOS,
  LIMITS,
  SUPPORTED_CURRENCIES,
} from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField, FormFieldGroup } from "@/components/forms/form-field";
import { FormSaveBar } from "@/components/forms/form-save-bar";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/components/form-alert";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import { LOGO_ASSETS } from "../lib/bundled-assets";
import { changedBodyFields } from "../lib/changed-fields";
import {
  groupTimeZones,
  settingsFormSchema,
  type SettingsFormValues,
  settingsToFormValues,
  toSettingsBody,
} from "../lib/settings-form";
import { AssetPicker } from "./asset-picker";
import { BusinessLogo } from "./business-logo";
import { SourceChoice } from "./source-choice";

const L = LIMITS.businessSettings;

const FIELD_LABELS: Record<string, string> = {
  businessName: "Business name",
  tagline: "Tagline",
  logoKey: "Logo",
  logoUrl: "Logo web address",
  contactEmail: "Contact email",
  phone: "Phone number",
  addressLine1: "Street address",
  addressLine2: "Address line 2",
  city: "City",
  region: "State or region",
  postalCode: "Postal code",
  serviceAreaDescription: "Service area",
  currencyCode: "Currency",
  timeZone: "Time zone",
  defaultTaxRate: "Default tax rate",
  quotationValidityDays: "Quotation validity",
  defaultQuotationTerms: "Default terms",
  invoiceDueDays: "Invoice payment term",
  paymentInstructions: "Payment instructions",
  invoiceFooter: "Invoice footer",
};

const LOGO_OPTIONS = BUNDLED_LOGOS.map(({ key, label }) => ({
  key,
  label,
  asset: LOGO_ASSETS[key],
}));

export interface BusinessSettingsFormProps {
  settings: AdminSettingsDto;
  /** Every accepted IANA zone. Computed on the server, so the page and the API read the same list. */
  timeZones: readonly string[];
}

/**
 * The business settings (FR-100): identity, contact details, region and tax, and the defaults for
 * quotations and invoices. A sectioned form with a save bar that stays in view. Saving sends only
 * the fields that changed (so two admins editing different fields cannot overwrite each other),
 * shows the API's `fieldErrors` beside the fields, keeps what was typed after any failure, and
 * confirms with a toast only once the server has said yes. Unsaved changes are guarded.
 */
export function BusinessSettingsForm({ settings, timeZones }: BusinessSettingsFormProps) {
  const router = useRouter();
  const [initialValues] = useState<SettingsFormValues>(() => settingsToFormValues(settings));
  /** The last saved version, as the API takes it: a save sends only what differs from it. */
  const [saved, setSaved] = useState(() => toSettingsBody(initialValues));
  const [formError, setFormError] = useState<string | null>(null);
  const zoneGroups = useMemo(() => groupTimeZones(timeZones), [timeZones]);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: initialValues,
    mode: "onTouched",
    shouldFocusError: false,
  });
  const { isDirty, isSubmitting, submitCount, errors } = form.formState;
  const values = useWatch({ control: form.control });
  const guard = useUnsavedChangesGuard(isDirty && !isSubmitting);

  const logoSource = values.logoSource ?? initialValues.logoSource;

  const onSubmit = form.handleSubmit(async (formValues) => {
    setFormError(null);
    const changes = changedBodyFields(saved, toSettingsBody(formValues));
    try {
      const updated = await apiFetch<AdminSettingsDto>("/admin/settings", {
        method: "PATCH",
        body: changes,
      });
      const next = settingsToFormValues(updated);
      setSaved(toSettingsBody(next));
      form.reset(next);
      toast.success("Settings saved", {
        description: "New quotations and invoices will use the updated settings.",
      });
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
    <form
      noValidate
      aria-label="Business settings"
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <FormErrorSummary errors={errors} labels={FIELD_LABELS} submitCount={submitCount} />
      {formError !== null ? <FormAlert tone="error">{formError}</FormAlert> : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Business identity</CardTitle>
          <CardDescription>
            Shown on the website, in emails and on quotations and invoices.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormField control={form.control} name="businessName" label="Business name" required>
            {(field) => <Input {...field} autoComplete="organization" disabled={isSubmitting} />}
          </FormField>
          <FormField
            control={form.control}
            name="tagline"
            label="Tagline"
            description="One short line under the name on the website. Optional."
          >
            {(field) => <Input {...field} autoComplete="off" disabled={isSubmitting} />}
          </FormField>

          <FormFieldGroup
            control={form.control}
            name="logoSource"
            legend="Logo"
            description="Choose one of the logos that come with FixFlow, or link to a logo you host yourself. Logos cannot be uploaded."
          >
            {(field) => (
              <SourceChoice
                id={field.id}
                value={field.value}
                onChange={field.onChange}
                disabled={isSubmitting}
                aria-describedby={field["aria-describedby"]}
                options={[
                  {
                    value: "none",
                    label: "No logo",
                    description: "Only the business name is shown.",
                  },
                  { value: "bundled", label: "One of the logos" },
                  { value: "url", label: "A web address", description: "Must start with https://" },
                ]}
              />
            )}
          </FormFieldGroup>
          {logoSource === "bundled" ? (
            <FormFieldGroup control={form.control} name="logoKey" legend="Choose a logo" required>
              {(field) => (
                <AssetPicker
                  name="logoKey"
                  id={field.id}
                  options={LOGO_OPTIONS}
                  value={field.value}
                  onChange={field.onChange}
                  invalid={field["aria-invalid"] === true}
                  disabled={isSubmitting}
                  aria-describedby={field["aria-describedby"]}
                />
              )}
            </FormFieldGroup>
          ) : null}
          {logoSource === "url" ? (
            <FormField
              control={form.control}
              name="logoUrl"
              label="Logo web address"
              required
              description="The logo is shown on the website straight from this address."
            >
              {(field) => (
                <Input
                  {...field}
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isSubmitting}
                />
              )}
            </FormField>
          ) : null}
          <div className="rounded-lg border border-border bg-surface-muted p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-secondary">
              How it looks
            </p>
            <BusinessLogo
              businessName={values.businessName?.trim() || "Your business name"}
              logoKey={logoSource === "bundled" && values.logoKey ? values.logoKey : null}
              logoUrl={logoSource === "url" && values.logoUrl ? values.logoUrl.trim() : null}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Contact</CardTitle>
          <CardDescription>
            How customers reach you. Customer emails come from this address, and notifications for
            your team are sent to it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <FormField control={form.control} name="contactEmail" label="Contact email" required>
            {(field) => (
              <Input {...field} type="email" autoComplete="email" disabled={isSubmitting} />
            )}
          </FormField>
          <FormField control={form.control} name="phone" label="Phone number" required>
            {(field) => <Input {...field} type="tel" autoComplete="tel" disabled={isSubmitting} />}
          </FormField>
          <FormField
            control={form.control}
            name="addressLine1"
            label="Street address"
            required
            className="sm:col-span-2"
          >
            {(field) => <Input {...field} autoComplete="address-line1" disabled={isSubmitting} />}
          </FormField>
          <FormField
            control={form.control}
            name="addressLine2"
            label="Address line 2"
            className="sm:col-span-2"
          >
            {(field) => <Input {...field} autoComplete="address-line2" disabled={isSubmitting} />}
          </FormField>
          <FormField control={form.control} name="city" label="City" required>
            {(field) => <Input {...field} autoComplete="address-level2" disabled={isSubmitting} />}
          </FormField>
          <FormField control={form.control} name="region" label="State or region">
            {(field) => <Input {...field} autoComplete="address-level1" disabled={isSubmitting} />}
          </FormField>
          <FormField control={form.control} name="postalCode" label="Postal code" required>
            {(field) => <Input {...field} autoComplete="postal-code" disabled={isSubmitting} />}
          </FormField>
          <FormField
            control={form.control}
            name="serviceAreaDescription"
            label="Service area"
            description="Where you work, in a sentence or two. Shown on the website."
            className="sm:col-span-2"
          >
            {(field) => (
              <Textarea
                {...field}
                rows={3}
                maxLength={L.serviceArea.maxLength}
                showCount
                disabled={isSubmitting}
              />
            )}
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Region and tax</CardTitle>
          <CardDescription>
            The currency prices are shown in, the time zone dates and times use, and the tax rate a
            new quotation starts with.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormAlert tone="info" data-testid="new-documents-notice">
            Changes here apply to <strong>new</strong> quotations and invoices only. Documents you
            have already created keep the currency, tax rate and terms they were made with.
          </FormAlert>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="currencyCode"
              label="Currency"
              required
              description="Only currencies with two decimal places are available."
            >
              {(field) => (
                <Select {...field} disabled={isSubmitting}>
                  {SUPPORTED_CURRENCIES.map(({ code, name }) => (
                    <option key={code} value={code}>
                      {code} · {name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              control={form.control}
              name="timeZone"
              label="Time zone"
              required
              description="Due dates, expiry and the times customers see use this zone."
            >
              {(field) => (
                <Select {...field} disabled={isSubmitting}>
                  {zoneGroups.map((group) => (
                    <optgroup key={group.region} label={group.region}>
                      {group.zones.map((zone) => (
                        <option key={zone.value} value={zone.value}>
                          {zone.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              control={form.control}
              name="defaultTaxRate"
              label="Default tax rate (%)"
              required
              description="A percentage from 0 to 100, like 8.25."
            >
              {(field) => (
                <Input {...field} inputMode="decimal" autoComplete="off" disabled={isSubmitting} />
              )}
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Quotations and invoices</CardTitle>
          <CardDescription>
            The wording and deadlines every new document starts with.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="quotationValidityDays"
            label="Quotation validity (days)"
            required
            description="How long a sent quotation can be accepted. 1 to 90 days."
          >
            {(field) => (
              <Input {...field} inputMode="numeric" autoComplete="off" disabled={isSubmitting} />
            )}
          </FormField>
          <FormField
            control={form.control}
            name="invoiceDueDays"
            label="Invoice payment term (days)"
            required
            description="Days from issue until an invoice is due. 0 means due on issue."
          >
            {(field) => (
              <Input {...field} inputMode="numeric" autoComplete="off" disabled={isSubmitting} />
            )}
          </FormField>
          <FormField
            control={form.control}
            name="defaultQuotationTerms"
            label="Default quotation terms"
            description="Printed on every new quotation. You can change them on each one."
            className="sm:col-span-2"
          >
            {(field) => (
              <Textarea
                {...field}
                rows={5}
                maxLength={L.quotationTerms.maxLength}
                showCount
                disabled={isSubmitting}
              />
            )}
          </FormField>
          <FormField
            control={form.control}
            name="paymentInstructions"
            label="Payment instructions"
            description="How customers pay you. FixFlow records payments but never takes them, so never put card numbers here."
            className="sm:col-span-2"
          >
            {(field) => (
              <Textarea
                {...field}
                rows={4}
                maxLength={L.paymentInstructions.maxLength}
                showCount
                disabled={isSubmitting}
              />
            )}
          </FormField>
          <FormField
            control={form.control}
            name="invoiceFooter"
            label="Invoice footer"
            description="A closing line at the bottom of every invoice."
            className="sm:col-span-2"
          >
            {(field) => (
              <Textarea
                {...field}
                rows={3}
                maxLength={L.invoiceFooter.maxLength}
                showCount
                disabled={isSubmitting}
              />
            )}
          </FormField>
        </CardContent>
      </Card>

      <FormSaveBar
        dirty={isDirty}
        saving={isSubmitting}
        onDiscard={() => {
          form.reset();
          setFormError(null);
        }}
        savingText="Saving settings…"
      />

      <ConfirmDialog
        open={guard.pendingHref !== null}
        onOpenChange={(open) => {
          if (!open) guard.stay();
        }}
        title="Leave without saving?"
        consequence="You have changes that haven't been saved. If you leave now, they will be lost."
        confirmLabel="Leave without saving"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          guard.leave();
        }}
      />
    </form>
  );
}
