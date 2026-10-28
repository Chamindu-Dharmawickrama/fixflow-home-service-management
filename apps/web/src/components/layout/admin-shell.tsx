import Link from "next/link";
import type { ReactNode } from "react";

import { MobileNav } from "@/components/layout/mobile-nav";
import { NavList } from "@/components/layout/nav-list";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Logo } from "@/components/ui/logo";
import { NAVIGATION } from "@/config/navigation";
import type { NavGroup } from "@/lib/navigation";

export interface AdminShellProps {
  /** Defaults to the admin entries in `config/navigation.ts`. */
  navigation?: readonly NavGroup[] | undefined;
  /** Where the logo links to (the dashboard). Without it the logo is not a link. */
  homeHref?: string | undefined;
  /** What the person is looking at: the business name and, in demo mode, the environment. */
  context?: ReactNode;
  /** The notification bell (T06). */
  notifications?: ReactNode;
  /** The signed-in user's menu (T05). */
  userMenu?: ReactNode;
  /** Pinned at the foot of the sidebar and the mobile drawer. */
  sidebarFooter?: ReactNode;
  /**
   * A slim banner above the top bar, inside the content column so the sidebar always spans the
   * full viewport height (the portfolio-demo notice, D-31).
   */
  banner?: ReactNode;
  children: ReactNode;
}

/**
 * The business application's frame. From `lg` (1024 px) a fixed deep-navy sidebar holds the
 * navigation; below it the same navigation lives in a drawer opened from the top bar. The top bar
 * carries the page context, the notification bell and the user menu. Content gets a readable
 * maximum width, and the main landmark is the target of the skip link.
 */
export function AdminShell({
  navigation = NAVIGATION.admin,
  homeHref,
  context,
  notifications,
  userMenu,
  sidebarFooter,
  banner,
  children,
}: AdminShellProps) {
  const brand = homeHref ? (
    <Link href={homeHref} className="inline-flex rounded-lg">
      <Logo variant="dark" />
    </Link>
  ) : (
    <Logo variant="dark" />
  );

  return (
    <div className="flex min-h-dvh bg-page">
      <div className="flex min-w-0 flex-1">
        <aside
          data-surface="dark"
          className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-brand-deep lg:flex"
        >
          <div className="flex h-16 shrink-0 items-center px-5">{brand}</div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
            <NavList groups={navigation} variant="sidebar" />
          </nav>
          {sidebarFooter ? (
            <div className="border-t border-nav-border p-4 text-sm text-nav-text">
              {sidebarFooter}
            </div>
          ) : null}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {banner}
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden">
              <MobileNav groups={navigation} brand={brand} footer={sidebarFooter} />
            </div>
            <div className="min-w-0 flex-1 truncate text-sm text-ink-secondary">{context}</div>
            <div className="flex items-center gap-1">
              {notifications}
              {userMenu}
            </div>
          </header>

          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
          >
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
