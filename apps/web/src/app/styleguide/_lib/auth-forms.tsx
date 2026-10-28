"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function ExampleNotice() {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-lg bg-success-soft p-3 text-sm font-medium text-success"
    >
      <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      The form is valid. This example does not sign anyone in or create an account.
    </p>
  );
}

const loginSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter your email address, like name@example.com.")),
  password: z.string().min(1, "Enter your password."),
});
type LoginValues = z.infer<typeof loginSchema>;

/** The sign-in form blueprint: two fields, one primary action, errors beside the fields. */
export function LoginExampleForm() {
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
    shouldFocusError: false,
  });
  const [valid, setValid] = useState(false);
  const { errors, isSubmitting, submitCount } = form.formState;

  return (
    <form
      noValidate
      aria-label="Sign in (example)"
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        setValid(false);
        void form.handleSubmit(async () => {
          await wait(600);
          setValid(true);
        })(event);
      }}
    >
      <FormErrorSummary
        errors={errors}
        labels={{ email: "Email address", password: "Password" }}
        submitCount={submitCount}
      />
      {valid ? <ExampleNotice /> : null}
      <FormField control={form.control} name="email" label="Email address" required>
        {(field) => <Input type="email" autoComplete="email" {...field} />}
      </FormField>
      <FormField control={form.control} name="password" label="Password" required>
        {(field) => <Input type="password" autoComplete="current-password" {...field} />}
      </FormField>
      <Button type="submit" size="lg" loading={isSubmitting} loadingText="Checking your details…">
        Sign in
      </Button>
    </form>
  );
}

const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name."),
    email: z.string().trim().pipe(z.email("Enter a valid email address, like name@example.com.")),
    password: z.string().min(10, "Use at least 10 characters."),
    confirmPassword: z.string(),
    acceptedTerms: z
      .boolean()
      .refine((value) => value, "You need to accept the terms and privacy notice."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords don't match.",
  });
type RegisterValues = z.infer<typeof registerSchema>;

/** The registration form blueprint: more fields, so it uses the error summary as well as inline errors. */
export function RegisterExampleForm() {
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "", acceptedTerms: false },
    mode: "onTouched",
    shouldFocusError: false,
  });
  const [valid, setValid] = useState(false);
  const { errors, isSubmitting, submitCount } = form.formState;

  return (
    <form
      noValidate
      aria-label="Create an account (example)"
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        setValid(false);
        void form.handleSubmit(async () => {
          await wait(600);
          setValid(true);
        })(event);
      }}
    >
      <FormErrorSummary
        errors={errors}
        labels={{
          name: "Full name",
          email: "Email address",
          password: "Password",
          confirmPassword: "Confirm password",
          acceptedTerms: "Terms",
        }}
        submitCount={submitCount}
      />
      {valid ? <ExampleNotice /> : null}
      <FormField control={form.control} name="name" label="Full name" required>
        {(field) => <Input autoComplete="name" {...field} />}
      </FormField>
      <FormField control={form.control} name="email" label="Email address" required>
        {(field) => <Input type="email" autoComplete="email" {...field} />}
      </FormField>
      <FormField
        control={form.control}
        name="password"
        label="Password"
        required
        description="Use at least 10 characters."
      >
        {(field) => <Input type="password" autoComplete="new-password" {...field} />}
      </FormField>
      <FormField control={form.control} name="confirmPassword" label="Confirm password" required>
        {(field) => <Input type="password" autoComplete="new-password" {...field} />}
      </FormField>
      <FormField
        control={form.control}
        name="acceptedTerms"
        layout="inline"
        label="I accept the terms and privacy notice"
        required
      >
        {({ value, onChange, ...field }) => (
          <Checkbox
            checked={value}
            onCheckedChange={(checked) => onChange(checked === true)}
            {...field}
          />
        )}
      </FormField>
      <Button type="submit" size="lg" loading={isSubmitting} loadingText="Checking your details…">
        Create account
      </Button>
    </form>
  );
}
