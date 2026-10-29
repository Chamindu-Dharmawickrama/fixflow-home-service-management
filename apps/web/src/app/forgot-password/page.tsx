import type { Metadata } from "next";
import Link from "next/link";

import { AuthLayout } from "@/components/layout/auth-layout";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
import { LOGIN_PATH } from "@/lib/auth/paths";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Get an email with a link to choose a new password.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the email address you signed up with and we'll send you a link to choose a new password."
      homeHref="/"
      footer={
        <>
          Remembered it?{" "}
          <Link
            href={LOGIN_PATH}
            className="font-medium text-brand underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm showOutboxNote={process.env.NODE_ENV === "development"} />
    </AuthLayout>
  );
}
