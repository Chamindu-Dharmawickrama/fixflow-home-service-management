import { ChevronDown } from "lucide-react";

import { isDemoMode } from "@/lib/demo-mode";

import { FAQ, faqEntriesFor } from "../content/site-content";
import { Section } from "./section";

/**
 * Frequently asked questions, answered from how the workflow and the policies really work. Native
 * `<details>` elements: keyboard and screen-reader support come with the browser, and it needs no
 * client JavaScript.
 */
export function Faq() {
  const entries = faqEntriesFor(isDemoMode());

  return (
    <Section id="faq" tone="page" headingId="faq-heading">
      <div className="grid gap-8 lg:grid-cols-[1fr_2fr] lg:gap-14">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <h2
            id="faq-heading"
            className="font-display text-3xl font-semibold text-balance text-ink"
          >
            {FAQ.title}
          </h2>
          <p className="mt-2 text-pretty text-lg text-ink-secondary">{FAQ.intro}</p>
        </div>
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <details
              key={entry.id}
              className="group rounded-xl border border-border bg-surface shadow-sm"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl p-5 text-left text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {entry.question}
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 shrink-0 text-ink-secondary transition-transform duration-150 ease-standard group-open:rotate-180"
                />
              </summary>
              <div className="flex flex-col gap-3 px-5 pb-5 text-base text-ink-secondary">
                {entry.answer.map((paragraph) => (
                  <p key={paragraph} className="text-pretty">
                    {paragraph}
                  </p>
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
