import { type AdminTechnicianDto, technicianState } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { buttonVariants } from "@/components/ui/button-variants";
import { DateTimeText } from "@/components/ui/date-time-text";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { TechnicianActions } from "@/features/admin/components/technician-actions";
import {
  AvailabilityCard,
  TechnicianDetailsCard,
  UpcomingAssignmentsCard,
} from "@/features/admin/components/technician-detail-cards";
import {
  adminTechnicianPath,
  firstNameOf,
  inactiveJobsSentence,
  TECHNICIANS_PATH,
} from "@/features/admin/lib/technicians";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { isApiError } from "@/lib/api";
import { serverApiGet } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Technician" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

interface TechnicianPageProps {
  params: Promise<{ id: string }>;
}

/**
 * One technician in the business's view (IA-A10, FR-060, FR-062): how to reach them, what they work
 * on, the jobs they have coming up and how much of each of the next seven days is booked. Nothing on
 * this page is ever served to a customer, and the technician cannot sign in to see it.
 */
export default function AdminTechnicianPage({ params }: TechnicianPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TechnicianContent params={params} />
    </Suspense>
  );
}

async function TechnicianContent({ params }: TechnicianPageProps) {
  const { id } = await params;

  let technician: AdminTechnicianDto;
  let timeZone: string;
  try {
    [technician, { timeZone }] = await Promise.all([
      serverApiGet<AdminTechnicianDto>(`/admin/technicians/${encodeURIComponent(id)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    // 404 (not there) and 422 (not an id) both mean there is nothing to show.
    if (isApiError(error) && (error.status === 404 || error.status === 422)) {
      return (
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title="We couldn't find that technician"
          description="The link may be wrong. You can find everyone in the technician list."
          action={
            <Link href={TECHNICIANS_PATH} className={buttonVariants({ variant: "outline" })}>
              Back to the technicians
            </Link>
          }
        />
      );
    }
    return loadErrorState({
      error,
      title: "We couldn't load this technician",
      retryHref: adminTechnicianPath(id),
    });
  }

  return (
    <>
      <PageHeader
        title={technician.name}
        status={<StatusBadge kind="technician" status={technicianState(technician)} />}
        breadcrumbs={[{ label: "Technicians", href: TECHNICIANS_PATH }, { label: technician.name }]}
        meta={
          <span>
            Added <DateTimeText value={technician.createdAt} timeZone={timeZone} display="date" />
          </span>
        }
        actions={<TechnicianActions technician={technician} />}
      />

      {technician.isActive ? null : (
        <FormAlert tone="info">
          {firstNameOf(technician.name)} is inactive, so they are not offered for new jobs.{" "}
          {inactiveJobsSentence(technician.upcomingJobCount)} Reactivate them to give them jobs
          again.
        </FormAlert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <AvailabilityCard days={technician.availability} />
          <UpcomingAssignmentsCard technician={technician} timeZone={timeZone} />
        </div>
        <TechnicianDetailsCard technician={technician} />
      </div>
    </>
  );
}
