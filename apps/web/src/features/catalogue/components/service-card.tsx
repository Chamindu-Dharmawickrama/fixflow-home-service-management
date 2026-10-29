import { Clock } from "lucide-react";
import Link from "next/link";
import type { ElementType } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { formatDuration, formatServicePrice, type ServiceCardData } from "../lib/format";
import { ServiceImage } from "./service-image";

export type { ServiceCardData };

export interface ServiceCardProps {
  service: ServiceCardData;
  /** Where the card goes. Leave it out for a preview, which is not a link. */
  href?: string | undefined;
  /** The heading level for the page outline (cards in a list sit under an `h2`). */
  headingLevel?: ElementType;
  className?: string | undefined;
}

/**
 * A service as a visitor sees it in the list on the website: picture, category, name, a short
 * description, the starting price and the usual time. The admin form shows the same card as a live
 * preview, so what is typed is what will be shown; T08 uses it for the public pages.
 *
 * With `href`, the heading carries the one real link and a stretched pseudo-element makes the whole
 * card clickable, so a screen reader hears one link per card.
 */
export function ServiceCard({
  service,
  href,
  headingLevel: Heading = "h3",
  className,
}: ServiceCardProps) {
  const duration = formatDuration(service.estimatedDurationMinutes);

  return (
    <Card
      className={cn(
        "relative flex flex-col overflow-hidden",
        href && "transition-shadow duration-150 ease-standard hover:shadow-md",
        className,
      )}
    >
      <ServiceImage imageKey={service.imageKey} imageUrl={service.imageUrl} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {service.category}
        </p>
        <Heading className="font-display text-lg font-semibold text-ink">
          {href ? (
            <Link href={href} className="after:absolute after:inset-0 after:content-['']">
              {service.name}
            </Link>
          ) : (
            service.name
          )}
        </Heading>
        <p className="text-sm text-ink-secondary">{service.shortDescription}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-2 text-sm">
          <span className="font-semibold text-ink">{formatServicePrice(service)}</span>
          {duration ? (
            <span className="inline-flex items-center gap-1.5 text-ink-secondary">
              <Clock aria-hidden="true" className="size-4" />
              <span>
                <span className="sr-only">Usually takes </span>
                {duration}
              </span>
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
