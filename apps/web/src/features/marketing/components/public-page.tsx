import { type ReactNode, Suspense } from "react";

import { PublicLayout } from "@/components/layout/public-layout";
import { NAVIGATION } from "@/config/navigation";
import { SessionCta, SessionCtaFallback } from "@/features/auth/components/session-cta";
import { isDemoMode } from "@/lib/demo-mode";

import { DEMO_NOTICE } from "../content/site-content";
import { getSiteSettings } from "../lib/public-data";
import { BusinessIdentity, BusinessIdentityFallback } from "./business-identity";
import { DemoBanner } from "./demo-banner";
import { RequestServiceLink } from "./request-service-link";
import { SiteFooter, SiteFooterFallback } from "./site-footer";

async function DemoBannerWithName() {
  const settings = await getSiteSettings();
  return (
    <DemoBanner businessName={settings.status === "ok" ? settings.data.businessName : undefined} />
  );
}

/**
 * The frame of every public page (D-31): the business identity, navigation, the session-aware
 * account link and the "Request a service" call to action in the header; the portfolio-demo banner
 * above it in demo mode; and a footer with the business's contact details and "Powered by FixFlow".
 * The parts that read from the API sit behind their own `<Suspense>`, so the page itself can be
 * prerendered and a slow or sleeping API only delays those parts, never the page.
 */
export function PublicPage({ children }: { children: ReactNode }) {
  const demoMode = isDemoMode();

  return (
    <PublicLayout
      homeHref="/"
      navItems={NAVIGATION.public}
      navInlineFrom="lg"
      identity={
        <Suspense fallback={<BusinessIdentityFallback />}>
          <BusinessIdentity />
        </Suspense>
      }
      account={
        <Suspense fallback={<SessionCtaFallback />}>
          <SessionCta />
        </Suspense>
      }
      cta={<RequestServiceLink />}
      banner={
        demoMode ? (
          <Suspense fallback={<DemoBanner />}>
            <DemoBannerWithName />
          </Suspense>
        ) : undefined
      }
      footer={
        <Suspense fallback={<SiteFooterFallback />}>
          <SiteFooter />
        </Suspense>
      }
      demoNotice={demoMode ? DEMO_NOTICE.footer : undefined}
    >
      {children}
    </PublicLayout>
  );
}
