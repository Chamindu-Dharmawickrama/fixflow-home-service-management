import type { Metadata } from "next";
import Link from "next/link";

import { AuthLayout } from "@/components/layout/auth-layout";

import { LoginExampleForm } from "../../_lib/auth-forms";
import { ExampleBanner } from "../../_lib/example-chrome";
import { requireStyleguide } from "../../_lib/guard";
import { AUTH_EXAMPLE_HOME } from "../../_lib/shell-nav";

export const metadata: Metadata = { title: "Sign in" };

export default function AuthLoginExample() {
  requireStyleguide();

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Sign in to follow your requests, quotations and invoices."
      homeHref="/styleguide"
      banner={<ExampleBanner />}
      footer={
        <p>
          New here?{" "}
          <Link
            href={`${AUTH_EXAMPLE_HOME}/register`}
            className="font-medium text-brand underline underline-offset-4 hover:no-underline"
          >
            Create an account
          </Link>
        </p>
      }
    >
      <LoginExampleForm />
    </AuthLayout>
  );
}
