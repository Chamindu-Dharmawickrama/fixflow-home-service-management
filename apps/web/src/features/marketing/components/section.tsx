import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SectionTone = "page" | "surface" | "brand";

const TONES: Record<SectionTone, string> = {
  page: "bg-page",
  surface: "bg-surface",
  brand: "bg-brand text-surface",
};

export interface SectionProps extends Omit<ComponentProps<"section">, "title"> {
  tone?: SectionTone;
  /** The heading's id; the section is labelled by it, so it is a named landmark for screen readers. */
  headingId: string;
}

/**
 * A full-width band of the marketing pages: the background runs edge to edge and the content sits
 * in the 7xl column used by the header and footer, with the same vertical rhythm on every band.
 */
export function Section({ tone = "page", headingId, className, children, ...props }: SectionProps) {
  return (
    <section
      aria-labelledby={headingId}
      className={cn("scroll-mt-20 border-b border-border", TONES[tone], className)}
      {...props}
    >
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">{children}</div>
    </section>
  );
}

export interface SectionHeadingProps {
  id: string;
  title: string;
  description?: ReactNode;
  /** A link or button aligned to the right of the heading from `sm`. */
  action?: ReactNode;
  /** The band is on the brand colour, so the text is light. */
  onBrand?: boolean;
  className?: string | undefined;
}

export function SectionHeading({
  id,
  title,
  description,
  action,
  onBrand,
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:mb-10",
        className,
      )}
    >
      <div className="max-w-2xl">
        <h2
          id={id}
          className={cn(
            "font-display text-3xl font-semibold text-balance",
            onBrand ? "text-surface" : "text-ink",
          )}
        >
          {title}
        </h2>
        {description ? (
          <p
            className={cn(
              "mt-2 text-pretty text-lg",
              onBrand ? "text-nav-text" : "text-ink-secondary",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
