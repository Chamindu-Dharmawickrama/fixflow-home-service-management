import type { ReactNode } from "react";

import { AdminShell } from "@/components/layout/admin-shell";

import { ExampleBanner, ExampleNotifications, ExampleUserMenu } from "../../_lib/example-chrome";
import { BUSINESS_NAME } from "../../_lib/fixtures";
import { requireStyleguide } from "../../_lib/guard";
import { ADMIN_EXAMPLE_HOME, ADMIN_EXAMPLE_NAV } from "../../_lib/shell-nav";

export default function AdminExampleLayout({ children }: { children: ReactNode }) {
  requireStyleguide();

  return (
    <AdminShell
      navigation={ADMIN_EXAMPLE_NAV}
      homeHref={ADMIN_EXAMPLE_HOME}
      banner={<ExampleBanner />}
      context={
        <span>
          <span className="font-medium text-ink">{BUSINESS_NAME}</span> · Business dashboard
        </span>
      }
      notifications={<ExampleNotifications />}
      userMenu={<ExampleUserMenu name="Alex Morgan" role="Business admin" />}
      sidebarFooter={
        <p>
          Signed in as <span className="font-medium text-surface">Alex Morgan</span>
          <span className="block text-xs text-nav-muted">Demo account</span>
        </p>
      }
    >
      {children}
    </AdminShell>
  );
}
