"use client";

import {
  type AdminServiceDto,
  BUNDLED_SERVICE_IMAGES,
  LIMITS,
  PricingMode,
  slugify,
} from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField, FormFieldGroup } from "@/components/forms/form-field";
import { FormSaveBar } from "@/components/forms/form-save-bar";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/components/form-alert";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import { SERVICE_IMAGE_ASSETS } from "../lib/bundled-assets";
import { changedBodyFields } from "../lib/changed-fields";
import {
  EMPTY_SERVICE_VALUES,
  formFieldForApiError,
  serviceFormSchema,
  serviceFormToCard,
  type ServiceFormValues,
  serviceToFormValues,
  toServiceBody,
} from "../lib/service-form";
import { AssetPicker } from "./asset-picker";
import { InclusionsEditor } from "./inclusions-editor";
import { ServiceCard } from "./service-card";
import { ServiceVisibilityCard } from "./service-visibility-card";
import { SourceChoice } from "./source-choice";

const S = LIMITS.service;

const FIELD_LABELS: Record<string, string> = {
  name: "Service name",
  slug: "Web address",
  category: "Category",
  shortDescription: "Short description",
  fullDescription: "Full description",
  inclusions: "What's included",
  estimatedDurationMinutes: "Estimated duration",
  pricingMode: "Pricing",
  startingPrice: "Starting price",
  imageKey: "Picture",
  imageUrl: "Picture address",
  sortOrder: "Display order",
};

const PICTURE_OPTIONS = BUNDLED_SERVICE_IMAGES.map(({ key, label }) => ({
  key,
  label,
  asset: SERVICE_IMAGE_ASSETS[key],
}));

export type ServiceFormProps =
  | { mode: "create"; currencyCode: string; categories: readonly string[] }
  | { mode: "edit"; service: AdminServiceDto; currencyCode: string; categories: readonly string[] };

/**
 * Create or edit a service (FR-101): the fields, a live preview of the card a visitor will see,
 * and, when editing, the visibility controls. Field errors from the API (`fieldErrors`, including
 * `409 SLUG_TAKEN`) appear beside their fields; what was typed is kept after any failure. The form
 * warns before unsaved changes are lost, sends only the fields that changed, and names the status it
 * was loaded in so a service that someone else archived is not silently overwritten (D-46).
 */
