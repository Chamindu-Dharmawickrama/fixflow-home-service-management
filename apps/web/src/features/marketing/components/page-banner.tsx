import type { ReactNode } from "react";

import { type BreadcrumbItem, Breadcrumbs } from "@/components/ui/breadcrumbs";

export interface PageBannerProps {
  /** The page's single `h1`. */
  title: string;
  headingId: string;
  intro?: ReactNode;
  breadcrumbs?: readonly BreadcrumbItem[];
  /** Shown beside the title: a category badge, for example. */
  eyebrow?: ReactNode;
}

/** The top band of an inner public page: breadcrumbs, the `h1` and a one-sentence introduction. */
export function PageBanner({ title, headingId, intro, breadcrumbs, eyebrow }: PageBannerProps) {
  return (
    <section aria-labelledby={headingId} className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
        {eyebrow ? <div>{eyebrow}</div> : null}
        <h1
          id={headingId}
          className="max-w-3xl font-display text-3xl font-semibold text-balance text-ink sm:text-4xl"
        >
          {title}
        </h1>
        {intro ? <p className="max-w-2xl text-pretty text-lg text-ink-secondary">{intro}</p> : null}
      </div>
    </section>
  );
}
