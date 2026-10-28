import { Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PublicLayout } from "@/components/layout/public-layout";
import { Button } from "@/components/ui/button";

import { ExampleBanner } from "../../_lib/example-chrome";
import { BUSINESS_NAME } from "../../_lib/fixtures";
import { requireStyleguide } from "../../_lib/guard";
import { BusinessIdentity } from "../../_lib/public-content";
import { PUBLIC_EXAMPLE_HOME, PUBLIC_EXAMPLE_NAV } from "../../_lib/shell-nav";

export default function PublicExampleLayout({ children }: { children: ReactNode }) {
  requireStyleguide();

  return (
    <PublicLayout
      identity={<BusinessIdentity />}
      homeHref={PUBLIC_EXAMPLE_HOME}
      navItems={PUBLIC_EXAMPLE_NAV}
      banner={<ExampleBanner />}
      cta={
        <Button asChild>
          <Link href={`${PUBLIC_EXAMPLE_HOME}/services`}>Browse services</Link>
        </Button>
      }
      footer={
        <div className="grid gap-8 text-sm sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <p className="font-display text-lg font-semibold text-surface">{BUSINESS_NAME}</p>
            <p>Home comfort and repairs, done properly the first time.</p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-medium text-surface">Contact</p>
            <p className="flex items-center gap-2">
              <Mail aria-hidden="true" className="size-4 text-nav-muted" />
              hello@coolbreeze.test
            </p>
            <p className="flex items-center gap-2">
              <Phone aria-hidden="true" className="size-4 text-nav-muted" />
              (212) 555-0142
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-medium text-surface">Where we work</p>
            <p className="flex items-start gap-2">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-nav-muted" />
              Harbor City and the neighbouring towns within about 25 miles.
            </p>
          </div>
        </div>
      }
      demoNotice="FixFlow portfolio demo — fictional business and data."
    >
      {children}
    </PublicLayout>
  );
}
