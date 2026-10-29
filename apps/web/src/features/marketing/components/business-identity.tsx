import { Logo } from "@/components/ui/logo";
import { BusinessLogo } from "@/features/catalogue/components/business-logo";

import { getSiteSettings } from "../lib/public-data";

/**
 * The business in the header (D-31): its logo and name from the settings. If the settings cannot
 * be loaded the FixFlow logo stands in, so the header never shows a blank or an error.
 */
export async function BusinessIdentity() {
  const settings = await getSiteSettings();
  if (settings.status !== "ok") {
    return <Logo />;
  }
  const { businessName, logoKey, logoUrl } = settings.data;
  return <BusinessLogo businessName={businessName} logoKey={logoKey} logoUrl={logoUrl} />;
}

/** The header's identity while the settings load: a tile and a name-shaped bar, the same size. */
export function BusinessIdentityFallback() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-3">
      <span className="size-10 rounded-lg bg-surface-muted motion-safe:animate-pulse" />
      <span className="h-4 w-40 rounded bg-surface-muted motion-safe:animate-pulse" />
    </span>
  );
}
