import { Role } from "@fixflow/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { type ReactNode, Suspense } from "react";

import { PortalShell } from "@/components/layout/portal-shell";
import { AreaSkeleton } from "@/features/auth/components/area-skeleton";
import { AreaUnavailablePage } from "@/features/auth/components/area-unavailable";
import { NoAccessPage } from "@/features/auth/components/no-access";
import { SessionKeepAlive } from "@/features/auth/components/session-keep-alive";
import { UserMenu } from "@/features/auth/components/user-menu";
import { DemoBanner } from "@/features/marketing/components/demo-banner";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { isServiceProblem } from "@/lib/api/errors";
import { currentPath } from "@/lib/auth/current-path";
import { loginUrl, roleHomePath } from "@/lib/auth/paths";
import { getSession, type SessionState } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo-mode";

export const metadata: Metadata = {
  title: { default: "My account", template: "%s · My account · FixFlow" },
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AreaSkeleton />}>
      <PortalGate>{children}</PortalGate>
    </Suspense>
  );
}

/**
 * Customer area (`/portal/*`). A visitor with a stale session goes to sign-in, an admin goes to
 * their dashboard (they have no customer record to show), and a customer gets the portal. The API
 * scopes every record to the signed-in customer, so this gate decides only what to render.
 */
async function PortalGate({ children }: { children: ReactNode }) {
  let session: SessionState;
  try {
    session = await getSession();
  } catch (error) {
    // The API did not answer (a cold start, an outage): say so, with a retry (T25).
    if (isServiceProblem(error)) {
      return (
        <AreaUnavailablePage
          retryHref={(await currentPath()) ?? roleHomePath(Role.CUSTOMER)}
          requestId={error.requestId}
        />
      );
    }
    throw error;
  }

  if (session.status === "signed-out") {
    redirect(loginUrl(await currentPath()));
  }
  if (session.status === "no-access") {
    return <NoAccessPage />;
  }
  if (session.user.role === Role.BUSINESS_ADMIN) {
    redirect(roleHomePath(session.user.role));
  }

  const { user } = session;
  return (
    <PortalShell
      homeHref={roleHomePath(user.role)}
      banner={isDemoMode() ? <DemoBanner /> : undefined}
      notifications={<NotificationBell />}
      userMenu={
        <UserMenu
          name={user.name}
          avatarUrl={user.avatarUrl}
          roleLabel="Customer"
          accountHref="/portal/profile"
        />
      }
    >
      <SessionKeepAlive />
      {children}
    </PortalShell>
  );
}
