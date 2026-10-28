import { Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MoneyText } from "@/components/ui/money-text";
import { PageHeader } from "@/components/ui/page-header";

import { CURRENCY_CODE } from "../../../_lib/fixtures";
import { requireStyleguide } from "../../../_lib/guard";
import { EXAMPLE_SERVICES, formatDuration } from "../../../_lib/public-content";
import { PUBLIC_EXAMPLE_HOME } from "../../../_lib/shell-nav";

export const metadata: Metadata = { title: { absolute: "Services · CoolBreeze Home Services" } };

export default function PublicServicesExample() {
  requireStyleguide();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <PageHeader
        title="Our services"
        description="Every job starts with a written quotation. Where we can show a starting price, we do; everything else is quoted after you tell us what is wrong."
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {EXAMPLE_SERVICES.map((service) => (
          <li key={service.slug}>
            <Card className="relative flex h-full flex-col transition-colors duration-150 ease-standard hover:border-border-strong">
              <CardHeader>
                <Badge tone="neutral" className="self-start">
                  {service.category}
                </Badge>
                <CardTitle as="h2" className="mt-2">
                  <Link
                    href={`${PUBLIC_EXAMPLE_HOME}/services/${service.slug}`}
                    className="rounded-sm after:absolute after:inset-0 after:rounded-xl"
                  >
                    {service.name}
                  </Link>
                </CardTitle>
                <CardDescription>{service.short}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto flex items-center gap-1.5 text-sm text-ink-secondary">
                <Clock aria-hidden="true" className="size-4 text-ink-muted" />
                {formatDuration(service.durationMinutes)}
              </CardContent>
              <CardFooter className="text-sm font-semibold text-ink">
                {service.startingPrice ? (
                  <>
                    From <MoneyText amount={service.startingPrice} currencyCode={CURRENCY_CODE} />
                  </>
                ) : (
                  "Request a quote"
                )}
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
