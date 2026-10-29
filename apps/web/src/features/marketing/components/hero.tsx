import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";

import { HERO } from "../content/site-content";
import { CONTENT_ICONS } from "./content-icons";
import { HeroExample } from "./hero-example";
import { RequestServiceLink } from "./request-service-link";

/** The homepage's first screen: what the business offers, the two next steps, and what the account looks like. */
export function Hero() {
  const Shield = CONTENT_ICONS["shield-check"];

  return (
    <section aria-labelledby="hero-heading" className="border-b border-border bg-surface">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-14 lg:px-8 lg:py-20">
        <div className="flex flex-col items-start gap-6">
          <h1
            id="hero-heading"
            className="font-display text-3xl font-semibold text-balance text-ink sm:text-4xl lg:text-5xl"
          >
            {HERO.headline}
          </h1>
          <p className="max-w-xl text-pretty text-lg text-ink-secondary">{HERO.lead}</p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <RequestServiceLink size="lg">{HERO.primaryCta}</RequestServiceLink>
            <Link href="/services" className={buttonVariants({ variant: "outline", size: "lg" })}>
              {HERO.secondaryCta}
            </Link>
          </div>
          <div className="flex flex-col gap-1.5 text-sm text-ink-secondary">
            <p className="flex items-center gap-2 font-medium text-ink">
              <Shield aria-hidden="true" className="size-5 shrink-0 text-accent" />
              {HERO.assurance}
            </p>
            <p className="pl-7">{HERO.accountHint}</p>
          </div>
        </div>
        <HeroExample />
      </div>
    </section>
  );
}
