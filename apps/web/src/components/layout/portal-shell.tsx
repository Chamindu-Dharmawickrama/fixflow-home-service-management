import Link from "next/link";
import type { ReactNode } from "react";

import { MobileNav } from "@/components/layout/mobile-nav";
import { NavList } from "@/components/layout/nav-list";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Logo } from "@/components/ui/logo";
import { NAVIGATION } from "@/config/navigation";
import type { NavItem } from "@/lib/navigation";

export interface PortalShellProps {
  /** Defaults to the portal entries in `config/navigation.ts`. */
  navigation?: readonly NavItem[] | undefined;
  /** Where the logo links to (the portal overview). Without it the logo is not a link. */
  homeHref?: string | undefined;
  /** The notification bell (T06). */
  notifications?: ReactNode;
  /** The signed-in customer's menu (T05). */
  userMenu?: ReactNode;
  /** A slim banner above everything (the portfolio-demo notice, D-31). */
  banner?: ReactNode;
  children: ReactNode;
}

/**
 * The customer portal's frame: a light top bar with the navigation inline from `lg` (1024 px) and
 * in a drawer below it, and a comfortable single column of cards underneath. It deliberately
 * looks calmer than the admin shell: customers come to check on one job, not to run a business.
 */
export function PortalShell({
  navigation = NAVIGATION.portal,
  homeHref,
  notifications,
  userMenu,
  banner,
  children,
}: PortalShellProps) {
  const groups = [{ items: navigation }];
  const brand = homeHref ? (
    <Link href={homeHref} className="inline-flex rounded-lg">
      <Logo />
    </Link>
  ) : (
    <Logo />
  );
  const darkBrand = homeHref ? (
    <Link href={homeHref} className="inline-flex rounded-lg">
      <Logo variant="dark" />
    </Link>
  ) : (
    <Logo variant="dark" />
  );

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      {banner === undefined ? null : <div className="print:hidden">{banner}</div>}
      <header className="sticky top-0 z-30 border-b border-border bg-surface print:hidden">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-2 px-4 sm:px-6 lg:px-8">
          {navigation.length > 0 ? (
            <div className="lg:hidden">
              <MobileNav groups={groups} brand={darkBrand} title="Portal navigation" />
            </div>
          ) : null}
          <div className="mr-auto lg:mr-4">{brand}</div>
          {navigation.length > 0 ? (
            <nav aria-label="Portal" className="hidden flex-1 lg:block">
              <NavList groups={groups} variant="top" />
            </nav>
          ) : null}
          <div className="flex items-center gap-1">
            {notifications}
            {userMenu}
          </div>
        </div>
      </header>

      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8 print:p-0"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}
