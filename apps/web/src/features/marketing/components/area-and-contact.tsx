import { Suspense } from "react";

import { Card } from "@/components/ui/card";

import { CONTACT, SERVICE_AREA } from "../content/site-content";
import { getSiteSettings } from "../lib/public-data";
import { CatalogueUnavailable } from "./catalogue-unavailable";
import { ContactDetails } from "./contact-details";
import { CONTENT_ICONS } from "./content-icons";
import { Section, SectionHeading } from "./section";

/** The two cards under the heading: where the business works, and how to reach it (from settings). */
async function AreaAndContactCards() {
  const settings = await getSiteSettings();
  if (settings.status !== "ok") {
    return <CatalogueUnavailable what="our contact details" retryHref="/" />;
  }
  const MapPin = CONTENT_ICONS["map-pin"];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="flex flex-col gap-3 p-6">
        <span className="flex size-11 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <MapPin aria-hidden="true" className="size-6" />
        </span>
        <h3 className="font-display text-xl font-semibold text-ink">{SERVICE_AREA.title}</h3>
        <p className="text-pretty text-base text-ink-secondary">
          {settings.data.serviceAreaDescription ?? SERVICE_AREA.fallback}
        </p>
      </Card>
      <Card className="flex flex-col gap-3 p-6">
        <h3 className="font-display text-xl font-semibold text-ink">
          {settings.data.businessName}
        </h3>
        <p className="text-base text-ink-secondary">{CONTACT.intro}</p>
        <ContactDetails settings={settings.data} className="mt-1" />
      </Card>
    </div>
  );
}

function AreaAndContactSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-6 lg:grid-cols-2">
      {[0, 1].map((card) => (
        <div
          key={card}
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-6"
        >
          <span className="size-11 rounded-lg bg-surface-muted motion-safe:animate-pulse" />
          <span className="h-6 w-48 rounded bg-surface-muted motion-safe:animate-pulse" />
          <span className="h-4 w-full rounded bg-surface-muted motion-safe:animate-pulse" />
          <span className="h-4 w-2/3 rounded bg-surface-muted motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/** "Where we work" and "Contact us", reached from the header's Contact link (`#contact`). */
export function AreaAndContact() {
  return (
    <Section id="contact" tone="surface" headingId="contact-heading">
      <SectionHeading id="contact-heading" title="Where we work and how to reach us" />
      <Suspense fallback={<AreaAndContactSkeleton />}>
        <AreaAndContactCards />
      </Suspense>
    </Section>
  );
}