export function ServiceForm(props: ServiceFormProps) {
  const { mode, currencyCode, categories } = props;
  const service = props.mode === "edit" ? props.service : undefined;
  const router = useRouter();

  const [initialValues] = useState<ServiceFormValues>(() =>
    service ? serviceToFormValues(service) : EMPTY_SERVICE_VALUES,
  );
  /** The last saved version, as the API takes it: a save sends only what differs from it. */
  const [saved, setSaved] = useState(() => toServiceBody(initialValues));
  const [slugEdited, setSlugEdited] = useState(mode === "edit");
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: initialValues,
    mode: "onTouched",
    shouldFocusError: false,
  });
  const { isDirty, isSubmitting, submitCount, errors } = form.formState;
  const values = useWatch({ control: form.control });
  const guard = useUnsavedChangesGuard(isDirty && !isSubmitting);

  const pricingMode = values.pricingMode ?? initialValues.pricingMode;
  const imageSource = values.imageSource ?? initialValues.imageSource;
  const slug = values.slug ?? "";
  const slugChanged = mode === "edit" && service !== undefined && slug.trim() !== service.slug;

  const failWith = (error: unknown) => {
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
      return;
    }
    setFormError(describeApiError(error));
    // The service moved on (archived, published) since this page was loaded: show it as it is now.
    if (isApiError(error) && error.status === 409) {
      router.refresh();
    }
  };

  const onSubmit = form.handleSubmit(async (formValues) => {
    setFormError(null);
    const body = toServiceBody(formValues);
    try {
      if (service === undefined) {
        const created = await apiFetch<AdminServiceDto>("/admin/services", {
          method: "POST",
          body,
        });
        toast.success(`“${created.name}” was created`, {
          description: "It stays off the website until you publish it.",
        });
        // Clean before leaving, so the unsaved-changes warning does not stop the redirect.
        form.reset(formValues);
        router.push(`/app/settings/services/${created.id}`);
        return;
      }
      const changes = changedBodyFields(saved, body);
      const updated = await apiFetch<AdminServiceDto>(`/admin/services/${service.id}`, {
        method: "PATCH",
        body: { ...changes, expectedStatus: service.status },
      });
      const next = serviceToFormValues(updated);
      setSaved(toServiceBody(next));
      form.reset(next);
      toast.success("Changes saved", { description: `“${updated.name}” was updated.` });
      router.refresh();
    } catch (error) {
      failWith(error);
    }
  });

  const discard = () => {
    form.reset();
    setFormError(null);
    setSlugEdited(mode === "edit");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <form
        noValidate
        aria-label={mode === "create" ? "New service" : "Edit service"}
        className="flex min-w-0 flex-col gap-6"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <FormErrorSummary errors={errors} labels={FIELD_LABELS} submitCount={submitCount} />
        {formError !== null ? <FormAlert tone="error">{formError}</FormAlert> : null}

        <Card>
          <CardHeader>
            <CardTitle as="h2">The basics</CardTitle>
            <CardDescription>What the service is called and where its page lives.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FormField control={form.control} name="name" label="Service name" required>
              {(field) => (
                <Input
                  {...field}
                  autoComplete="off"
                  disabled={isSubmitting}
                  onChange={(event) => {
                    field.onChange(event);
                    if (!slugEdited) {
                      const typed = event.target.value.trim();
                      form.setValue("slug", typed === "" ? "" : slugify(typed), {
                        shouldDirty: true,
                        shouldValidate: submitCount > 0,
                      });
                    }
                  }}
                />
              )}
            </FormField>
            <div className="flex flex-col gap-2">
              <FormField
                control={form.control}
                name="slug"
                label="Web address"
                required
                description={
                  mode === "create"
                    ? `The service page will be at /services/${slug.trim() || "…"}. It is made from the name until you change it here.`
                    : `The service page is at /services/${service?.slug ?? ""}.`
                }
              >
                {(field) => (
                  <Input
                    {...field}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isSubmitting}
                    onChange={(event) => {
                      field.onChange(event);
                      setSlugEdited(event.target.value !== "");
                    }}
                  />
                )}
              </FormField>
              {slugChanged ? (
                <FormAlert tone="info">
                  Changing the web address breaks existing links to /services/{service?.slug}, such
                  as bookmarks and links in emails you have already sent. Customers who follow the
                  old link will not find the service.
                </FormAlert>
              ) : null}
            </div>
            <FormField
              control={form.control}
              name="category"
              label="Category"
              required
              description="Groups services on the website, like “Air conditioning”. Pick an existing one or type a new one."
            >
              {(field) => (
                <>
                  <Input
                    {...field}
                    list="category-suggestions"
                    autoComplete="off"
                    disabled={isSubmitting}
                  />
                  <datalist id="category-suggestions">
                    {categories.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </>
              )}
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Description</CardTitle>
            <CardDescription>What visitors read about the service.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FormField
              control={form.control}
              name="shortDescription"
              label="Short description"
              required
              description="One or two sentences for the service list."
            >
              {(field) => (
                <Textarea
                  {...field}
                  rows={3}
                  maxLength={S.shortDescription.maxLength}
                  showCount
                  disabled={isSubmitting}
                />
              )}
            </FormField>
            <FormField
              control={form.control}
              name="fullDescription"
              label="Full description"
              required
              description="Shown on the service page: what happens, what to expect, what is not covered."
            >
              {(field) => (
                <Textarea
                  {...field}
                  rows={7}
                  maxLength={S.fullDescription.maxLength}
                  showCount
                  disabled={isSubmitting}
                />
              )}
            </FormField>
            <InclusionsEditor control={form.control} disabled={isSubmitting} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Pricing and time</CardTitle>
            <CardDescription>
              Every request still gets a written quotation. This is only what the website shows.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FormFieldGroup control={form.control} name="pricingMode" legend="Pricing" required>
              {(field) => (
                <SourceChoice
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  disabled={isSubmitting}
                  aria-describedby={field["aria-describedby"]}
                  aria-invalid={field["aria-invalid"]}
                  options={[
                    {
                      value: PricingMode.QUOTE_REQUIRED,
                      label: "Request a quote",
                      description: "The website shows “Request a quote”, with no price.",
                    },
                    {
                      value: PricingMode.FIXED,
                      label: "Fixed starting price",
                      description: "The website shows “From” and the price below.",
                    },
                  ]}
                />
              )}
            </FormFieldGroup>
            {pricingMode === PricingMode.FIXED ? (
              <FormField
                control={form.control}
                name="startingPrice"
                label={`Starting price (${currencyCode})`}
                required
                description="The lowest price a customer should expect, before tax."
                className="sm:max-w-xs"
              >
                {(field) => (
                  <Input
                    {...field}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={isSubmitting}
                  />
                )}
              </FormField>
            ) : null}
            <FormField
              control={form.control}
              name="estimatedDurationMinutes"
              label="Usual time on site (minutes)"
              description="Optional. Shown as “1 hr 30 min”. Leave it empty if it varies too much."
              className="sm:max-w-xs"
            >
              {(field) => (
                <Input {...field} inputMode="numeric" autoComplete="off" disabled={isSubmitting} />
              )}
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Picture</CardTitle>
            <CardDescription>
              Choose one of the illustrations that come with FixFlow, or link to a picture you host
              yourself. Pictures cannot be uploaded.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FormFieldGroup control={form.control} name="imageSource" legend="Picture">
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
                      label: "No picture",
                      description: "A neutral illustration is shown.",
                    },
                    { value: "bundled", label: "One of the illustrations" },
                    {
                      value: "url",
                      label: "A web address",
                      description: "Must start with https://",
                    },
                  ]}
                />
              )}
            </FormFieldGroup>
            {imageSource === "bundled" ? (
              <FormFieldGroup
                control={form.control}
                name="imageKey"
                legend="Choose an illustration"
                required
              >
                {(field) => (
                  <AssetPicker
                    name="imageKey"
                    id={field.id}
                    options={PICTURE_OPTIONS}
                    value={field.value}
                    onChange={field.onChange}
                    invalid={field["aria-invalid"] === true}
                    disabled={isSubmitting}
                    aria-describedby={field["aria-describedby"]}
                  />
                )}
              </FormFieldGroup>
            ) : null}
            {imageSource === "url" ? (
              <FormField
                control={form.control}
                name="imageUrl"
                label="Picture web address"
                required
                description="The picture is shown on the website straight from this address."
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Order on the website</CardTitle>
            <CardDescription>
              Services are listed from the lowest number to the highest; equal numbers are
              alphabetical.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="sortOrder"
              label="Display order"
              required
              className="sm:max-w-xs"
            >
              {(field) => (
                <Input {...field} inputMode="numeric" autoComplete="off" disabled={isSubmitting} />
              )}
            </FormField>
          </CardContent>
        </Card>

        <FormSaveBar
          dirty={isDirty}
          saving={isSubmitting}
          onDiscard={discard}
          saveLabel={mode === "create" ? "Create service" : "Save changes"}
          savingText={mode === "create" ? "Creating service…" : "Saving service…"}
        />
      </form>

      <aside
        aria-label="Preview and visibility"
        className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24"
      >
        <Card data-testid="service-preview">
          <CardHeader>
            <CardTitle as="h2">Preview</CardTitle>
            <CardDescription>
              How the service looks in the website&apos;s service list.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ServiceCard service={serviceFormToCard(values, currencyCode)} headingLevel="h3" />
          </CardContent>
        </Card>
        {service ? (
          <ServiceVisibilityCard
            service={service}
            disabled={isDirty || isSubmitting}
            reason="Save or discard your changes first, so what goes live is what you see."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Visibility</CardTitle>
              <CardDescription>
                A new service starts unpublished. After you create it you can publish it from here.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </aside>

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
    </div>
  );
}
