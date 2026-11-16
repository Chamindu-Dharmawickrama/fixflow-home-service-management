import { Role } from "@fixflow/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { type ReactNode, Suspense } from "react";

import { AdminShell } from "@/components/layout/admin-shell";
import { PortalShell } from "@/components/layout/portal-shell";
import { buttonVariants } from "@/components/ui/button-variants";
import { PermissionDenied } from "@/components/ui/permission-denied";
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
  title: { default: "Admin", template: "%s · Admin · FixFlow" },
  // The business application is not for search engines.
  robots: { index: false, follow: false },
};

export default function AdminAreaLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AreaSkeleton />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

/**
 * Admin-only area (`/app/*`). The proxy already sent visitors without a session cookie to sign-in;
 * this asks the API who the visitor is and decides what to render. The API still enforces role and
 * allowlist on every call, so this gate is about what to show, never the only control (CLAUDE.md §7).
 */
async function AdminGate({ children }: { children: ReactNode }) {
  let session: SessionState;
  try {
    session = await getSession();
  } catch (error) {
    // The API did not answer (a cold start, an outage): say so, with a retry, instead of the generic
    // error page (T25).
    if (isServiceProblem(error)) {
      return (
        <AreaUnavailablePage
          retryHref={(await currentPath()) ?? roleHomePath(Role.BUSINESS_ADMIN)}
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

  const { user } = session;
  /** The portfolio-demo notice, in the signed-in areas too (T24, D-31). */
  const banner = isDemoMode() ? <DemoBanner /> : undefined;
  const userMenu = (
    <UserMenu
      name={user.name}
      avatarUrl={user.avatarUrl}
      roleLabel={user.role === Role.BUSINESS_ADMIN ? "Business admin" : "Customer"}
      accountHref={user.role === Role.BUSINESS_ADMIN ? "/app/account" : undefined}
    />
  );

  if (user.role !== Role.BUSINESS_ADMIN) {
    // A customer who reached an admin URL: no admin navigation, a clear way back to their own area.
    return (
      <PortalShell
        homeHref={roleHomePath(user.role)}
        notifications={<NotificationBell />}
        userMenu={userMenu}
        banner={banner}
      >
        <PermissionDenied
          headingLevel="h1"
          title="This area is for the business team"
          message="Your account is a customer account, so it can't open the business dashboard. Your requests, quotations and invoices are in your own account."
          action={
            <Link href={roleHomePath(user.role)} className={buttonVariants({ variant: "primary" })}>
              Go to my account
            </Link>
          }
        />
      </PortalShell>
    );
  }

  return (
    <AdminShell
      homeHref={roleHomePath(user.role)}
      context="Business administration"
      notifications={<NotificationBell />}
      userMenu={userMenu}
      banner={banner}
    >
      <SessionKeepAlive />
      {children}
    </AdminShell>
  );
}
