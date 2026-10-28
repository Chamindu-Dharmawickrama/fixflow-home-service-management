import type { Metadata } from "next";

import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/logo";
import type { SearchParamsInput } from "@/lib/url";

import { requireStyleguide } from "./_lib/guard";
import { Specimen } from "./_lib/section";
import { Section } from "./_lib/section";
import { ControlsSection } from "./_sections/controls";
import { DataDisplaySection } from "./_sections/data-display";
import { FormDemo } from "./_sections/form-demo";
import { FoundationsSection } from "./_sections/foundations";
import { OverlaysSection } from "./_sections/overlays";
import { PatternsSection } from "./_sections/patterns";
import { ShellLinksSection } from "./_sections/shell-links";
import { StatesSection } from "./_sections/states";
import { StatusSection } from "./_sections/status";

export const metadata: Metadata = { title: "Styleguide" };

const CONTENTS = [
  ["colour", "Colour"],
  ["typography", "Typography"],
  ["spacing", "Spacing"],
  ["brand", "Logo and icons"],
  ["buttons", "Buttons"],
  ["form-controls", "Form controls"],
  ["form-validation", "Form validation"],
  ["status", "Status badges"],
  ["data-display", "Data display"],
  ["patterns", "Patterns"],
  ["overlays", "Overlays"],
  ["states", "States"],
  ["shells", "Shells"],
] as const;

export default function StyleguidePage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  requireStyleguide();

  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <Logo />
            <Badge tone="attention">Development only</Badge>
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              FixFlow styleguide
            </h1>
            <p className="max-w-3xl text-base text-ink-secondary">
              Every component, variant and state of the design system, with realistic content from
              the fictional CoolBreeze Home Services. This page returns 404 in a production build.
              The reference is <span className="font-medium text-ink">docs/DESIGN_SYSTEM.md</span>.
            </p>
          </div>
          <nav aria-label="Styleguide contents">
            <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {CONTENTS.map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="rounded-sm font-medium text-brand underline-offset-4 hover:underline"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto flex max-w-7xl flex-col gap-16 px-4 py-10 outline-none sm:px-6 lg:px-8"
      >
        <FoundationsSection />
        <ControlsSection />

        <Section
          id="form-validation"
          title="Form validation"
          description="Errors appear beside the field and in a summary that takes focus when a submit fails; what the person typed is kept. The button shows progress and ignores a second click."
        >
          <Specimen title="Request a service (React Hook Form + Zod)" className="max-w-2xl">
            <FormDemo />
          </Specimen>
        </Section>

        <StatusSection />
        <DataDisplaySection />
        <PatternsSection searchParams={searchParams} />
        <OverlaysSection />
        <StatesSection />
        <ShellLinksSection />
      </main>
    </>
  );
}
