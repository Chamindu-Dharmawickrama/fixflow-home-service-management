import { FileText, Inbox } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PermissionDenied } from "@/components/ui/permission-denied";
import { CardSkeleton, DetailSkeleton, TableSkeleton } from "@/components/ui/skeleton";

import { Section, Specimen } from "../_lib/section";

export function StatesSection() {
  return (
    <Section
      id="states"
      title="Loading, empty, error and permission states"
      description="Every screen plans for these. Loading uses skeletons shaped like the content; empty states say what is missing and offer the next step; errors say what happened and how to retry, with a reference for support; a 403 explains instead of showing a blank page."
    >
      <Specimen title="Loading: table, card and detail skeletons">
        <div className="flex flex-col gap-6">
          <TableSkeleton rows={4} columns={5} label="Loading requests" />
          <div className="grid gap-4 md:grid-cols-2">
            <CardSkeleton label="Loading quotation" />
            <CardSkeleton lines={4} label="Loading customer" />
          </div>
          <DetailSkeleton label="Loading request" />
        </div>
      </Specimen>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Empty: nothing yet, with the next step">
          <EmptyState
            icon={FileText}
            title="No quotations yet"
            description="When you review a request you can prepare a quotation for it. Sent quotations appear here with their status."
            action={
              <Button asChild>
                <Link href="/styleguide/shells/admin/requests">Review requests</Link>
              </Button>
            }
          />
        </Specimen>
        <Specimen title="Empty: nothing needs attention">
          <EmptyState
            icon={Inbox}
            title="You're all caught up"
            description="No requests are waiting for review. New requests appear here as soon as customers send them."
          />
        </Specimen>
        <Specimen title="Error: could not load, retry and support reference">
          <ErrorState
            message="We couldn't load your invoices. Your connection may have dropped, or the service may be busy."
            retryHref="/styleguide#states"
            requestId="7f3c9a1e-5b2d-4c80-9e61-2d4a8b0c3f17"
          />
        </Specimen>
        <Specimen title="Permission denied (403)">
          <PermissionDenied
            action={
              <Button variant="outline" asChild>
                <Link href="/styleguide/shells/portal">Go to your portal</Link>
              </Button>
            }
          />
        </Specimen>
      </div>
    </Section>
  );
}
