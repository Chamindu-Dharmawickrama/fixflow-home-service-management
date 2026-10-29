import Link from "next/link";
import type { ReactNode } from "react";

import { PublicNav, type PublicNavProps } from "@/components/layout/public-nav";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Logo, LogoMark } from "@/components/ui/logo";
import { NAVIGATION } from "@/config/navigation";
import type { NavItem } from "@/lib/navigation";

export interface PublicLayoutProps {
  /**
   * The business identity in the header: the configured business name and logo (D-31). Defaults to
   * the FixFlow logo until the business settings supply one.
   */
  identity?: ReactNode;
  /** Where the identity links to, normally `/`. Without it the identity is not a link. */
  homeHref?: string | undefined;
  /** Defaults to the public entries in `config/navigation.ts`. */
  navItems?: readonly NavItem[] | undefined;
  /** The width from which the links are a row in the header (see `PublicNav`). */
  navInlineFrom?: PublicNavProps["inlineFrom"];
  /**
   * The session-aware account link ("Sign in", "My account", "Dashboard"). It stays in the header at
   * every width, phones included, so a signed-in customer can always find their way back (F-28).
   */
  account?: ReactNode;
  /** The primary call to action ("Request service"). Shown in the header from `sm`, and in the mobile menu. */
  cta?: ReactNode;
  /** A slim banner above the header (the portfolio-demo notice, D-31). */
  banner?: ReactNode;
  /** Business contact details, opening hours and links for the footer. */
  footer?: ReactNode;
  /** The demo notice shown at the foot of the page: "FixFlow portfolio demo — fictional business and data." */
  demoNotice?: ReactNode;
  children: ReactNode;
}

/**
 * The frame of every public page: business identity, navigation, the primary call to action and a
 * footer that credits FixFlow. Pages inside bring their own sections and widths, because marketing
 * pages need full-bleed bands that an admin-style content column would not allow.
 *
 * The header's items are ordered explicitly (`order-*`) because `PublicNav` contributes its links
 * and its menu button as separate items, so the visual order matches the tab order: identity, links,
 * menu button (below the link breakpoint), account link, call to action.
 */
export function PublicLayout({
  identity,
  homeHref,
  navItems = NAVIGATION.public,
  navInlineFrom,
  account,
  cta,
  banner,
  footer,
  demoNotice,
  children,
}: PublicLayoutProps) {
  const brand = identity ?? <Logo />;

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      {banner}
      <header className="relative z-30 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8">
          <div className="order-1 mr-auto min-w-0">
            {homeHref ? (
              <Link href={homeHref} className="inline-flex max-w-full rounded-lg">
                {brand}
              </Link>
            ) : (
              brand
            )}
          </div>
          <PublicNav
            items={navItems}
            cta={cta}
            {...(navInlineFrom === undefined ? {} : { inlineFrom: navInlineFrom })}
          />
          {account ? <div className="order-4 shrink-0">{account}</div> : null}
          {/* The mobile menu holds the call to action; with no menu to put it in, the header keeps it. */}
          {cta ? (
            <div className={navItems.length > 0 ? "order-5 hidden sm:block" : "order-5"}>{cta}</div>
          ) : null}
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>

      <footer data-surface="dark" className="bg-brand-deep text-nav-text">
        {footer ? (
          <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">{footer}</div>
        ) : null}
        <div className="border-t border-nav-border">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <p className="flex items-center gap-2">
              <LogoMark variant="dark" className="size-5" />
              <span>
                Powered by <span className="font-medium text-surface">FixFlow</span>
              </span>
            </p>
            {demoNotice ? <div className="text-nav-muted">{demoNotice}</div> : null}
          </div>
        </div>
      </footer>
    </div>
  );
}
