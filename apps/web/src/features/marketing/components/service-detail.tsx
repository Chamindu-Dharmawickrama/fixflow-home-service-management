import type { PublicServiceDto } from "@fixflow/shared";
import { Check, Clock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ServiceImage } from "@/features/catalogue/components/service-image";
import { formatDuration } from "@/features/catalogue/lib/format";

import { HERO } from "../content/site-content";
import type { Loaded } from "../lib/public-data";
import { pricingNote, relatedServices, splitParagraphs } from "../lib/services-view";
import { CatalogueUnavailable } from "./catalogue-unavailable";
import { PageBanner } from "./page-banner";
import { RequestServiceLink } from "./request-service-link";
import { Section, SectionHeading } from "./section";
import { ServiceGrid } from "./service-grid";

function ServiceAside({ service }: { service: PublicServiceDto }) {
  const duration = formatDuration(service.estimatedDurationMinutes);

  return (
    <Card className="flex flex-col gap-5 p-6 lg:sticky lg:top-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Pricing</p>
        <p className="mt-1 text-pretty font-display text-xl font-semibold text-ink">
          {pricingNote(service)}
        </p>
      </div>
      {duration ? (
        <p className="flex items-center gap-2 text-base text-ink-secondary">
          <Clock aria-hidden="true" className="size-5 shrink-0 text-accent" />
          <span>
            Usually takes <span className="font-medium text-ink">{duration}</span>
          </span>
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <RequestServiceLink serviceSlug={service.slug} size="lg" className="w-full">
          Request this service
        </RequestServiceLink>
        <p className="text-sm text-ink-secondary">{HERO.assurance}</p>
        <p className="text-sm text-ink-secondary">{HERO.accountHint}</p>
      </div>
      <p className="border-t border-border pt-4 text-sm text-ink-secondary">
        Not sure this is the right service?{" "}
        <Link
          href="/#contact"
          className="rounded-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
        >
          Ask us before you request
        </Link>
        .
      </p>
    </Card>
  );
}

export interface ServiceDetailProps {
  slug: string;
  /** The list of active services, read by the page (which has already answered 404 for a slug not in it). */
  result: Loaded<PublicServiceDto[]>;
}

/**
 * One service in full, found by its slug in the list of active services. If the API is unreachable
 * it shows a message with a retry instead (a 404 would be wrong: the service may well exist).
 */
export function ServiceDetail({ slug, result }: ServiceDetailProps) {
  if (result.status !== "ok") {
    return (
      <>
        <PageBanner
          title="This service"
          headingId="service-title"
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "Services", href: "/services" },
            { label: "Service details" },
          ]}
        />
        <Section tone="page" headingId="service-unavailable-heading" className="border-b-0">
          <h2 id="service-unavailable-heading" className="sr-only">
            Service details
          </h2>
          <CatalogueUnavailable what="this service" retryHref={`/services/${slug}`} />
        </Section>
      </>
    );
  }

  const service = result.data.find((candidate) => candidate.slug === slug);
  if (!service) {
    notFound();
  }

  const description = splitParagraphs(service.fullDescription);
  const related = relatedServices(result.data, service);

  return (
    <>
      <PageBanner
        title={service.name}
        headingId="service-title"
        intro={service.shortDescription}
        eyebrow={<Badge tone="brand">{service.category}</Badge>}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Services", href: "/services" },
          { label: service.name },
        ]}
      />

      <Section
        tone="page"
        headingId="service-about-heading"
        className={related.length > 0 ? "" : "border-b-0"}
      >
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-14">
          <div className="flex flex-col gap-10">
            <ServiceImage
              imageKey={service.imageKey}
              imageUrl={service.imageUrl}
              sizes="(min-width: 1280px) 800px, (min-width: 1024px) 60vw, 100vw"
              className="aspect-[16/8] overflow-hidden rounded-xl sm:aspect-[21/9]"
            />
            <div className="flex max-w-3xl flex-col gap-3">
              <h2
                id="service-about-heading"
                className="font-display text-2xl font-semibold text-ink"
              >
                About this service
              </h2>
              {description.map((paragraph) => (
                <p key={paragraph} className="text-pretty text-lg text-ink-secondary">
                  {paragraph}
                </p>
              ))}
            </div>
            {service.inclusions.length > 0 ? (
              <div className="flex max-w-3xl flex-col gap-4">
                <h2 className="font-display text-2xl font-semibold text-ink">
                  What&apos;s included
                </h2>
                <ul className="flex flex-col gap-3">
                  {service.inclusions.map((item) => (
                    <li key={item} className="flex gap-3 text-base text-ink">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                        <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <ServiceAside service={service} />
        </div>
      </Section>

      {related.length > 0 ? (
        <Section tone="surface" headingId="related-heading" className="border-b-0">
          <SectionHeading
            id="related-heading"
            title="Other services you may need"
            description="Each one is quoted in writing before any work starts."
          />
          <ServiceGrid services={related} />
        </Section>
      ) : null}
    </>
  );
}
