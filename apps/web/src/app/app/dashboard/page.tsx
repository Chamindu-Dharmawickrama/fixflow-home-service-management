import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { QUEUE_PATH } from "@/features/admin/lib/requests-queue";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

const COMING = [
  ["Quotations", "Build, send and track quotations until the customer decides."],
  ["Jobs and schedule", "Turn accepted quotations into jobs and plan them on a calendar."],
  ["Invoices and payments", "Invoice completed jobs and record the payments you receive."],
] as const;

/**
 * The interim admin home (T05): a real welcome and an honest description of what is coming. It
 * shows no figures, because there is no data to show yet; the dashboard proper replaces it later.
 */
export default function DashboardPage() {
  // The welcome needs the signed-in user, a request-time read, so it streams in behind a boundary
  // of its own: a navigation between pages of this area re-renders only the page, and the
  // boundary in the layout is out of its reach.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  const me = await getCurrentUser();

  return (
    <>
      <PageHeader
        title={`Welcome, ${me?.user.name ?? "there"}`}
        description="This is your business dashboard. It is being built feature by feature, and each area below will appear in the sidebar as soon as it is ready."
      />
      <Card>
        <CardHeader>
          <CardTitle as="h2">Service requests</CardTitle>
          <CardDescription>
            Review what customers have sent, add notes and decide what happens next.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={QUEUE_PATH} className={buttonVariants({ variant: "primary" })}>
            Open the request queue
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Still to come</CardTitle>
          <CardDescription>
            Nothing here is live yet. These are the areas that will join the sidebar.
          </CardDescription>
        </CardHeader>
        <ul className="divide-y divide-border border-t border-border">
          {COMING.map(([title, text]) => (
            <li key={title} className="flex flex-col gap-0.5 px-5 py-3 sm:px-6">
              <span className="font-medium text-ink">{title}</span>
              <span className="text-sm text-ink-secondary">{text}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
