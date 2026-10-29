import { Suspense } from "react";

import { PublicLayout } from "@/components/layout/public-layout";
import { SessionCta, SessionCtaFallback } from "@/features/auth/components/session-cta";

// Placeholder until the public website (T08) replaces it. It already carries the session-aware
// header ("Sign in" / "Dashboard" / "My account") that the real public pages will reuse.
export default function HomePage() {
  return (
    <PublicLayout
      homeHref="/"
      cta={
        <Suspense fallback={<SessionCtaFallback />}>
          <SessionCta />
        </Suspense>
      }
    >
      <section className="mx-auto flex min-h-[60dvh] max-w-2xl flex-col justify-center gap-6 px-6 py-16">
        <h1 className="font-display text-4xl font-semibold text-ink">
          Home-service management for a small service business
        </h1>
        <p className="text-lg text-ink-secondary">
          Requests, quotations, scheduling and invoices in one calm place. The application is under
          construction.
        </p>
      </section>
    </PublicLayout>
  );
}
