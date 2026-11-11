import {
  ATTENTION_TYPE_LABELS,
  type AttentionItemDto,
  type DashboardAttentionDto,
} from "@fixflow/shared";
import { CircleCheck } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/ui/money-text";

import { ATTENTION_TONES } from "../lib/dashboard";

function Item({ item }: { item: AttentionItemDto }) {
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={ATTENTION_TONES[item.type]}>{ATTENTION_TYPE_LABELS[item.type]}</Badge>
          <span className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">
            {item.title}
          </span>
        </div>
        <p className="min-w-0 text-sm text-ink-secondary [overflow-wrap:anywhere]">
          {item.context}
          {item.amount === null ? null : (
            <>
              {" "}
              ·{" "}
              <MoneyText
                amount={item.amount.amount}
                currencyCode={item.amount.currencyCode}
                className="font-medium text-ink"
              />{" "}
              due
            </>
          )}
        </p>
      </div>
      <Link
        href={item.link}
        aria-label={`${item.actionLabel}: ${item.title}`}
        className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
      >
        {item.actionLabel}
      </Link>
    </li>
  );
}

/**
 * "Needs attention" (FR-081, spec §10.1): what the business should do now, most urgent first, each
 * with how long it has waited and a direct link to the page where it is done. The queue holds the
 * fifteen most urgent; when there are more it says how many are not shown. Nothing needing attention
 * is a good state and is worded as one.
 */
export function AttentionQueue({ attention }: { attention: DashboardAttentionDto }) {
  const { items, totalItems } = attention;

  return (
    <Card aria-labelledby="attention-heading" role="region" data-testid="needs-attention">
      <CardHeader>
        <CardTitle as="h2" id="attention-heading">
          Needs attention
        </CardTitle>
        <CardDescription>
          {totalItems === 0
            ? "Nothing is waiting on you right now."
            : totalItems === items.length
              ? `${totalItems} ${totalItems === 1 ? "thing needs" : "things need"} you, most urgent first.`
              : `The ${items.length} most urgent of ${totalItems} things that need you.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-ink-secondary">
            <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
            You&apos;re all caught up. New requests, accepted quotations, jobs to schedule and
            overdue invoices show up here as soon as they need you.
          </p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Things that need attention">
            {items.map((item) => (
              <Item key={item.id} item={item} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
