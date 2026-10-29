import { type AdminSettingsDto, listSupportedTimeZones } from "@fixflow/shared";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { BusinessSettingsForm } from "@/features/catalogue/components/business-settings-form";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { serverApiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "Business settings" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

const PAGE_PATH = "/app/settings/business";

/** Business identity, contact details, region and tax, and the defaults for new documents (FR-100). */
export default function BusinessSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BusinessSettingsContent />
    </Suspense>
  );
}

async function BusinessSettingsContent() {
  let settings: AdminSettingsDto;
  try {
    settings = await serverApiGet<AdminSettingsDto>("/admin/settings");
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load the business settings",
      retryHref: PAGE_PATH,
    });
  }

  return (
    <>
      <PageHeader
        title="Business settings"
        description="Your business details, region and tax, and the starting point for new quotations and invoices."
        breadcrumbs={[{ label: "Settings" }, { label: "Business" }]}
      />
      <BusinessSettingsForm settings={settings} timeZones={listSupportedTimeZones()} />
    </>
  );
}
