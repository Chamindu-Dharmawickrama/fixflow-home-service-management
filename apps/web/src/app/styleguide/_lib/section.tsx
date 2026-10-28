import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A titled block of the styleguide with an anchor, so the contents list can link to it. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-20 flex-col gap-6">
      <div className="flex flex-col gap-1.5 border-b border-border pb-4">
        <h2 id={`${id}-heading`} className="font-display text-2xl font-semibold text-ink">
          {title}
        </h2>
        {description ? (
          <p className="max-w-3xl text-base text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** One labelled example inside a section. */
export function Specimen({
  title,
  children,
  className,
  surface = "light",
}: {
  title: string;
  children: ReactNode;
  className?: string;
  /** `dark` shows the example on the deep brand colour, for light-on-dark components. */
  surface?: "light" | "dark";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink-secondary">{title}</h3>
      <div
        data-surface={surface === "dark" ? "dark" : undefined}
        className={cn(
          "min-w-0 rounded-xl border border-border p-4 sm:p-5",
          surface === "dark" ? "bg-brand-deep text-surface" : "bg-surface",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
