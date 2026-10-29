import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthLayout } from "@/components/layout/auth-layout";
import { AuthFormSkeleton } from "@/features/auth/components/form-skeleton";
import { RegisterForm } from "@/features/auth/components/register-form";
import { SignedInRedirect } from "@/features/auth/components/signed-in-redirect";
import { LOGIN_PATH } from "@/lib/auth/paths";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a customer account to request services and follow them from first message to final invoice.",
};

export default function RegisterPage() {
  return (
    <AuthLayout
      title="Create your account"
      description="Request a service, review quotations and follow your job in one place."
      homeHref="/"
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={LOGIN_PATH}
            className="font-medium text-brand underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <Suspense fallback={<AuthFormSkeleton label="Loading the registration form" fields={4} />}>
        <SignedInRedirect />
        <RegisterForm
          googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || undefined}
          demoMode={process.env.NEXT_PUBLIC_DEMO_MODE === "true"}
        />
      </Suspense>
    </AuthLayout>
  );
}
