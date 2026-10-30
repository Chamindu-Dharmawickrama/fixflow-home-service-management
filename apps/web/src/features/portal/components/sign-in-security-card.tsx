import type { CustomerProfileDto } from "@fixflow/shared";

import { FormAlert } from "@/components/forms/form-alert";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";

export interface SignInSecurityCardProps {
  profile: Pick<CustomerProfileDto, "hasPassword" | "hasGoogle" | "passwordChangeLocked">;
}

/**
 * "Sign-in & security" on the customer's profile: the ways the account can be signed in to, and the
 * password form from T05 (or "Set a password" for an account that signs in with Google only). The
 * shared demo accounts cannot change their password, and the card says so instead of offering a
 * form that would be refused (D-09).
 */
export function SignInSecurityCard({ profile }: SignInSecurityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Sign-in &amp; security</CardTitle>
        <CardDescription>The ways you can sign in to your account.</CardDescription>
      </CardHeader>
      <div className="border-t border-border px-5 sm:px-6">
        <DescriptionList>
          <DescriptionItem term="Email and password">
            {profile.hasPassword ? "Set up" : "Not set up"}
          </DescriptionItem>
          <DescriptionItem term="Google">
            {profile.hasGoogle ? "Linked" : "Not linked"}
          </DescriptionItem>
        </DescriptionList>
      </div>
      <div className="flex flex-col gap-4 border-t border-border p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-ink">Password</h3>
          {profile.passwordChangeLocked ? null : (
            <p className="text-sm text-ink-secondary">
              Changing your password signs you out of your other devices.
            </p>
          )}
        </div>
        {profile.passwordChangeLocked ? (
          <FormAlert tone="info">
            Password changes are turned off in the demo. This account is shared by everyone who
            tries the demo, so its password can&apos;t be changed.
          </FormAlert>
        ) : (
          <ChangePasswordForm hasPassword={profile.hasPassword} />
        )}
      </div>
    </Card>
  );
}
