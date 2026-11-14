"use client";

import type { AuthSessionDto } from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert, OrDivider } from "@/components/forms/form-alert";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, isApiError } from "@/lib/api";
import { navigateWithFullReload } from "@/lib/auth/navigate";
import { destinationAfterSignIn, FORGOT_PASSWORD_PATH } from "@/lib/auth/paths";

import { DEMO_NOTICE, type DemoAccountOption } from "../demo-accounts";
import { describeAuthError } from "../lib/errors";
import { loginSchema, type LoginValues } from "../lib/schemas";
import { DemoAccountsPanel } from "./demo-accounts-panel";
import { GoogleSignInButton } from "./google-sign-in-button";
import { PasswordInput } from "./password-input";
import { useGoogleSignIn } from "./use-google-sign-in";

export interface LoginFormProps {
  /** The page the visitor was headed for (`?returnTo=`). Sanitized before use. */
  returnTo: string | undefined;
  /** `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; undefined hides the button behind an explanation. */
  googleClientId: string | undefined;
  /** Demo accounts to offer, empty outside demo mode. */
  demoAccounts: readonly DemoAccountOption[];
  /** The public demo is on: visitors are told to use fictional details even when no account is offered. */
  demoMode?: boolean;
}

/**
 * The sign-in form (FR-010): email and password, or Google. One generic error for every failed
 * attempt, input kept after an error, and a pending state that blocks a second submit. After a
 * successful sign-in the browser navigates to the sanitized `returnTo` or the role's home.
 */
export function LoginForm({
  returnTo,
  googleClientId,
  demoAccounts,
  demoMode = false,
}: LoginFormProps) {
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
    shouldFocusError: true,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [filledFor, setFilledFor] = useState<string | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const google = useGoogleSignIn(returnTo);
  const { isSubmitting } = form.formState;
  const busy = isSubmitting || navigating || google.pending;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setFilledFor(null);
    try {
      const { user } = await apiFetch<AuthSessionDto>("/auth/login", {
        method: "POST",
        body: values,
      });
      setNavigating(true);
      navigateWithFullReload(destinationAfterSignIn(returnTo, user.role));
    } catch (error) {
      if (isApiError(error) && error.code === "VALIDATION_ERROR") {
        applyApiFieldErrors(form.setError, error.fieldErrors);
      } else {
        setFormError(describeAuthError(error));
      }
    }
  });

  const useDemoAccount = (account: DemoAccountOption) => {
    form.setValue("email", account.email, { shouldValidate: true });
    form.setValue("password", account.password, { shouldValidate: true });
    setFormError(null);
    setFilledFor(`${account.name}, ${account.roleLabel}`);
    // The visitor still presses "Sign in"; put the keyboard focus on it.
    submitRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-5">
      {demoMode && demoAccounts.length === 0 ? (
        // With the accounts panel the same notice sits inside it; this is for a demo that offers none.
        <FormAlert tone="info" data-testid="demo-sign-in-notice">
          {DEMO_NOTICE}{" "}
          <Link
            href="/privacy"
            className="rounded-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            Read the demo notice
          </Link>
        </FormAlert>
      ) : null}
      {formError !== null || google.error !== null ? (
        <FormAlert tone="error">{formError ?? google.error}</FormAlert>
      ) : null}

      <form
        noValidate
        aria-label="Sign in"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <FormField control={form.control} name="email" label="Email address" required>
          {(field) => (
            <Input
              type="email"
              autoComplete="username"
              inputMode="email"
              disabled={busy}
              {...field}
            />
          )}
        </FormField>
        <FormField control={form.control} name="password" label="Password" required>
          {(field) => <PasswordInput autoComplete="current-password" disabled={busy} {...field} />}
        </FormField>
        <div className="-mt-2 text-sm">
          <Link
            href={FORGOT_PASSWORD_PATH}
            className="text-brand underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        {filledFor !== null ? (
          <p role="status" className="text-sm text-ink-secondary">
            Filled in the details for {filledFor}. Press Sign in to continue.
          </p>
        ) : null}
        <Button
          ref={submitRef}
          type="submit"
          size="lg"
          loading={busy}
          loadingText="Signing you in…"
        >
          Sign in
        </Button>
      </form>

      <OrDivider />
      <GoogleSignInButton
        clientId={googleClientId}
        text="signin_with"
        onCredential={(credential) => {
          void google.signIn(credential);
        }}
      />

      {demoAccounts.length > 0 ? (
        <DemoAccountsPanel accounts={demoAccounts} onUse={useDemoAccount} />
      ) : null}
    </div>
  );
}
