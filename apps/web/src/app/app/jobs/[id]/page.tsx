import type { AdminWorkOrderDto } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { DateTimeText } from "@/components/ui/date-time-text";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { JobActions } from "@/features/admin/components/job-actions";
import {
  JobAddressCard,
  JobCustomerCard,
  JobHistoryCard,
  JobLinksCard,
  JobScheduleCard,
  JobScopeCard,
} from "@/features/admin/components/job-detail-cards";
import { adminCustomerPath } from "@/features/admin/lib/customers";
import { adminJobPath, JOBS_PATH, SCHEDULE_PARAM } from "@/features/admin/lib/jobs";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { isApiError } from "@/lib/api";
import { serverApiGet } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";
import type { SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = { title: "Job" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

interface JobPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsInput>;
}

/**
 * One job in the business's view (IA-A07, FR-051): what it is for, when it happens and with whom,
 * the customer and the address with its access notes, the quotation it came from and its history.
 * The server decides what may be done to it (`availableActions`); this page offers exactly that.
 * Nothing on it is ever served to a customer.
 */
export default function AdminJobPage({ params, searchParams }: JobPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JobContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function JobContent({ params, searchParams }: JobPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  let job: AdminWorkOrderDto;
  let timeZone: string;
  try {
    [job, { timeZone }] = await Promise.all([
      serverApiGet<AdminWorkOrderDto>(`/admin/work-orders/${encodeURIComponent(id)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    // 404 (not there) and 422 (not an id) both mean there is nothing to show.
    if (isApiError(error) && (error.status === 404 || error.status === 422)) {
      return (
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title="We couldn't find that job"
          description="The link may be wrong, or the job may no longer exist. You can find every job in the list."
          action={
            <Link href={JOBS_PATH} className={buttonVariants({ variant: "outline" })}>
              Back to the jobs
            </Link>
          }
        />
      );
    }
    return loadErrorState({
      error,
      title: "We couldn't load this job",
      retryHref: adminJobPath(id),
    });
  }

  const asked = query[SCHEDULE_PARAM];
  const openSchedule = (Array.isArray(asked) ? asked[0] : asked) === "1";

  return (
    <>
      <PageHeader
        title={job.reference}
        status={<StatusBadge kind="workOrder" status={job.status} />}
        breadcrumbs={[{ label: "Jobs", href: JOBS_PATH }, { label: job.reference }]}
        meta={
          <>
            {/* Free text can be one unbroken word: a flex item needs `min-w-0` and `anywhere` to shrink. */}
            <span className="min-w-0 [overflow-wrap:anywhere]">{job.serviceName}</span>
            <Link
              href={adminCustomerPath(job.customer.id)}
              className="min-w-0 font-medium text-brand underline-offset-4 [overflow-wrap:anywhere] hover:underline"
            >
              {job.customer.name}
            </Link>
            <span>
              Created <DateTimeText value={job.createdAt} timeZone={timeZone} display="date" />
            </span>
          </>
        }
        actions={<JobActions job={job} timeZone={timeZone} openSchedule={openSchedule} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <JobScheduleCard job={job} timeZone={timeZone} />
          <JobScopeCard job={job} />
          <JobHistoryCard job={job} timeZone={timeZone} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <JobCustomerCard job={job} />
          <JobAddressCard job={job} />
          <JobLinksCard job={job} />
        </div>
      </div>
    </>
  );
}
