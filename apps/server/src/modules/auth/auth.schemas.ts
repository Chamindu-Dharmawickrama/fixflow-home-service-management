import { LIMITS } from "@fixflow/shared";
import { z } from "zod";

import { normalizeEmail } from "../../lib/email-address.js";
import { passwordPolicyMessage } from "../../lib/password.js";

/**
 * Request bodies for the auth endpoints. All are strict, so an unknown key (`role`, `userId`,
 * `customerId`, …) is rejected with 422 instead of being ignored: identity and role are never
 * taken from the client (FR-014).
 */

const TERMS_MESSAGE = "You need to accept the terms and privacy notice.";
const PASSWORD_MISMATCH_MESSAGE = "The two passwords don't match.";

/** Trimmed, lower-cased and checked: the one spelling the database stores (FR-032). */
const emailField = z
  .string({ error: "Enter your email address." })
  .trim()
  .min(1, "Enter your email address.")
  .max(LIMITS.email.maxLength, "That email address is too long.")
  .transform(normalizeEmail)
  .pipe(z.email("Enter a valid email address, like name@example.com."));

/** The longest password hashed at all, so a huge body cannot make the server burn CPU on Argon2. */
const MAX_PASSWORD_INPUT = 1024;

/** A password as typed: never trimmed or altered. The policy runs in `superRefine`, with the email. */
const passwordField = (message: string) =>
  z
    .string({ error: message })
    .min(1, message)
    .max(MAX_PASSWORD_INPUT, "That password is too long.");

const nameField = z
  .string({ error: "Enter your full name." })
  .trim()
  .min(LIMITS.personName.minLength, "Enter your full name.")
  .max(LIMITS.personName.maxLength, `Use no more than ${LIMITS.personName.maxLength} characters.`);

interface PolicyIssueContext {
  addIssue(issue: { code: "custom"; path: (string | number)[]; message: string }): void;
}

function addPasswordIssues(
  ctx: PolicyIssueContext,
  field: "password" | "newPassword",
  confirmationField: "passwordConfirmation" | "newPasswordConfirmation",
  values: { password: string; confirmation: string; email: string | undefined },
): void {
  const message = passwordPolicyMessage(values.password, { email: values.email });
  if (message !== undefined) {
    ctx.addIssue({ code: "custom", path: [field], message });
  }
  if (values.password !== values.confirmation) {
    ctx.addIssue({ code: "custom", path: [confirmationField], message: PASSWORD_MISMATCH_MESSAGE });
  }
}

export const registerBodySchema = z
  .strictObject({
    name: nameField,
    email: emailField,
    password: passwordField("Choose a password."),
    passwordConfirmation: passwordField("Type the password again to confirm it."),
    acceptTerms: z.literal(true, { error: TERMS_MESSAGE }),
  })
  .superRefine((body, ctx) => {
    addPasswordIssues(ctx, "password", "passwordConfirmation", {
      password: body.password,
      confirmation: body.passwordConfirmation,
      email: body.email,
    });
  });
export type RegisterBody = z.output<typeof registerBodySchema>;

export const loginBodySchema = z.strictObject({
  // No format check: a malformed address simply fails to sign in, like any unknown one.
  email: z
    .string({ error: "Enter your email address." })
    .trim()
    .min(1, "Enter your email address.")
    .max(LIMITS.email.maxLength, "Enter your email address.")
    .transform(normalizeEmail),
  password: passwordField("Enter your password."),
});
export type LoginBody = z.output<typeof loginBodySchema>;

export const googleBodySchema = z.strictObject({
  credential: z
    .string({ error: "The Google credential is missing." })
    .min(1, "The Google credential is missing.")
    .max(8192, "The Google credential is not valid."),
});
export type GoogleBody = z.output<typeof googleBodySchema>;

export const forgotPasswordBodySchema = z.strictObject({ email: emailField });
export type ForgotPasswordBody = z.output<typeof forgotPasswordBodySchema>;

export const resetPasswordBodySchema = z
  .strictObject({
    token: z
      .string({ error: "The reset link is incomplete." })
      .min(1, "The reset link is incomplete.")
      .max(512, "The reset link is not valid."),
    password: passwordField("Choose a new password."),
    passwordConfirmation: passwordField("Type the new password again to confirm it."),
  })
  .superRefine((body, ctx) => {
    // The policy's "not your email" rule needs the account, which is known only after the token is
    // looked up; the service applies the full policy. Length and confirmation are checked here.
    const message = passwordPolicyMessage(body.password);
    if (message !== undefined) {
      ctx.addIssue({ code: "custom", path: ["password"], message });
    }
    if (body.password !== body.passwordConfirmation) {
      ctx.addIssue({
        code: "custom",
        path: ["passwordConfirmation"],
        message: PASSWORD_MISMATCH_MESSAGE,
      });
    }
  });
export type ResetPasswordBody = z.output<typeof resetPasswordBodySchema>;

export const changePasswordBodySchema = z
  .strictObject({
    currentPassword: passwordField("Enter your current password."),
    newPassword: passwordField("Choose a new password."),
    newPasswordConfirmation: passwordField("Type the new password again to confirm it."),
  })
  .superRefine((body, ctx) => {
    // As for reset: the account's email is applied by the service.
    addPasswordIssues(ctx, "newPassword", "newPasswordConfirmation", {
      password: body.newPassword,
      confirmation: body.newPasswordConfirmation,
      email: undefined,
    });
  });
export type ChangePasswordBody = z.output<typeof changePasswordBodySchema>;
