import {
  type CustomerProfileDto,
  preferredDateRange,
  type PublicServiceDto,
  Role,
} from "@fixflow/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { PermissionDenied } from "@/components/ui/permission-denied";
import { Skeleton } from "@/components/ui/skeleton";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { PageBanner } from "@/features/marketing/components/page-banner";
import { PublicPage } from "@/features/marketing/components/public-page";
import { Section } from "@/features/marketing/components/section";
import { getSiteSettings } from "@/features/marketing/lib/public-data";
import { REQUEST_SERVICE_PATH, SERVICE_PARAM } from "@/features/marketing/lib/request-service";
import { buildPageMetadata, FALLBACK_BUSINESS_NAME } from "@/features/marketing/lib/seo";
import { RequestForm } from "@/features/portal/components/request-form";
import { resolveServicePreselection, serviceSlugParam } from "@/features/portal/lib/request-form";
import { serverApiGet, serverApiGetPublic } from "@/lib/api/server";
import { currentPath } from "@/lib/auth/current-path";
import { loginUrl, roleHomePath } from "@/lib/auth/paths";
import { getSession, type SessionState } from "@/lib/auth/session";
import { getPublicSettings } from "@/lib/settings";
import type { SearchParamsInput } from "@/lib/url";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return buildPageMetadata({
    pageName: "Request a service",
    businessName: settings.status === "ok" ? settings.data.businessName : FALLBACK_BUSINESS_NAME,
    description:
      "Tell us what you need and when. We review every request and send a written quotation.",
    path: REQUEST_SERVICE_PATH,
    // A form for signed-in customers: nothing in it is for a search engine.
    noIndex: true,
  });
}

/**
 * Opted out of instant-navigation validation: a visitor whose session has gone stale is redirected
 * to sign-in from inside this page, and the validator renders without a session, so it would be
 * turned away before it could inspect the page. The page still reads its data behind its own
 * `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The request form (FR-020, spec §7.1, §9.1): a customers-only page on the public site's frame. A
 * visitor without a session never gets here: the proxy sends them to sign-in and back, with
 * `?service=<slug>` kept. The check below is for the cookie that is present but no longer valid.
 */
export default function RequestServicePage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <PublicPage>
      <PageBanner
        title="Request a service"
        headingId="request-service-title"
        intro="Tell us what you need and when. We review every request and send a written quotation before any work starts."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Request a service" }]}
      />
      <Section tone="page" headingId="request-service-form-heading" className="border-b-0">
        <h2 id="request-service-form-heading" className="sr-only">
          Your request
        </h2>
        <div className="mx-auto w-full max-w-3xl">
          <Suspense fallback={<RequestFormSkeleton />}>
            <RequestServiceContent searchParams={searchParams} />
          </Suspense>
        </div>
      </Section>
    </PublicPage>
  );
}

async function RequestServiceContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  let session: SessionState;
  try {
    session = await getSession();
  } catch (error) {
    // The API did not answer (a cold start, an outage): an error with a retry (T25).
    return loadErrorState({
      error,
      title: "We can't reach FixFlow right now",
      retryHref: (await currentPath()) ?? REQUEST_SERVICE_PATH,
    });
  }

  if (session.status === "signed-out") {
    redirect(loginUrl(await currentPath()));
  }
  if (session.status === "no-access") {
    return (
      <PermissionDenied
        title="This account has no access"
        message="You're signed in, but this account is not allowed to use the application. If you think that's a mistake, ask the business owner to check your access."
        action={<SignOutButton />}
      />
    );
  }
  if (session.user.role === Role.BUSINESS_ADMIN) {
    return (
      <PermissionDenied
        title="Requests are made by customers"
        message="You're signed in as the business admin. Customers send service requests, and you review them from your dashboard."
        action={
          <Link href={roleHomePath(session.user.role)} className={buttonVariants()}>
            Go to your dashboard
          </Link>
        }
      />
    );
  }

  const params = await searchParams;
  const slug = serviceSlugParam(params[SERVICE_PARAM]);

  let services: PublicServiceDto[];
  let profile: CustomerProfileDto;
  let timeZone: string;
  try {
    // The services are read fresh, not from the cached public catalogue: this page is already
    // per-visitor, and a service archived a moment ago must not be offered.
    let settings;
    [services, profile, settings] = await Promise.all([
      serverApiGetPublic<PublicServiceDto[]>("/services"),
      serverApiGet<CustomerProfileDto>("/customers/me"),
      getPublicSettings(),
    ]);
    timeZone = settings.timeZone;
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't open the request form",
      retryHref: (await currentPath()) ?? REQUEST_SERVICE_PATH,
    });
  }

  const preselection = resolveServicePreselection(slug, services);
  return (
    <RequestForm
      services={services}
      addresses={profile.addresses}
      preselectedServiceId={preselection.serviceId}
      preselectionUnavailable={preselection.unavailable}
      dateLimits={preferredDateRange(new Date(), timeZone)}
      timeZone={timeZone}
    />
  );
}

/** What the form's place shows while the session and the data load: the five sections, empty. */
function RequestFormSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading the request form</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
        >
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}
