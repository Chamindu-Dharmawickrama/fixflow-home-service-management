import { Construction } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/** A named section of a shell demo that has no designed content yet, shown with the shell's header pattern. */
export function ExampleSectionPage({
  title,
  backHref,
  backLabel,
}: {
  title: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description="This entry shows how the navigation looks with a full set of items."
      />
      <EmptyState
        icon={Construction}
        title={`${title} is not part of the design-system demo`}
        description="The screen is built in a later task. This placeholder keeps the navigation example complete without linking to anything that does not exist."
        action={
          <Button variant="outline" asChild>
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        }
      />
    </>
  );
}

export function sectionTitle(section: string): string {
  return section.charAt(0).toUpperCase() + section.slice(1);
}
