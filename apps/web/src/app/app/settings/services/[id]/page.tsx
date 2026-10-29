import type { AdminServiceDto } from "@fixflow/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { ServiceForm } from "@/features/catalogue/components/service-form";
import { type CatalogueContext, loadCatalogueContext } from "@/features/catalogue/lib/load-context";
import { isApiError } from "@/lib/api";
import { serverApiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "Edit service" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One service: edit its details, preview it, publish it, archive it (FR-101). */
export default function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditServiceContent params={params} />
    </Suspense>
  );
}

async function EditServiceContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) {
    notFound();
  }

  let service: AdminServiceDto;
  let context: CatalogueContext;
  try {
    [service, context] = await Promise.all([
      serverApiGet<AdminServiceDto>(`/admin/services/${id}`),
      loadCatalogueContext(),
    ]);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    return loadErrorState({
      error,
      title: "We couldn't load this service",
      retryHref: `/app/settings/services/${id}`,
    });
  }

  return (
    <>
      <PageHeader
        title={service.name}
        status={<StatusBadge kind="service" status={service.status} />}
        description="Change how the service reads on the website, or publish, unpublish and archive it."
        breadcrumbs={[
          { label: "Settings" },
          { label: "Services", href: "/app/settings/services" },
          { label: service.name },
        ]}
      />
      <ServiceForm mode="edit" service={service} {...context} />
    </>
  );
}
