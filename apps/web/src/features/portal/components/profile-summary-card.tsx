import type { CustomerProfileDto } from "@fixflow/shared";
import { UserRound } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { cn } from "@/lib/utils";

import { formatAddressLines } from "../lib/format-address";

export const PROFILE_PATH = "/portal/profile";

export interface ProfileSummaryCardProps {
  profile: Pick<CustomerProfileDto, "name" | "email" | "phone" | "addresses">;
}

/** A short view of the customer's profile on the portal home, with the way to the full page. */
export function ProfileSummaryCard({ profile }: ProfileSummaryCardProps) {
  const defaultAddress = profile.addresses.find((address) => address.isDefault);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Your profile</CardTitle>
        <CardDescription>The details we have for you.</CardDescription>
      </CardHeader>
      <div className="border-t border-border px-5 sm:px-6">
        <DescriptionList>
          <DescriptionItem term="Name">{profile.name}</DescriptionItem>
          <DescriptionItem term="Email address">{profile.email}</DescriptionItem>
          <DescriptionItem term="Phone number">
            {profile.phone ?? <span className="text-ink-secondary">Not added yet</span>}
          </DescriptionItem>
          <DescriptionItem term="Default address">
            {defaultAddress === undefined ? (
              <span className="text-ink-secondary">No saved address yet</span>
            ) : (
              <>
                <span className="block font-medium">{defaultAddress.label}</span>
                {formatAddressLines(defaultAddress).map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </>
            )}
          </DescriptionItem>
        </DescriptionList>
      </div>
      <CardFooter>
        <Link href={PROFILE_PATH} className={cn(buttonVariants({ variant: "outline" }))}>
          <UserRound aria-hidden="true" />
          View and edit your profile
        </Link>
      </CardFooter>
    </Card>
  );
}
