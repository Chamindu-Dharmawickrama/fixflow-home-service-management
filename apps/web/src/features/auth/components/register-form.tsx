"use client";

import type { AuthSessionDto } from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { apiFetch, isApiError } from "@/lib/api";
import { navigateWithFullReload } from "@/lib/auth/navigate";
import { destinationAfterSignIn } from "@/lib/auth/paths";

import { DEMO_NOTICE } from "../demo-accounts";
import { describeAuthError } from "../lib/errors";
import { PASSWORD_HELP, registerSchema, type RegisterValues } from "../lib/schemas";
import { FormAlert, OrDivider } from "./form-alert";
import { GoogleSignInButton } from "./google-sign-in-button";
import { PasswordInput } from "./password-input";
import { PasswordStrength } from "./password-strength";
import { useGoogleSignIn } from "./use-google-sign-in";

const PRIVACY_LINK_CLASS =
  "rounded-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover";

/** Links to the public privacy and demo notice (T08), which says what is stored and who can see it. */
function PrivacyLink({ children }: { children: string }) {
  return (
    <Link href="/privacy" className={PRIVACY_LINK_CLASS}>
      {children}
    </Link>
  );
}

const TERMS_NOTICE = (
  <>
    By creating an account you agree to the terms of use and{" "}
    <PrivacyLink>privacy notice</PrivacyLink>: we use your details only to handle your service
    requests, and we never sell them.
  </>
);

export interface RegisterFormProps {
  googleClientId: string | undefined;
  /** Shows the public-demo privacy notice (D-09). */
  demoMode: boolean;
}

/**
 * The registration form (FR-010, D-49): name, email, password with confirmation and a strength
 * hint, and an explicit terms checkbox; or "Continue with Google", with the terms notice beside
 * it. New accounts are always customers. Registration may say that an email is taken (a
 * documented, rate-limited trade-off), and a closed sign-up (`SIGNUP_DISABLED`) is explained.
 */
export function RegisterForm({ googleClientId, demoMode }: RegisterFormProps) {
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      passwordConfirmation: "",
      acceptTerms: false,
    },
    mode: "onTouched",
    shouldFocusError: false,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const google = useGoogleSignIn(undefined);
  const password = useWatch({ control: form.control, name: "password" });
  const { errors, isSubmitting, submitCount } = form.formState;
  const busy = isSubmitting || navigating || google.pending;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { user } = await apiFetch<AuthSessionDto>("/auth/register", {
        method: "POST",
        body: values,
      });
      setNavigating(true);
      navigateWithFullReload(destinationAfterSignIn(undefined, user.role));
    } catch (error) {
      if (isApiError(error) && error.fieldErrors !== undefined && error.status === 422) {
        applyApiFieldErrors(form.setError, error.fieldErrors);
      } else {
        setFormError(describeAuthError(error));
      }
    }
  });

  return (
    <div className="flex flex-col gap-5">
      {demoMode ? (
        <FormAlert tone="info">
          {DEMO_NOTICE} <PrivacyLink>Read the demo notice</PrivacyLink>
        </FormAlert>
      ) : null}
      {formError !== null || google.error !== null ? (
        <FormAlert tone="error">{formError ?? google.error}</FormAlert>
      ) : null}

      <form
        noValidate
        aria-label="Create your account"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <FormErrorSummary
          errors={errors}
          labels={{
            name: "Full name",
            email: "Email address",
            password: "Password",
            passwordConfirmation: "Confirm password",
            acceptTerms: "Terms and privacy notice",
          }}
          submitCount={submitCount}
        />
        <FormField control={form.control} name="name" label="Full name" required>
          {(field) => <Input autoComplete="name" disabled={busy} {...field} />}
        </FormField>
        <FormField control={form.control} name="email" label="Email address" required>
          {(field) => (
            <Input type="email" autoComplete="email" inputMode="email" disabled={busy} {...field} />
          )}
        </FormField>
        <div className="flex flex-col gap-2">
          <FormField
            control={form.control}
            name="password"
            label="Password"
            required
            description={PASSWORD_HELP}
          >
            {(field) => <PasswordInput autoComplete="new-password" disabled={busy} {...field} />}
          </FormField>
          <PasswordStrength password={password} />
        </div>
        <FormField
          control={form.control}
          name="passwordConfirmation"
          label="Confirm password"
          required
        >
          {(field) => <PasswordInput autoComplete="new-password" disabled={busy} {...field} />}
        </FormField>
        <FormField
          control={form.control}
          name="acceptTerms"
          layout="inline"
          required
          label="I accept the terms of use and privacy notice"
          description={TERMS_NOTICE}
        >
          {({ value, onChange, ...field }) => (
            <Checkbox
              checked={value}
              disabled={busy}
              onCheckedChange={(checked) => {
                onChange(checked === true);
              }}
              {...field}
            />
          )}
        </FormField>
        <Button type="submit" size="lg" loading={busy} loadingText="Creating your account…">
          Create account
        </Button>
      </form>

      <OrDivider />
      <div className="flex flex-col gap-3">
        <GoogleSignInButton
          clientId={googleClientId}
          text="continue_with"
          onCredential={(credential) => {
            void google.signIn(credential);
          }}
        />
        <p className="text-center text-sm text-ink-secondary">
          By continuing with Google you agree to the same terms of use and{" "}
          <PrivacyLink>privacy notice</PrivacyLink>. We use your name and verified email address to
          create your account.
        </p>
      </div>
    </div>
  );
}
