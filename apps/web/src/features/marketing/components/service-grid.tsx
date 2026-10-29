import type { PublicServiceDto } from "@fixflow/shared";
import type { ElementType } from "react";

import { ServiceCard } from "@/features/catalogue/components/service-card";
import { cn } from "@/lib/utils";

export interface ServiceGridProps {
  services: readonly PublicServiceDto[];
  /** The heading level of the card titles, one below the section heading. */
  headingLevel?: ElementType;
  className?: string | undefined;
}

/** Service cards in a grid of equal-height cards: one column on phones, two on tablets, three on desktop. */
export function ServiceGrid({ services, headingLevel = "h3", className }: ServiceGridProps) {
  return (
    <ul className={cn("grid gap-6 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {services.map((service) => (
        <li key={service.id} className="flex">
          <ServiceCard
            service={service}
            href={`/services/${service.slug}`}
            headingLevel={headingLevel}
            className="w-full"
          />
        </li>
      ))}
    </ul>
  );
}

export function ServiceGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <li
          key={index}
          className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
        >
          <span className="aspect-video bg-surface-muted motion-safe:animate-pulse" />
          <span className="flex flex-col gap-3 p-4">
            <span className="h-3 w-24 rounded bg-surface-muted motion-safe:animate-pulse" />
            <span className="h-5 w-48 rounded bg-surface-muted motion-safe:animate-pulse" />
            <span className="h-4 w-full rounded bg-surface-muted motion-safe:animate-pulse" />
            <span className="h-4 w-2/3 rounded bg-surface-muted motion-safe:animate-pulse" />
          </span>
        </li>
      ))}
    </ul>
  );
}
