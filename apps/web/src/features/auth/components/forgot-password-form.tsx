"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert } from "@/components/forms/form-alert";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, isApiError } from "@/lib/api";

import { describeAuthError } from "../lib/errors";
import { forgotPasswordSchema, type ForgotPasswordValues } from "../lib/schemas";

/**
 * Asks for a password-reset email. Whatever address is typed, the confirmation is the same
 * sentence: the API never says whether an account exists, and neither does this screen. In
 * development the note explains where the link went, since no mail is sent.
 */
export function ForgotPasswordForm({ showOutboxNote }: { showOutboxNote: boolean }) {
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
    mode: "onTouched",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const { isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setConfirmation(null);
    try {
      const { message } = await apiFetch<{ message: string }>("/auth/password/forgot", {
        method: "POST",
        body: values,
      });
      setConfirmation(message);
    } catch (error) {
      if (isApiError(error) && error.status === 422) {
        applyApiFieldErrors(form.setError, error.fieldErrors);
      } else {
        setFormError(describeAuthError(error));
      }
    }
  });

  return (
    <div className="flex flex-col gap-5">
      {formError !== null ? <FormAlert tone="error">{formError}</FormAlert> : null}
      {confirmation !== null ? (
        <FormAlert tone="success" data-testid="forgot-confirmation">
          <p>{confirmation}</p>
          <p className="mt-1 font-normal">
            It can take a few minutes to arrive. Check your spam folder if you don&apos;t see it.
          </p>
        </FormAlert>
      ) : null}
      {showOutboxNote ? (
        <FormAlert tone="info">
          Development mode: no email is sent. The reset link is written to the{" "}
          <code className="rounded bg-surface px-1">.data/outbox/</code> folder at the repository
          root.
        </FormAlert>
      ) : null}

      <form
        noValidate
        aria-label="Reset your password"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <FormField
          control={form.control}
          name="email"
          label="Email address"
          required
          description="The address you signed up with."
        >
          {(field) => (
            <Input
              type="email"
              autoComplete="email"
              inputMode="email"
              disabled={isSubmitting}
              {...field}
            />
          )}
        </FormField>
        <Button
          type="submit"
          size="lg"
          loading={isSubmitting}
          loadingText="Sending the reset link…"
        >
          {confirmation === null ? "Send reset link" : "Send another link"}
        </Button>
      </form>
    </div>
  );
}
