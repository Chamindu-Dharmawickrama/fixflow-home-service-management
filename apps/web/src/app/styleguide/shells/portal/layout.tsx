import type { ReactNode } from "react";

import { PortalShell } from "@/components/layout/portal-shell";

import { ExampleBanner, ExampleNotifications, ExampleUserMenu } from "../../_lib/example-chrome";
import { requireStyleguide } from "../../_lib/guard";
import { PORTAL_EXAMPLE_HOME, PORTAL_EXAMPLE_NAV } from "../../_lib/shell-nav";

export default function PortalExampleLayout({ children }: { children: ReactNode }) {
  requireStyleguide();

  return (
    <PortalShell
      navigation={PORTAL_EXAMPLE_NAV}
      homeHref={PORTAL_EXAMPLE_HOME}
      banner={<ExampleBanner />}
      notifications={<ExampleNotifications />}
      userMenu={<ExampleUserMenu name="Morgan Reyes" role="Customer" />}
    >
      {children}
    </PortalShell>
  );
}
