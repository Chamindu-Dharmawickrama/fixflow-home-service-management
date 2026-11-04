import type { CustomerWorkOrderDto } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import {
  JobCompletionCard,
  JobHistoryCard,
  JobLinksCard,
  JobStatusCard,
  JobVisitCard,
} from "@/features/portal/components/job-details";
import { jobPath, JOBS_PATH } from "@/features/portal/lib/jobs";
import { isApiError } from "@/lib/api";
import { serverApiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "Job" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

interface JobPageProps {
  params: Promise<{ id: string }>;
}

/**
 * One job in the customer's words (IA-C04, FR-056): where things stand, the visit (what, when, where
 * and who), what was done once it is finished, the history, and the request and quotation it came
 * from. The API shows a customer only their own jobs, so someone else's id looks exactly like one
 * that does not exist; and it shows no internal note, no cancellation reason and no technician
 * contact details to anyone.
 */
export default function PortalJobPage({ params }: JobPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JobContent params={params} />
    </Suspense>
  );
}

async function JobContent({ params }: JobPageProps) {
  const { id } = await params;

  let job: CustomerWorkOrderDto;
  try {
    job = await serverApiGet<CustomerWorkOrderDto>(`/work-orders/${encodeURIComponent(id)}`);
  } catch (error) {
    // 404 (not there, or not yours) and 422 (not an id) both mean there is nothing to show; the
    // answer is the same for both so an id cannot be probed.
    if (isApiError(error) && (error.status === 404 || error.status === 422)) {
      return (
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title="We couldn't find that job"
          description="The link may be wrong, or the job may not be on your account. You can see every job we have set up for you in your list."
          action={
            <Link href={JOBS_PATH} className={buttonVariants({ variant: "outline" })}>
              View your jobs
            </Link>
          }
        />
      );
    }
    return loadErrorState({
      error,
      title: "We couldn't load this job",
      retryHref: jobPath(id),
    });
  }

  return (
    <>
      <PageHeader
        title={job.reference}
        status={<StatusBadge kind="workOrder" status={job.status} />}
        breadcrumbs={[{ label: "Jobs", href: JOBS_PATH }, { label: job.reference }]}
        meta={<span className="min-w-0 [overflow-wrap:anywhere]">{job.serviceName}</span>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <JobStatusCard job={job} />
          <JobVisitCard job={job} />
          <JobCompletionCard job={job} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <JobHistoryCard job={job} />
          <JobLinksCard job={job} />
        </div>
      </div>
    </>
  );
}
