import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { ServiceForm } from "@/features/catalogue/components/service-form";
import { type CatalogueContext, loadCatalogueContext } from "@/features/catalogue/lib/load-context";

export const metadata: Metadata = { title: "New service" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

const PAGE_PATH = "/app/settings/services/new";

/** Add a service to the catalogue (FR-101). It starts unpublished. */
export default function NewServicePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewServiceContent />
    </Suspense>
  );
}

async function NewServiceContent() {
  let context: CatalogueContext;
  try {
    context = await loadCatalogueContext();
  } catch (error) {
    return loadErrorState({ error, title: "We couldn't open the form", retryHref: PAGE_PATH });
  }

  return (
    <>
      <PageHeader
        title="New service"
        description="Describe the service the way a customer would look for it. It stays off the website until you publish it."
        breadcrumbs={[
          { label: "Settings" },
          { label: "Services", href: "/app/settings/services" },
          { label: "New service" },
        ]}
      />
      <ServiceForm mode="create" {...context} />
    </>
  );
}
