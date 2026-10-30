"use client";

import type { CustomerProfileDto } from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Field } from "@/components/forms/field";
import { FormAlert } from "@/components/forms/form-alert";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import {
  profileFormSchema,
  type ProfileFormValues,
  profileToFormValues,
  toProfileBody,
} from "../lib/profile-form";

export interface ContactDetailsFormProps {
  profile: Pick<CustomerProfileDto, "name" | "email" | "phone">;
}

/**
 * "Contact details" on the customer's profile (FR-013): the name and the phone number can be
 * changed, the email address is shown and cannot (D-39). Saving sends only what changed, shows the
 * API's messages beside the fields, keeps what was typed after any failure and confirms with a toast
 * only once the server has said yes.
 */
export function ContactDetailsForm({ profile }: ContactDetailsFormProps) {
  const router = useRouter();
  const [saved, setSaved] = useState<ProfileFormValues>(() => profileToFormValues(profile));
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: saved,
    mode: "onTouched",
    shouldFocusError: true,
  });
  const { isDirty, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body = toProfileBody(saved, values);
    try {
      const updated = await apiFetch<CustomerProfileDto>("/customers/me", {
        method: "PATCH",
        body,
      });
      const next = profileToFormValues(updated);
      setSaved(next);
      form.reset(next);
      toast.success("Contact details saved");
      // The name also appears in the account menu and the greeting.
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
    <Card>
      <CardHeader>
        <CardTitle as="h2">Contact details</CardTitle>
        <CardDescription>How we address you and reach you about your requests.</CardDescription>
      </CardHeader>
      <form
        noValidate
        aria-label="Contact details"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <CardContent className="flex flex-col gap-5">
          {formError !== null ? <FormAlert tone="error">{formError}</FormAlert> : null}

          <FormField control={form.control} name="name" label="Name" required>
            {(field) => <Input {...field} autoComplete="name" disabled={isSubmitting} />}
          </FormField>

          <FormField
            control={form.control}
            name="phone"
            label="Phone number"
            description="Optional. Our team may call you to arrange a visit."
          >
            {(field) => (
              <Input
                {...field}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                disabled={isSubmitting}
              />
            )}
          </FormField>

          <Field
            id="profile-email"
            label="Email address"
            description={
              <>
                This is the address you sign in with.{" "}
                <Link
                  href="/#contact"
                  className="font-medium text-brand underline underline-offset-4"
                >
                  Contact us
                </Link>{" "}
                if you need to change your email.
              </>
            }
          >
            {(control) => <Input {...control} type="email" value={profile.email} readOnly />}
          </Field>
        </CardContent>
        <CardFooter>
          <Button
            type="submit"
            disabled={!isDirty}
            loading={isSubmitting}
            loadingText="Saving your details…"
          >
            Save changes
          </Button>
          {isDirty ? (
            <Button
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => {
                form.reset(saved);
                setFormError(null);
              }}
            >
              Discard changes
            </Button>
          ) : null}
        </CardFooter>
      </form>
    </Card>
  );
}
