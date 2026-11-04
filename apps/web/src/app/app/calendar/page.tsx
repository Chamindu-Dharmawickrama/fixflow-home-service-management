import {
  type AdminTechnicianListResponse,
  type CalendarDto,
  dateOnlyInTimeZone,
} from "@fixflow/shared";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { CalendarScreen } from "@/features/admin/calendar/components/calendar-screen";
import { CalendarSkeleton } from "@/features/admin/calendar/components/calendar-states";
import {
  CALENDAR_PATH,
  calendarApiRoute,
  parseCalendarQuery,
} from "@/features/admin/calendar/lib/calendar-url";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { serverApiGet, serverApiGetEnvelope } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";
import { buildHref, type SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = { title: "Calendar" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The scheduling calendar (IA-A06, FR-052): the week's visits by day and hour, a day, or an agenda
 * list, for everyone or one technician, with the jobs that are still waiting for a time. The view, the
 * date and the technician live in the address (D-40). One request fetches the week for every view of
 * it; the page is rendered again, and the week fetched again, only when the week or the filter changes.
 */
export default function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <>
      <PageHeader
        title="Calendar"
        description="Who is where, and when. Open a visit to see it, or to move it to another time."
      />
      <Suspense fallback={<CalendarSkeleton />}>
        <CalendarContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function CalendarContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const params = await searchParams;
  const retryHref = buildHref(CALENDAR_PATH, params);

  let technicians: AdminTechnicianListResponse;
  let timeZone: string;
  try {
    [technicians, { timeZone }] = await Promise.all([
      // Everyone, whatever their state: a visit can still belong to a technician who is now inactive.
      serverApiGetEnvelope<AdminTechnicianListResponse>(
        "/admin/technicians?active=all&pageSize=100&sort=name&order=asc",
      ),
      getPublicSettings(),
    ]);
  } catch (error) {
    return loadErrorState({ error, title: "We couldn't load the calendar", retryHref });
  }

  // "Today" is the business's day, not the server's or the browser's (BR-17).
  const today = dateOnlyInTimeZone(new Date(), timeZone);
  const parsed = parseCalendarQuery(params, today);
  // A technician who is not in the list (a stale link) means everyone, rather than an empty calendar.
  const query = {
    ...parsed,
    technicianId: technicians.data.some((technician) => technician.id === parsed.technicianId)
      ? parsed.technicianId
      : null,
  };

  let data: CalendarDto;
  try {
    data = await serverApiGet<CalendarDto>(calendarApiRoute(query.date, query.technicianId));
  } catch (error) {
    return loadErrorState({ error, title: "We couldn't load the calendar", retryHref });
  }

  return (
    <CalendarScreen
      data={data}
      technicians={technicians.data.map(({ id, name, calendarColor, isActive }) => ({
        id,
        name,
        calendarColor,
        isActive,
      }))}
      query={query}
      today={today}
    />
  );
}
