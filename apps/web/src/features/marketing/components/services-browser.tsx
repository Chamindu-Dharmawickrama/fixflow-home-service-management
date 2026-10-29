import { SearchX, Wrench } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";

import { SERVICES_PAGE } from "../content/site-content";
import { getActiveServices } from "../lib/public-data";
import { categoriesOf, filterByCategory, parseCategoryParam } from "../lib/services-view";
import { CatalogueUnavailable } from "./catalogue-unavailable";
import { CategoryFilter } from "./category-filter";
import { ServiceGrid, ServiceGridSkeleton } from "./service-grid";

export interface ServicesBrowserProps {
  searchParams: Promise<{ category?: string | string[] | undefined }>;
}

/**
 * The service list: the filter chips and the cards of the chosen category (all of them by
 * default). It reads the URL's `category`, which is request data, so it streams in behind a
 * `<Suspense>` while the page's heading and the rest are already there.
 */
export async function ServicesBrowser({ searchParams }: ServicesBrowserProps) {
  const [{ category: rawCategory }, result] = await Promise.all([
    searchParams,
    getActiveServices(),
  ]);

  if (result.status !== "ok") {
    return <CatalogueUnavailable what="our services" retryHref="/services" />;
  }

  const services = result.data;
  if (services.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title={SERVICES_PAGE.emptyTitle}
        description={SERVICES_PAGE.emptyDescription}
        action={
          <Link href="/#contact" className={buttonVariants({ variant: "outline" })}>
            Contact us
          </Link>
        }
      />
    );
  }

  const selected = parseCategoryParam(rawCategory);
  const visible = filterByCategory(services, selected);
  const categories = categoriesOf(services).map((label) => ({
    label,
    count: filterByCategory(services, label).length,
  }));

  return (
    <div className="flex flex-col gap-8">
      <CategoryFilter categories={categories} total={services.length} selected={selected} />
      {visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No services in that category"
          description={`We don't list any services under "${selected ?? ""}". Choose another category, or look at everything we offer.`}
          action={
            <Link href="/services" className={buttonVariants({ variant: "outline" })}>
              Show all services
            </Link>
          }
        />
      ) : (
        <>
          <p role="status" className="text-sm text-ink-secondary">
            {selected === undefined || visible.length === services.length
              ? `Showing all ${services.length} ${services.length === 1 ? "service" : "services"}`
              : `Showing ${visible.length} of ${services.length} services in ${visible[0]?.category ?? selected}`}
          </p>
          <ServiceGrid services={visible} />
        </>
      )}
    </div>
  );
}

export function ServicesBrowserSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-2">
        {[28, 40, 36, 24].map((width) => (
          <span
            key={width}
            style={{ width: `${width * 4}px` }}
            className="h-10 rounded-full bg-surface-muted motion-safe:animate-pulse"
          />
        ))}
      </div>
      <ServiceGridSkeleton count={6} />
    </div>
  );
}
