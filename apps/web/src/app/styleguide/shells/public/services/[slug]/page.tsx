import { Check, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/ui/money-text";
import { PageHeader } from "@/components/ui/page-header";
import { DetailSkeleton } from "@/components/ui/skeleton";

import { CURRENCY_CODE } from "../../../../_lib/fixtures";
import { requireStyleguide } from "../../../../_lib/guard";
import {
  EXAMPLE_SERVICES,
  findExampleService,
  formatDuration,
} from "../../../../_lib/public-content";
import { PUBLIC_EXAMPLE_HOME } from "../../../../_lib/shell-nav";

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return EXAMPLE_SERVICES.map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const service = findExampleService(slug);
  return { title: { absolute: `${service?.name ?? "Service"} · CoolBreeze Home Services` } };
}

async function ServiceDetail({ params }: { params: Params }) {
  const service = findExampleService((await params).slug);
  if (!service) {
    notFound();
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Services", href: `${PUBLIC_EXAMPLE_HOME}/services` },
          { label: service.name },
        ]}
        title={service.name}
        description={service.short}
        meta={<Badge tone="neutral">{service.category}</Badge>}
      />

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-8 lg:col-span-2">
          <section aria-labelledby="overview-heading" className="flex flex-col gap-3">
            <h2 id="overview-heading" className="font-display text-2xl font-semibold text-ink">
              What this covers
            </h2>
            <p className="text-base text-ink-secondary">{service.description}</p>
          </section>
          <section aria-labelledby="inclusions-heading" className="flex flex-col gap-3">
            <h2 id="inclusions-heading" className="font-display text-2xl font-semibold text-ink">
              What&apos;s included
            </h2>
            <ul className="flex flex-col gap-2">
              {service.inclusions.map((item) => (
                <li key={item} className="flex items-start gap-3 text-base text-ink">
                  <Check
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-accent"
                    strokeWidth={3}
                  />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle as="h2">
              {service.startingPrice ? (
                <>
                  From <MoneyText amount={service.startingPrice} currencyCode={CURRENCY_CODE} />
                </>
              ) : (
                "Request a quote"
              )}
            </CardTitle>
            <CardDescription>
              {service.startingPrice
                ? "A written quotation confirms the final price before any work starts."
                : "Tell us what is wrong and we will send a written quotation."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="flex items-center gap-2 text-sm text-ink-secondary">
              <Clock aria-hidden="true" className="size-4 text-ink-muted" />
              {formatDuration(service.durationMinutes)} on site
            </p>
            <Button size="lg" asChild>
              <Link href={`${PUBLIC_EXAMPLE_HOME}/services`}>Back to all services</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function PublicServiceExample({ params }: { params: Params }) {
  requireStyleguide();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <Suspense fallback={<DetailSkeleton label="Loading service" />}>
        <ServiceDetail params={params} />
      </Suspense>
    </div>
  );
}
