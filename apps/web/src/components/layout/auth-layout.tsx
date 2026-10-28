import Link from "next/link";
import type { ReactNode } from "react";

import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";

export interface AuthLayoutProps {
  /** The page's `h1`: "Sign in", "Create your account". */
  title: string;
  description?: ReactNode;
  /** Where the logo links to (the public home page). Without it the logo is not a link. */
  homeHref?: string | undefined;
  /** A slim banner above everything (the portfolio-demo notice, D-31). */
  banner?: ReactNode;
  /** Links under the form card: "New here? Create an account". */
  footer?: ReactNode;
  /** The form. It is wrapped in a card. */
  children: ReactNode;
}

const POINTS = [
  "Request a service and follow it from first message to final invoice.",
  "Review a quotation and accept or decline it online.",
  "See appointments and recorded payments in one place.",
];

/**
 * The frame for sign-in, registration and password reset: a centred form card, with a brand panel
 * beside it from `lg` up. It is product chrome, so it carries FixFlow branding (D-31).
 */
export function AuthLayout({
  title,
  description,
  homeHref,
  banner,
  footer,
  children,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-page">
      {banner}
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-2">
        <aside
          data-surface="dark"
          className="hidden flex-col justify-between bg-linear-to-br from-brand-deep to-brand p-12 text-surface lg:flex"
        >
          <Logo variant="dark" />
          <div className="flex max-w-md flex-col gap-6">
            <p className="font-display text-4xl font-semibold">
              Every request, quotation, job and invoice in one calm place.
            </p>
            <ul className="flex flex-col gap-3 text-base text-nav-text">
              {POINTS.map((point) => (
                <li key={point} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-accent-fill"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-nav-muted">FixFlow is a portfolio project.</p>
        </aside>

        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex flex-1 flex-col items-center justify-center px-4 py-10 outline-none sm:px-6"
        >
          <div className="flex w-full max-w-md flex-col gap-6">
            <div className="lg:hidden">
              {homeHref ? (
                <Link href={homeHref} className="inline-flex rounded-lg">
                  <Logo />
                </Link>
              ) : (
                <Logo />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-3xl font-semibold text-ink">{title}</h1>
              {description ? <p className="text-base text-ink-secondary">{description}</p> : null}
            </div>
            <Card className="p-5 sm:p-6">{children}</Card>
            {footer ? <div className="text-center text-sm text-ink-secondary">{footer}</div> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
