import { HOW_IT_WORKS } from "../content/site-content";
import { CONTENT_ICONS } from "./content-icons";
import { Section, SectionHeading } from "./section";

/** The four stages of the real workflow, described as it works (request, quotation, visit, invoice). */
export function HowItWorks() {
  return (
    <Section id="how-it-works" tone="surface" headingId="how-it-works-heading">
      <SectionHeading
        id="how-it-works-heading"
        title={HOW_IT_WORKS.title}
        description={HOW_IT_WORKS.intro}
      />
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {HOW_IT_WORKS.steps.map((step, index) => {
          const Icon = CONTENT_ICONS[step.icon];
          return (
            <li
              key={step.id}
              className="relative flex flex-col gap-4 rounded-xl border border-border bg-page p-6"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <Icon aria-hidden="true" className="size-6" />
                </span>
                <span
                  aria-hidden="true"
                  className="font-display text-4xl font-semibold text-border-strong/60 tabular-nums"
                >
                  {index + 1}
                </span>
              </div>
              <h3 className="font-display text-xl font-semibold text-ink">
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </h3>
              <p className="text-pretty text-base text-ink-secondary">{step.description}</p>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
