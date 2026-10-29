import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthLayout } from "@/components/layout/auth-layout";
import { AuthFormSkeleton } from "@/features/auth/components/form-skeleton";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import type { SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = {
  title: "Choose a new password",
  // The link carries a secret token: keep it out of search engines and out of Referer headers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <AuthLayout
      title="Choose a new password"
      description="Pick a password you haven't used elsewhere. You'll be signed out everywhere and asked to sign in again."
      homeHref="/"
    >
      <Suspense fallback={<AuthFormSkeleton label="Checking your reset link" />}>
        <ResetContent searchParams={searchParams} />
      </Suspense>
    </AuthLayout>
  );
}

async function ResetContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const { token } = await searchParams;
  return <ResetPasswordForm token={typeof token === "string" ? token : undefined} />;
}
