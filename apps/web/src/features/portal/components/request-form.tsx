"use client";

import {
  type CustomerRequestDto,
  LIMITS,
  PREFERRED_WINDOWS,
  preferredWindowHours,
  type PublicServiceDto,
  type ServiceAddressDto,
} from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormAlert } from "@/components/forms/form-alert";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField, FormFieldGroup } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";
import { formatDate, formatTimeZoneName } from "@/lib/formatting";

import { formatAddressOneLine } from "../lib/format-address";
import {
  createRequestFormSchema,
  type DateLimits,
  initialRequestValues,
  REQUEST_FIELD_LABELS,
  type RequestFormValues,
  toRequestBody,
} from "../lib/request-form";
import { requestConfirmationPath } from "../lib/requests-list";
import { RequestAddressSection } from "./request-address-section";
import { ServicePicker } from "./service-picker";
import { WindowPicker } from "./window-picker";

export interface RequestFormProps {
  /** The services open to requests (the page read them from the public catalogue). */
  services: readonly PublicServiceDto[];
  /** The customer's saved addresses, default first. */
  addresses: readonly ServiceAddressDto[];
  /** The service chosen by `?service=<slug>`, if it can be chosen. */
  preselectedServiceId: string | null;
  /** `?service=` named a service that is not open to requests (unknown, unpublished or archived). */
  preselectionUnavailable: boolean;
  /** The first and last day that can be chosen, worked out on the business's calendar. */
  dateLimits: DateLimits;
  /** The business time zone (IANA), for showing the hours of each window. */
  timeZone: string;
}

const STEPS = 5;

