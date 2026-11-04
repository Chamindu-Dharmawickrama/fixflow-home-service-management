import type { CustomerRequestJobDto } from "@fixflow/shared";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";

import { jobPath } from "../lib/jobs";

/**
 * The job made from this request, on the request's page: its reference and status and the way to
 * its schedule. A request that has no job yet shows nothing, so there is no link that leads nowhere.
 */
export function RequestJobCard({ job }: { job: CustomerRequestJobDto | null }) {
  if (job === null) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Your job</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink">
          <ReferenceText reference={job.reference} />
          <StatusBadge kind="workOrder" status={job.status} />
        </p>
        <Link
          href={jobPath(job.id)}
          className="inline-flex min-h-6 items-center gap-1.5 text-sm font-medium text-brand underline-offset-4 hover:underline"
        >
          See when it is booked and how it is going
          <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
        </Link>
      </CardContent>
    </Card>
  );
}
