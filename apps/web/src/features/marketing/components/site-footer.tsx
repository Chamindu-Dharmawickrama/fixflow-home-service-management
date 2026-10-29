import Link from "next/link";

import { getSiteSettings } from "../lib/public-data";
import { ContactDetails } from "./contact-details";

const FOOTER_LINKS = [
  { label: "Services", href: "/services" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Contact", href: "/#contact" },
  { label: "Privacy and demo notice", href: "/privacy" },
] as const;

function FooterLinks() {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-surface">Explore</p>
      <ul className="flex flex-col gap-2 text-sm">
        {FOOTER_LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="rounded-sm text-nav-text underline-offset-4 hover:text-surface hover:underline"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The business's name, contact details and service area (from settings), and the site's links. */
export async function SiteFooter() {
  const settings = await getSiteSettings();

  if (settings.status !== "ok") {
    return (
      <div className="grid gap-8 md:grid-cols-2">
        <p className="max-w-md text-sm text-nav-text">
          Our contact details can&apos;t be loaded right now.{" "}
          {/* A plain link: following it reloads the page, which asks the API again. */}
          <a href="" className="rounded-sm font-medium text-surface underline underline-offset-4">
            Reload the page
          </a>{" "}
          to try again.
        </p>
        <FooterLinks />
      </div>
    );
  }

  const { businessName, tagline, serviceAreaDescription } = settings.data;
  return (
    <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr]">
      <div className="flex flex-col gap-4">
        <div>
          <p className="font-display text-xl font-semibold text-surface">{businessName}</p>
          {tagline ? <p className="mt-1 max-w-sm text-sm text-nav-text">{tagline}</p> : null}
        </div>
        {serviceAreaDescription ? (
          <div>
            <p className="mb-1 text-sm font-semibold text-surface">Where we work</p>
            <p className="max-w-sm text-sm text-nav-text">{serviceAreaDescription}</p>
          </div>
        ) : null}
      </div>
      <div>
        <p className="mb-3 text-sm font-semibold text-surface">Contact</p>
        <ContactDetails settings={settings.data} onDark className="text-sm text-nav-text" />
      </div>
      <FooterLinks />
    </div>
  );
}

export function SiteFooterFallback() {
  return (
    <div aria-hidden="true" className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr]">
      {[0, 1, 2].map((column) => (
        <div key={column} className="flex flex-col gap-3">
          <span className="h-5 w-40 rounded bg-nav-hover motion-safe:animate-pulse" />
          <span className="h-4 w-56 rounded bg-nav-hover motion-safe:animate-pulse" />
          <span className="h-4 w-48 rounded bg-nav-hover motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
