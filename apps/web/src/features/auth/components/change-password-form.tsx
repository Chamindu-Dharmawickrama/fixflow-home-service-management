"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormAlert } from "@/components/forms/form-alert";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { apiFetch, isApiError } from "@/lib/api";
import { FORGOT_PASSWORD_PATH } from "@/lib/auth/paths";
import { cn } from "@/lib/utils";

import { describeAuthError } from "../lib/errors";
import { changePasswordSchema, type ChangePasswordValues, PASSWORD_HELP } from "../lib/schemas";
import { PasswordInput } from "./password-input";
import { PasswordStrength } from "./password-strength";

/**
 * "Change password" for a signed-in person (T05; T10 mounts the same form in the customer's
 * profile). Needs the current password, applies the same policy as sign-up and signs the person
 * out of their other devices. An account that signs in with Google has no password to change; it
 * gets "Set a password", which goes through the emailed reset flow that proves the address is theirs.
 */
export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", newPasswordConfirmation: "" },
    mode: "onTouched",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const newPassword = useWatch({ control: form.control, name: "newPassword" });
  const { isSubmitting } = form.formState;

  if (!hasPassword) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-ink-secondary">
          You sign in with Google, so there is no password to change. You can also add a password to
          sign in with your email address. We&apos;ll email you a link to set one.
        </p>
        <Link href={FORGOT_PASSWORD_PATH} className={cn(buttonVariants({ variant: "outline" }))}>
          Set a password
        </Link>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    try {
      await apiFetch("/auth/password/change", { method: "POST", body: values });
      form.reset();
      setSaved(true);
    } catch (error) {
      if (isApiError(error) && error.status === 422 && error.fieldErrors !== undefined) {
        applyApiFieldErrors(form.setError, error.fieldErrors);
      } else {
        setFormError(describeAuthError(error));
      }
    }
  });

  return (
    <form
      noValidate
      aria-label="Change password"
      className="flex max-w-md flex-col gap-5"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      {formError !== null ? <FormAlert tone="error">{formError}</FormAlert> : null}
      {saved ? (
        <FormAlert tone="success" data-testid="password-changed">
          Your password has been changed. Your other devices were signed out.
        </FormAlert>
      ) : null}
      <FormField control={form.control} name="currentPassword" label="Current password" required>
        {(field) => (
          <PasswordInput autoComplete="current-password" disabled={isSubmitting} {...field} />
        )}
      </FormField>
      <div className="flex flex-col gap-2">
        <FormField
          control={form.control}
          name="newPassword"
          label="New password"
          required
          description={PASSWORD_HELP}
        >
          {(field) => (
            <PasswordInput autoComplete="new-password" disabled={isSubmitting} {...field} />
          )}
        </FormField>
        <PasswordStrength password={newPassword} />
      </div>
      <FormField
        control={form.control}
        name="newPasswordConfirmation"
        label="Confirm new password"
        required
      >
        {(field) => (
          <PasswordInput autoComplete="new-password" disabled={isSubmitting} {...field} />
        )}
      </FormField>
      <div>
        <Button type="submit" loading={isSubmitting} loadingText="Changing your password…">
          Change password
        </Button>
      </div>
    </form>
  );
}
