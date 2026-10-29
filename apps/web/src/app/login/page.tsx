import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthLayout } from "@/components/layout/auth-layout";
import { AuthFormSkeleton } from "@/features/auth/components/form-skeleton";
import { LoginForm } from "@/features/auth/components/login-form";
import { SignedInRedirect } from "@/features/auth/components/signed-in-redirect";
import { getDemoAccounts } from "@/features/auth/demo-accounts";
import { REGISTER_PATH } from "@/lib/auth/paths";
import type { SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to follow your service requests, or to run the business.",
};

export default function LoginPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Sign in to follow your requests, or to run the business."
      homeHref="/"
      footer={
        <>
          New here?{" "}
          <Link
            href={REGISTER_PATH}
            className="font-medium text-brand underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <Suspense fallback={<AuthFormSkeleton label="Loading the sign-in form" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </AuthLayout>
  );
}

/** Reads `?returnTo=` (a request-time read, so behind the Suspense boundary above). */
async function LoginContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const { returnTo } = await searchParams;

  return (
    <>
      <SignedInRedirect />
      <LoginForm
        returnTo={typeof returnTo === "string" ? returnTo : undefined}
        googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || undefined}
        demoAccounts={getDemoAccounts()}
      />
    </>
  );
}
