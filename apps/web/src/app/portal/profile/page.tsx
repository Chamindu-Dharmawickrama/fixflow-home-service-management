import type { CustomerProfileDto } from "@fixflow/shared";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { ContactDetailsForm } from "@/features/portal/components/contact-details-form";
import { PROFILE_PATH } from "@/features/portal/components/profile-summary-card";
import { ServiceAddressesSection } from "@/features/portal/components/service-addresses-section";
import { SignInSecurityCard } from "@/features/portal/components/sign-in-security-card";
import { serverApiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "Profile" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/** The customer's profile (IA-C06, FR-013): contact details, service addresses and sign-in. */
export default function PortalProfilePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProfileContent />
    </Suspense>
  );
}

async function ProfileContent() {
  let profile: CustomerProfileDto;
  try {
    profile = await serverApiGet<CustomerProfileDto>("/customers/me");
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load your profile",
      retryHref: PROFILE_PATH,
    });
  }

  return (
    <>
      <PageHeader
        title="Your profile"
        description="Your contact details, the addresses where you want work done, and how you sign in."
      />
      <ContactDetailsForm profile={profile} />
      <ServiceAddressesSection addresses={profile.addresses} />
      <SignInSecurityCard profile={profile} />
    </>
  );
}
