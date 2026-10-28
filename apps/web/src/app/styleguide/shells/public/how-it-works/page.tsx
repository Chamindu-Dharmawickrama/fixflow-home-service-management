import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";

import { requireStyleguide } from "../../../_lib/guard";
import { PROCESS_STEPS } from "../../../_lib/public-content";

export const metadata: Metadata = {
  title: { absolute: "How it works · CoolBreeze Home Services" },
};

export default function PublicHowItWorksExample() {
  requireStyleguide();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 lg:py-14">
      <PageHeader
        title="How it works"
        description="From the first message to the final invoice, you always know what is happening and what comes next."
      />
      <ol className="flex flex-col gap-6">
        {PROCESS_STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <step.icon aria-hidden="true" className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-ink">
                <span className="text-ink-muted tabular-nums">{index + 1}. </span>
                {step.title}
              </h2>
              <p className="text-base text-ink-secondary">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
