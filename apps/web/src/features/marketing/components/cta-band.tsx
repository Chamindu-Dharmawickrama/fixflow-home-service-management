import Image from "next/image";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { SERVICE_PHOTOS } from "@/features/catalogue/lib/bundled-assets";

import { CTA_BAND, HERO } from "../content/site-content";
import { RequestServiceLink } from "./request-service-link";
import { SectionHeading } from "./section";

/**
 * The last call to action of a page: a photograph of tools under a deep-navy wash, so the text
 * and buttons keep a strong contrast wherever the picture is bright. The picture is decoration
 * only (`alt=""`); the heading and the two links carry the meaning.
 */
export function CtaBand() {
  return (
    <section
      aria-labelledby="cta-heading"
      data-surface="dark"
      className="relative isolate overflow-hidden bg-brand-deep"
    >
      <Image
        src={SERVICE_PHOTOS["general-repair"].src}
        alt=""
        fill
        sizes="100vw"
        className="-z-20 object-cover"
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-brand-deep/75" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-linear-to-r from-brand-deep via-brand-deep/60 to-transparent"
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-20">
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
    </section>
  );
}
