import { LIMITS } from "@fixflow/shared";
import { z } from "zod";

/**
 * Client-side checks for the auth forms. They exist to give feedback beside the field before a
 * round trip; the API applies the same rules again and is the authority (CLAUDE.md §7), including
 * the parts that need data the browser does not have (the common-password list).
 */

export const PASSWORD_HELP = `Use ${LIMITS.password.minLength} to ${LIMITS.password.maxLength} characters. Avoid common passwords and your email address. A few unrelated words make a strong password.`;

export const emailField = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .pipe(z.email("Enter a valid email address, like name@example.com."));

export const newPasswordField = z
  .string()
  .min(LIMITS.password.minLength, `Use at least ${LIMITS.password.minLength} characters.`)
  .max(LIMITS.password.maxLength, `Use no more than ${LIMITS.password.maxLength} characters.`);

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter your password."),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(LIMITS.personName.minLength, "Enter your full name.")
      .max(
        LIMITS.personName.maxLength,
        `Use no more than ${LIMITS.personName.maxLength} characters.`,
      ),
    email: emailField,
    password: newPasswordField,
    passwordConfirmation: z.string().min(1, "Type the password again to confirm it."),
    acceptTerms: z
      .boolean()
      .refine((value) => value, "You need to accept the terms and privacy notice."),
  })
  .refine((values) => values.password === values.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "The two passwords don't match.",
  });
export type RegisterValues = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: newPasswordField,
    passwordConfirmation: z.string().min(1, "Type the new password again to confirm it."),
  })
  .refine((values) => values.password === values.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "The two passwords don't match.",
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: newPasswordField,
    newPasswordConfirmation: z.string().min(1, "Type the new password again to confirm it."),
  })
  .refine((values) => values.newPassword === values.newPasswordConfirmation, {
    path: ["newPasswordConfirmation"],
    message: "The two passwords don't match.",
  });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export type PasswordStrength = "empty" | "too-short" | "okay" | "good";

/**
 * A deliberately simple hint, not a score: length is what matters for a password that is not on a
 * breached list (NIST SP 800-63B), so the hint reflects length only and never asks for symbols.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length === 0) return "empty";
  if (password.length < LIMITS.password.minLength) return "too-short";
  return password.length >= 16 ? "good" : "okay";
}
