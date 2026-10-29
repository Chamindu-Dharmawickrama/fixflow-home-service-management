import { TRUST } from "../content/site-content";
import { CONTENT_ICONS } from "./content-icons";
import { Section, SectionHeading } from "./section";

/** What the way of working gives a customer, limited to things the product really does. */
export function TrustPoints() {
  return (
    <Section tone="page" headingId="trust-heading">
      <SectionHeading id="trust-heading" title={TRUST.title} description={TRUST.intro} />
      <ul className="grid gap-8 lg:grid-cols-3">
        {TRUST.points.map((point) => {
          const Icon = CONTENT_ICONS[point.icon];
          return (
            <li key={point.id} className="flex flex-col gap-3 border-t-4 border-accent-fill pt-6">
              <span className="flex size-11 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon aria-hidden="true" className="size-6" />
              </span>
              <h3 className="font-display text-xl font-semibold text-ink">{point.title}</h3>
              <p className="text-pretty text-base text-ink-secondary">{point.description}</p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
