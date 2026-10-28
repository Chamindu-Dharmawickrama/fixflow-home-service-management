import { ArrowRight, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/ui/money-text";
import { StatusBadge } from "@/components/ui/status-badge";

import { CURRENCY_CODE } from "../../_lib/fixtures";
import { requireStyleguide } from "../../_lib/guard";
import { EXAMPLE_SERVICES, PROCESS_STEPS, PROMISES } from "../../_lib/public-content";
import { PUBLIC_EXAMPLE_HOME } from "../../_lib/shell-nav";

// Public business pages use an absolute title naming the business, not "· FixFlow" (D-31).
export const metadata: Metadata = {
  title: { absolute: "Home comfort and repairs · CoolBreeze Home Services" },
};

export default function PublicHomeExample() {
  requireStyleguide();

  return (
    <>
      <section aria-labelledby="hero-heading" className="bg-surface">
        <div className="mx-auto grid w-full max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-20">
          <div className="flex flex-col gap-6">
            <Badge tone="brand" className="self-start">
              Air conditioning · Appliances · Electrical · Cleaning
            </Badge>
            <h1
              id="hero-heading"
              className="font-display text-4xl font-semibold text-ink sm:text-5xl"
            >
              Home repairs and servicing, done properly the first time.
            </h1>
            <p className="max-w-xl text-lg text-ink-secondary">
              Tell us what is wrong, get a written quotation, and follow the job from first message
              to final invoice, all in one place.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href={`${PUBLIC_EXAMPLE_HOME}/services`}>
                  Browse services
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href={`${PUBLIC_EXAMPLE_HOME}/how-it-works`}>See how it works</Link>
              </Button>
            </div>
            <p className="flex items-center gap-2 text-sm text-ink-secondary">
              <ShieldCheck aria-hidden="true" className="size-5 text-accent" />
              Quotation first. Nothing starts until you say yes.
            </p>
          </div>

          <Card className="bg-page">
            <CardHeader>
              <CardTitle as="h2">Follow every step</CardTitle>
              <CardDescription>
                What you will see in your account, from request to payment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col divide-y divide-border">
                {(
                  [
                    ["Your request", <StatusBadge key="r" kind="request" status="SUBMITTED" />],
                    ["Your quotation", <StatusBadge key="q" kind="quotation" status="SENT" />],
                    [
                      "Your appointment",
                      <StatusBadge key="w" kind="workOrder" status="SCHEDULED" />,
                    ],
                    ["Your invoice", <StatusBadge key="i" kind="invoice" status="PAID" />],
                  ] as const
                ).map(([label, badge]) => (
                  <li key={label} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span className="font-medium text-ink">{label}</span>
                    {badge}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </section>

      <section
        aria-labelledby="services-heading"
        className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <h2 id="services-heading" className="font-display text-3xl font-semibold text-ink">
              What we can help with
            </h2>
            <p className="max-w-2xl text-pretty text-base text-ink-secondary">
              Straightforward home services, priced openly. Where we can show a starting price, we
              do.
            </p>
          </div>
          <Button variant="link" asChild>
            <Link href={`${PUBLIC_EXAMPLE_HOME}/services`}>
              All services
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {EXAMPLE_SERVICES.slice(0, 3).map((service) => (
            <li key={service.slug}>
              <Card className="relative h-full transition-colors duration-150 ease-standard hover:border-border-strong">
                <CardHeader>
                  <Badge tone="neutral" className="self-start">
                    {service.category}
                  </Badge>
                  <CardTitle as="h3" className="mt-2">
                    <Link
                      href={`${PUBLIC_EXAMPLE_HOME}/services/${service.slug}`}
                      className="rounded-sm after:absolute after:inset-0 after:rounded-xl"
                    >
                      {service.name}
                    </Link>
                  </CardTitle>
                  <CardDescription>{service.short}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm font-medium text-ink">
                  {service.startingPrice ? (
                    <>
                      From <MoneyText amount={service.startingPrice} currencyCode={CURRENCY_CODE} />
                    </>
                  ) : (
                    "Request a quote"
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-heading" className="bg-surface">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <h2 id="how-heading" className="font-display text-3xl font-semibold text-ink">
            How it works
          </h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PROCESS_STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <step.icon aria-hidden="true" className="size-5" />
                </span>
                <h3 className="text-lg font-semibold text-ink">
                  <span className="text-ink-muted tabular-nums">{index + 1}. </span>
                  {step.title}
                </h3>
                <p className="text-sm text-ink-secondary">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        aria-labelledby="promises-heading"
        className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16"
      >
        <h2 id="promises-heading" className="font-display text-3xl font-semibold text-ink">
          What you can expect
        </h2>
        <ul className="mt-8 grid gap-6 md:grid-cols-3">
          {PROMISES.map((promise) => (
            <li
              key={promise.title}
              className="flex flex-col gap-2 border-l-4 border-accent-fill pl-4"
            >
              <h3 className="text-lg font-semibold text-ink">{promise.title}</h3>
              <p className="text-sm text-ink-secondary">{promise.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cta-heading" className="bg-brand text-surface" data-surface="dark">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-6 px-4 py-12 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex flex-col gap-2">
            <h2 id="cta-heading" className="font-display text-3xl font-semibold">
              Ready when you are
            </h2>
            <p className="max-w-xl text-base text-nav-text">
              Pick a service and tell us what is wrong. We will come back with a written quotation.
            </p>
          </div>
          <Button size="lg" className="bg-accent-fill text-ink hover:bg-surface" asChild>
            <Link href={`${PUBLIC_EXAMPLE_HOME}/services`}>Browse services</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
