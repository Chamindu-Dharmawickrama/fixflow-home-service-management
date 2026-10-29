import type { Metadata } from "next";
import { Suspense } from "react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/** The admin's own account: who they are, how they sign in, and a way to change their password. */
export default function AdminAccountPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AccountContent />
    </Suspense>
  );
}

async function AccountContent() {
  const me = await getCurrentUser();
  if (me === null) {
    return null; // The layout has already redirected a visitor without a session.
  }
  const { user } = me;

  return (
    <>
      <PageHeader title="Your account" description="Your details and how you sign in." />
      <Card>
        <CardHeader>
          <CardTitle as="h2">Profile</CardTitle>
        </CardHeader>
        <div className="border-t border-border px-5 sm:px-6">
          <DescriptionList>
            <DescriptionItem term="Name">{user.name}</DescriptionItem>
            <DescriptionItem term="Email address">{user.email}</DescriptionItem>
            <DescriptionItem term="Role">Business admin</DescriptionItem>
          </DescriptionList>
        </div>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Sign-in methods</CardTitle>
          <CardDescription>The ways you can sign in to this account.</CardDescription>
        </CardHeader>
        <div className="border-t border-border px-5 sm:px-6">
          <DescriptionList>
            <DescriptionItem term="Email and password">
              {user.hasPassword ? "Set up" : "Not set up"}
            </DescriptionItem>
            <DescriptionItem term="Google">
              {user.hasGoogle ? "Linked" : "Not linked"}
            </DescriptionItem>
          </DescriptionList>
        </div>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Password</CardTitle>
          <CardDescription>
            Changing your password signs you out of your other devices.
          </CardDescription>
        </CardHeader>
        <div className="border-t border-border p-5 sm:p-6">
          <ChangePasswordForm hasPassword={user.hasPassword} />
        </div>
      </Card>
    </>
  );
}
