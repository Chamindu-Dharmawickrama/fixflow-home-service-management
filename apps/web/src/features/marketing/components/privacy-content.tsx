import { TriangleAlert } from "lucide-react";

import { isDemoMode } from "@/lib/demo-mode";
import { cn } from "@/lib/utils";

import { buildPrivacySections } from "../content/site-content";
import { getSiteSettings } from "../lib/public-data";

/** What the notice calls the business when the settings could not be loaded. */
const GENERIC_BUSINESS_NAME = "The business on this website";

/**
 * The sections of the privacy and demo notice. The wording is static; only the business name and
 * contact email come from the settings, and the notice still reads correctly without them.
 */
export async function PrivacyContent() {
  const settings = await getSiteSettings();
  const sections = buildPrivacySections({
    demoMode: isDemoMode(),
    businessName: settings.status === "ok" ? settings.data.businessName : GENERIC_BUSINESS_NAME,
    contactEmail: settings.status === "ok" ? settings.data.contactEmail : undefined,
  });

  return (
    <div className="bg-page">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8 lg:py-16 [&>*]:max-w-3xl">
        {sections.map((section) => {
          const warning = section.id === "demo";
          const headingId = `privacy-${section.id}`;
          return (
            <section
              key={section.id}
              aria-labelledby={headingId}
              className={cn(
                "flex flex-col gap-3",
                warning && "rounded-xl border border-attention-edge bg-attention-soft p-6",
              )}
            >
              <h2
                id={headingId}
                className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"
              >
                {warning ? (
                  <TriangleAlert aria-hidden="true" className="size-6 shrink-0 text-attention" />
                ) : null}
                {section.title}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-pretty text-base text-ink-secondary">
                  {paragraph}
                </p>
              ))}
              {section.items ? (
                <ul className="flex list-disc flex-col gap-2 pl-6 text-base text-ink-secondary marker:text-accent">
                  {section.items.map((item) => (
                    <li key={item} className="text-pretty pl-1">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function PrivacyContentSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex max-w-3xl flex-col gap-4">
        <span className="h-7 w-64 rounded bg-surface-muted motion-safe:animate-pulse" />
        <span className="h-4 w-full rounded bg-surface-muted motion-safe:animate-pulse" />
        <span className="h-4 w-5/6 rounded bg-surface-muted motion-safe:animate-pulse" />
        <span className="h-4 w-2/3 rounded bg-surface-muted motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
