"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LinkIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormAlert } from "@/components/forms/form-alert";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { apiFetch, isApiError } from "@/lib/api";
import { FORGOT_PASSWORD_PATH, LOGIN_PATH } from "@/lib/auth/paths";
import { cn } from "@/lib/utils";

import { describeAuthError } from "../lib/errors";
import { PASSWORD_HELP, resetPasswordSchema, type ResetPasswordValues } from "../lib/schemas";
import { PasswordInput } from "./password-input";
import { PasswordStrength } from "./password-strength";

/** The state shown when the link is missing, wrong, used or expired. */
export function InvalidResetLink() {
  return (
    <div className="flex flex-col items-start gap-4" data-testid="reset-invalid">
      <FormAlert tone="error">
        This reset link is invalid or has expired. Links work once and for 60 minutes.
      </FormAlert>
      <Link
        href={FORGOT_PASSWORD_PATH}
        className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
      >
        <LinkIcon aria-hidden="true" />
        Request a new link
      </Link>
    </div>
  );
}

/**
 * Chooses a new password with the token from the emailed link. On success every session of the
 * account has been signed out by the API, so the next step is to sign in. A rejected token shows
 * the "request a new link" state instead of leaving the person at a form that cannot work.
 */
export function ResetPasswordForm({ token }: { token: string | undefined }) {
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", passwordConfirmation: "" },
    mode: "onTouched",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [state, setState] = useState<"form" | "done" | "invalid">(
    token === undefined || token === "" ? "invalid" : "form",
  );
  const password = useWatch({ control: form.control, name: "password" });
  const { isSubmitting } = form.formState;

  if (state === "invalid") {
    return <InvalidResetLink />;
  }

  if (state === "done") {
    return (
      <div className="flex flex-col items-start gap-4" data-testid="reset-success">
        <FormAlert tone="success">
          <p>Your password has been changed.</p>
          <p className="mt-1 font-normal">
            For your security you were signed out everywhere. Sign in with your new password.
          </p>
        </FormAlert>
        <Link
          href={LOGIN_PATH}
          className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
        >
          Sign in
        </Link>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiFetch("/auth/password/reset", {
        method: "POST",
        body: { token, ...values },
      });
      setState("done");
    } catch (error) {
      if (isApiError(error) && error.code === "INVALID_RESET_TOKEN") {
        setState("invalid");
      } else if (isApiError(error) && error.status === 422) {
        applyApiFieldErrors(form.setError, error.fieldErrors);
      } else {
        setFormError(describeAuthError(error));
      }
    }
  });

  return (
    <div className="flex flex-col gap-5">
      {formError !== null ? <FormAlert tone="error">{formError}</FormAlert> : null}
      <form
        noValidate
        aria-label="Choose a new password"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <div className="flex flex-col gap-2">
          <FormField
            control={form.control}
            name="password"
            label="New password"
            required
            description={PASSWORD_HELP}
          >
            {(field) => (
              <PasswordInput autoComplete="new-password" disabled={isSubmitting} {...field} />
            )}
          </FormField>
          <PasswordStrength password={password} />
        </div>
        <FormField
          control={form.control}
          name="passwordConfirmation"
          label="Confirm new password"
          required
        >
          {(field) => (
            <PasswordInput autoComplete="new-password" disabled={isSubmitting} {...field} />
          )}
        </FormField>
        <Button
          type="submit"
          size="lg"
          loading={isSubmitting}
          loadingText="Saving your new password…"
        >
          Change password
        </Button>
      </form>
    </div>
  );
}
