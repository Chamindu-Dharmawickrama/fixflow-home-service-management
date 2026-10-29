import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";

import { CTA_BAND, HERO } from "../content/site-content";
import { RequestServiceLink } from "./request-service-link";
import { Section, SectionHeading } from "./section";

/** The last call to action of a page, on the brand colour. */
export function CtaBand() {
  return (
    <Section tone="brand" headingId="cta-heading" className="border-b-0">
      <div
        data-surface="dark"
        className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between"
      >
        <SectionHeading
          id="cta-heading"
          title={CTA_BAND.title}
          description={CTA_BAND.description}
          onBrand
          className="mb-0 lg:mb-0"
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <RequestServiceLink variant="outline" size="lg">
            {HERO.primaryCta}
          </RequestServiceLink>
          <Link href="/services" className={buttonVariants({ variant: "secondary", size: "lg" })}>
            {HERO.secondaryCta}
          </Link>
        </div>
      </div>
    </Section>
  );
}