function FormSection({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `request-step-${step}`;
  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-surface"
            >
              {step}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle as="h2" id={headingId}>
                <span className="sr-only">
                  Step {step} of {STEPS}:{" "}
                </span>
                {title}
              </CardTitle>
              {description ? <CardDescription>{description}</CardDescription> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">{children}</CardContent>
      </Card>
    </section>
  );
}

/**
 * The request form (FR-020, spec §7.1): five numbered sections on one page, so nothing the
 * customer typed is ever hidden or lost between steps. It checks as the customer goes, shows the
 * API's messages beside the fields, keeps everything typed after any failure, and blocks a second
 * submit while one is pending. The submission key is made once when the form opens, so a retry
 * after a dropped connection returns the first request instead of making a second (D-45).
 */
export function RequestForm({
  services,
  addresses,
  preselectedServiceId,
  preselectionUnavailable,
  dateLimits,
  timeZone,
}: RequestFormProps) {
  const router = useRouter();
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [formError, setFormError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);

  const schema = useMemo(() => createRequestFormSchema(dateLimits), [dateLimits]);
  const form = useForm<RequestFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialRequestValues({ preselectedServiceId, addresses }),
    mode: "onTouched",
    // The error summary takes focus; a field flashing focus first would only get in its way.
    shouldFocusError: false,
  });
  const { errors, isSubmitting, submitCount } = form.formState;
  const busy = isSubmitting || navigating;
  const values = useWatch({ control: form.control });

  const onSubmit = form.handleSubmit(async (submitted) => {
    setFormError(null);
    try {
      const request = await apiFetch<CustomerRequestDto>("/requests", {
        method: "POST",
        body: toRequestBody(submitted, submissionKey),
      });
      // Stay in the busy state until the next page has taken over: the button must not come back
      // to life during the navigation.
      setNavigating(true);
      router.push(requestConfirmationPath(request.id));
    } catch (error) {
      if (isApiError(error) && error.fieldErrors !== undefined) {
        applyApiFieldErrors(form.setError, error.fieldErrors);
      } else {
        setFormError(describeApiError(error));
      }
    }
  });

  const chosenService = services.find((service) => service.id === values.serviceId);
  const chosenSavedAddress = addresses.find((address) => address.id === values.serviceAddressId);
  const zoneName = formatTimeZoneName(
    `${values.preferredDate && values.preferredDate !== "" ? values.preferredDate : dateLimits.min}T12:00:00.000Z`,
    timeZone,
  );

  return (
    <form
      noValidate
      aria-label="Request a service"
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <FormErrorSummary
        errors={errors}
        labels={REQUEST_FIELD_LABELS}
        submitCount={submitCount}
        className="scroll-mt-6"
      />
      {formError !== null ? <FormAlert tone="error">{formError}</FormAlert> : null}

      <FormSection
        step={1}
        title="Choose a service"
        description="Pick the job that fits best. You can describe the details next."
      >
        {preselectionUnavailable ? (
          <FormAlert tone="info">
            The service you picked isn&apos;t open for requests right now. Please choose one of the
            services below.
          </FormAlert>
        ) : null}
        {services.length === 0 ? (
          <FormAlert tone="error">
            No services are open for requests at the moment. Please try again later.
          </FormAlert>
        ) : (
          <FormFieldGroup control={form.control} name="serviceId" legend="Service" required>
            {(field) => (
              <ServicePicker
                services={services}
                value={field.value}
                onChange={field.onChange}
                disabled={busy}
                id={field.id}
                aria-invalid={field["aria-invalid"]}
                aria-describedby={field["aria-describedby"]}
                aria-required={field["aria-required"]}
              />
            )}
          </FormFieldGroup>
        )}
      </FormSection>

      <FormSection
        step={2}
        title="Describe the problem"
        description="The more we know, the more accurate your quotation."
      >
        <FormField
          control={form.control}
          name="description"
          label="What needs fixing?"
          required
          description={
            <>
              Say what is wrong, when it started and anything you have tried. For example: “The AC
              runs but blows warm air. It started two days ago and the outdoor unit rattles.” At
              least {LIMITS.requestDescription.minLength} characters.
            </>
          }
        >
          {(field) => (
            <Textarea
              {...field}
              rows={6}
              maxLength={LIMITS.requestDescription.maxLength}
              showCount
              disabled={busy}
            />
          )}
        </FormField>
      </FormSection>

      <FormSection
        step={3}
        title="Where should we come?"
        description="The address where the work is to be done."
      >
        <RequestAddressSection form={form} addresses={addresses} disabled={busy} />
      </FormSection>

      <FormSection
        step={4}
        title="When would suit you?"
        description="This is a preference — we'll confirm the exact time with you."
      >
        <FormField
          control={form.control}
          name="preferredDate"
          label="Preferred date"
          required
          description={`Choose a day from ${formatDate(dateLimits.min, timeZone)} to ${formatDate(dateLimits.max, timeZone)}.`}
        >
          {(field) => (
            <DateInput
              {...field}
              min={dateLimits.min}
              max={dateLimits.max}
              disabled={busy}
              className="sm:max-w-64"
            />
          )}
        </FormField>

        <FormFieldGroup
          control={form.control}
          name="preferredWindow"
          legend="Preferred time of day"
          required
          description={`Times are in the business's local time (${zoneName}).`}
        >
          {(field) => (
            <WindowPicker
              value={field.value}
              onChange={field.onChange}
              disabled={busy}
              id={field.id}
              aria-invalid={field["aria-invalid"]}
              aria-describedby={field["aria-describedby"]}
              aria-required={field["aria-required"]}
            />
          )}
        </FormFieldGroup>
      </FormSection>

      <FormSection
        step={5}
        title="Review and send"
        description="Check the details, then send your request. We'll review it and prepare a quotation."
      >
        <DescriptionList aria-label="Your request so far">
          <DescriptionItem term="Service">
            {chosenService?.name ?? <span className="text-ink-secondary">Not chosen yet</span>}
          </DescriptionItem>
          <DescriptionItem term="Problem">
            {values.description && values.description.trim() !== "" ? (
              <span className="line-clamp-3 whitespace-pre-line">{values.description.trim()}</span>
            ) : (
              <span className="text-ink-secondary">Not described yet</span>
            )}
          </DescriptionItem>
          <DescriptionItem term="Address">
            <AddressSummary
              mode={values.addressMode}
              saved={chosenSavedAddress}
              typed={values.newAddress}
            />
          </DescriptionItem>
          <DescriptionItem term="Preferred time">
            {values.preferredDate && values.preferredWindow ? (
              <>
                {formatDate(values.preferredDate, timeZone)},{" "}
                {PREFERRED_WINDOWS[values.preferredWindow].label.toLowerCase()} (
                {preferredWindowHours(values.preferredWindow)} {zoneName})
              </>
            ) : (
              <span className="text-ink-secondary">Not chosen yet</span>
            )}
          </DescriptionItem>
        </DescriptionList>

        <Button
          type="submit"
          size="lg"
          className="w-full sm:w-auto sm:self-start"
          loading={busy}
          loadingText="Sending your request…"
        >
          Send request
        </Button>
      </FormSection>
    </form>
  );
}

function AddressSummary({
  mode,
  saved,
  typed,
}: {
  mode: RequestFormValues["addressMode"] | undefined;
  saved: ServiceAddressDto | undefined;
  typed: Partial<RequestFormValues["newAddress"]> | undefined;
}) {
  const none = <span className="text-ink-secondary">Not chosen yet</span>;
  if (mode === "saved") {
    return saved === undefined ? (
      none
    ) : (
      <>
        <span className="font-medium">{saved.label}</span>: {formatAddressOneLine(saved)}
      </>
    );
  }
  const line1 = typed?.line1?.trim() ?? "";
  if (line1 === "") {
    return none;
  }
  return (
    <>
      {formatAddressOneLine({
        line1,
        line2: typed?.line2?.trim() ?? null,
        city: typed?.city?.trim() ?? "",
        region: typed?.region?.trim() ?? null,
        postalCode: typed?.postalCode?.trim() ?? "",
      })}
    </>
  );
}
