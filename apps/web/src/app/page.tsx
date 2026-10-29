import type { Metadata } from "next";
import { Suspense } from "react";

import { AreaAndContact } from "@/features/marketing/components/area-and-contact";
import { CtaBand } from "@/features/marketing/components/cta-band";
import { Faq } from "@/features/marketing/components/faq";
import { Hero } from "@/features/marketing/components/hero";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { PublicPage } from "@/features/marketing/components/public-page";
import { Section, SectionHeading } from "@/features/marketing/components/section";
import { ServiceGridSkeleton } from "@/features/marketing/components/service-grid";
import {
  AllServicesLink,
  ServiceHighlights,
} from "@/features/marketing/components/service-highlights";
import { TrustPoints } from "@/features/marketing/components/trust-points";
import { getSiteSettings } from "@/features/marketing/lib/public-data";
import { buildPageMetadata, FALLBACK_BUSINESS_NAME } from "@/features/marketing/lib/seo";
import { isDemoMode } from "@/lib/demo-mode";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const businessName =
    settings.status === "ok" ? settings.data.businessName : FALLBACK_BUSINESS_NAME;

  return buildPageMetadata({
    pageName: "Home repairs and maintenance",
    businessName,
    description: [
      settings.status === "ok" ? settings.data.tagline : null,
      "Request a service online, get a written quotation first, and follow the visit, the invoice and the payment from one account.",
    ]
      .filter(Boolean)
      .join(" "),
    path: "/",
    noIndex: isDemoMode(),
  });
}

export default function HomePage() {
  return (
    <PublicPage>
      <Hero />
      <Section tone="page" headingId="services-heading">
        <SectionHeading
          id="services-heading"
          title="What we can help with"
          description="Pick a service to see what is included and what it costs, then send a request."
          action={<AllServicesLink />}
        />
        <Suspense fallback={<ServiceGridSkeleton />}>
          <ServiceHighlights />
        </Suspense>
      </Section>
      <HowItWorks />
      <TrustPoints />
      <Faq />
      <AreaAndContact />
      <CtaBand />
    </PublicPage>
  );
}
