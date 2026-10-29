import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBanner } from "@/features/marketing/components/page-banner";
import {
  PrivacyContent,
  PrivacyContentSkeleton,
} from "@/features/marketing/components/privacy-content";
import { PublicPage } from "@/features/marketing/components/public-page";
import { getSiteSettings } from "@/features/marketing/lib/public-data";
import { buildPageMetadata, FALLBACK_BUSINESS_NAME } from "@/features/marketing/lib/seo";
import { isDemoMode } from "@/lib/demo-mode";

function privacyTitle(): string {
  return isDemoMode() ? "Privacy and demo notice" : "Privacy notice";
}

const INTRO =
  "What this website and its application store about you, why, and who can see it. Written in plain language.";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return buildPageMetadata({
    pageName: privacyTitle(),
    businessName: settings.status === "ok" ? settings.data.businessName : FALLBACK_BUSINESS_NAME,
    description: INTRO,
    path: "/privacy",
    noIndex: isDemoMode(),
  });
}

export default function PrivacyPage() {
  return (
    <PublicPage>
      <PageBanner
        title={privacyTitle()}
        headingId="privacy-title"
        intro={INTRO}
        breadcrumbs={[{ label: "Home", href: "/" }, { label: privacyTitle() }]}
      />
      <Suspense fallback={<PrivacyContentSkeleton />}>
        <PrivacyContent />
      </Suspense>
    </PublicPage>
  );
}
