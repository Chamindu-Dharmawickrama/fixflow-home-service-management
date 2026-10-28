import type { Metadata } from "next";
import Link from "next/link";

import { AuthLayout } from "@/components/layout/auth-layout";

import { RegisterExampleForm } from "../../../_lib/auth-forms";
import { ExampleBanner } from "../../../_lib/example-chrome";
import { requireStyleguide } from "../../../_lib/guard";
import { AUTH_EXAMPLE_HOME } from "../../../_lib/shell-nav";

export const metadata: Metadata = { title: "Create an account" };

export default function AuthRegisterExample() {
  requireStyleguide();

  return (
    <AuthLayout
      title="Create your account"
      description="An account lets you request services and track them in one place."
      homeHref="/styleguide"
      banner={<ExampleBanner />}
      footer={
        <p>
          Already have an account?{" "}
          <Link
            href={AUTH_EXAMPLE_HOME}
            className="font-medium text-brand underline underline-offset-4 hover:no-underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <RegisterExampleForm />
    </AuthLayout>
  );
}
