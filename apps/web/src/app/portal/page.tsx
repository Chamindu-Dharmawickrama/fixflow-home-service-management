import type { Metadata } from "next";
import { Suspense } from "react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { AccountSummary } from "@/features/auth/components/sign-in-methods";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Overview" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The interim customer home (T05): a greeting and the account summary. Requests, quotations,
 * jobs and invoices are added as they are built; nothing here pretends otherwise.
 */
export default function PortalHomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PortalHomeContent />
    </Suspense>
  );
}

async function PortalHomeContent() {
  const me = await getCurrentUser();
  if (me === null) {
    return null; // The layout has already redirected a visitor without a session.
  }

  return (
    <>
      <PageHeader
        title={`Hello, ${me.user.name}`}
        description="This is your customer account. Your service requests, quotations and invoices will appear here as soon as those features are ready."
      />
      <Card>
        <CardHeader>
          <CardTitle as="h2">Your account</CardTitle>
          <CardDescription>The details we have for you.</CardDescription>
        </CardHeader>
        <div className="border-t border-border px-5 sm:px-6">
          <AccountSummary user={me.user} />
        </div>
      </Card>
    </>
  );
}
