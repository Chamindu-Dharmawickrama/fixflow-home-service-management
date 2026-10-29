import { Wrench } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";

import { SERVICES_PAGE } from "../content/site-content";
import { getActiveServices } from "../lib/public-data";
import { CatalogueUnavailable } from "./catalogue-unavailable";
import { ServiceGrid } from "./service-grid";

/** How many services the homepage shows; the rest are one click away on the services page. */
export const HIGHLIGHT_COUNT = 3;

/** The first services in display order, live from the API (cached, D-87). */
export async function ServiceHighlights() {
  const result = await getActiveServices();

  if (result.status !== "ok") {
    return <CatalogueUnavailable what="our services" retryHref="/" />;
  }
  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title={SERVICES_PAGE.emptyTitle}
        description={SERVICES_PAGE.emptyDescription}
      />
    );
  }

  const highlights = result.data.slice(0, HIGHLIGHT_COUNT);
  const more = result.data.length - highlights.length;
  return (
    <div className="flex flex-col gap-8">
      <ServiceGrid services={highlights} />
      {more > 0 ? (
        <p className="text-base text-ink-secondary">
          {more === 1 ? "One more service is" : `${more} more services are`} on{" "}
          <Link
            href="/services"
            className="rounded-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            the services page
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

/** The "All services" link that sits beside the section heading. */
export function AllServicesLink() {
  return (
    <Link href="/services" className={buttonVariants({ variant: "outline", size: "md" })}>
      All services
    </Link>
  );
}
