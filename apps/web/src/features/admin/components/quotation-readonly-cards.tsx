import { type AdminQuotationDto, type QuotationLinkDto, QuotationStatus } from "@fixflow/shared";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActivityTimeline } from "@/features/activity/components/activity-timeline";
import { cn } from "@/lib/utils";

import { adminQuotationPath } from "../lib/quotations";

interface CardProps {
  quotation: AdminQuotationDto;
  timeZone: string;
}

const BANNER_TONES = {
  info: "border-border bg-surface-muted text-ink",
  success: "border-success-edge bg-success-soft text-success",
  danger: "border-danger-edge bg-danger-soft text-danger",
  neutral: "border-border bg-surface-muted text-ink",
} as const;

function Banner({
  tone,
  headline,
  children,
}: {
  tone: keyof typeof BANNER_TONES;
  headline: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      data-testid="quotation-banner"
      className={cn("flex flex-col gap-1 rounded-xl border p-4 print:hidden", BANNER_TONES[tone])}
    >
      <p className="text-base font-semibold">{headline}</p>
      {children === undefined ? null : <div className="text-sm">{children}</div>}
    </div>
  );
}

/**
 * Where a quotation that is no longer a draft stands, in a sentence (UX-QB-QUO): "Sent Mar 2, 2026 ·
 * valid until Mar 16, 2026", "Expired", "Voided: the reason". The reason is the team's own words and
 * is labelled as internal; nothing here is ever served to a customer.
 */
export function QuotationStatusBanner({ quotation, timeZone }: CardProps) {
  const validUntil = <DateTimeText value={quotation.validUntil} timeZone={timeZone} />;

  switch (quotation.status) {
    case QuotationStatus.SENT:
      return (
        <Banner
          tone="info"
          headline={
            <>
              Sent{" "}
              {quotation.sentAt === null ? null : (
                <DateTimeText value={quotation.sentAt} timeZone={timeZone} display="date" />
              )}{" "}
              · valid until {validUntil}
            </>
          }
        >
          {quotation.customer.name} can accept or decline it until the end of that day. It cannot be
          edited; replace it with a new draft to change the offer.
        </Banner>
      );
    case QuotationStatus.ACCEPTED:
      return (
        <Banner
          tone="success"
          headline={
            <>
              Accepted
              {quotation.respondedAt === null ? null : (
                <>
                  {" "}
                  <DateTimeText value={quotation.respondedAt} timeZone={timeZone} display="date" />
                </>
              )}
            </>
          }
        >
          {quotation.customer.name} accepted this quotation. A job can now be created from it.
        </Banner>
      );
    case QuotationStatus.DECLINED:
      return (
        <Banner
          tone="neutral"
          headline={
            <>
              Declined
              {quotation.respondedAt === null ? null : (
                <>
                  {" "}
                  <DateTimeText value={quotation.respondedAt} timeZone={timeZone} display="date" />
                </>
              )}
            </>
          }
        >
          {quotation.declineReason === null
            ? `${quotation.customer.name} declined this quotation without giving a reason.`
            : `${quotation.customer.name} declined it: “${quotation.declineReason}”`}
        </Banner>
      );
    case QuotationStatus.EXPIRED:
      return (
        <Banner tone="neutral" headline="Expired">
          Its last valid day, {validUntil}, passed before {quotation.customer.name} answered. The
          request is back under review: prepare a new quotation from it.
        </Banner>
      );
    case QuotationStatus.VOID:
      return (
        <Banner
          tone="danger"
          headline={
            <>
              Voided
              {quotation.voided === null ? null : (
                <>
                  {" "}
                  <DateTimeText value={quotation.voided.at} timeZone={timeZone} display="date" />
                </>
              )}
              {quotation.voided === null ? null : `: ${quotation.voided.reason}`}
            </>
          }
        >
          The reason is internal: only your team sees it. The customer can no longer accept this
          quotation.
        </Banner>
      );
    default:
      return null;
  }
}

function ChainLink({ label, link }: { label: string; link: QuotationLinkDto }) {
  return (
    <li className="relative flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <span className="text-ink-secondary">{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        <Link
          href={adminQuotationPath(link.id)}
          className="font-medium text-brand underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
        >
          {link.reference}
        </Link>
        <StatusBadge kind="quotation" status={link.status} />
      </span>
    </li>
  );
}

/** The offers either side of this one, so the history of an offer is never lost (BR-07). */
export function QuotationChainCard({ quotation }: Pick<CardProps, "quotation">) {
  if (quotation.replaces === null && quotation.replacedBy === null) {
    return null;
  }
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle as="h2">Replacement chain</CardTitle>
        <CardDescription>
          A sent quotation is never edited. A change is a new quotation, and the old one stays.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {quotation.replaces === null ? null : (
            <ChainLink label="Replaces" link={quotation.replaces} />
          )}
          {quotation.replacedBy === null ? null : (
            <ChainLink label="Replaced by" link={quotation.replacedBy} />
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Who did what and when, for the team. */
export function QuotationDetailsCard({ quotation, timeZone }: CardProps) {
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle as="h2">Details</CardTitle>
        <CardDescription>For your team. The customer does not see this card.</CardDescription>
      </CardHeader>
      <CardContent>
        <DescriptionList>
          <DescriptionItem term="Started by">
            {quotation.createdBy.name},{" "}
            <DateTimeText value={quotation.createdAt} timeZone={timeZone} />
          </DescriptionItem>
          {quotation.sentAt !== null && quotation.sentBy !== null ? (
            <DescriptionItem term="Sent by">
              {quotation.sentBy.name}, <DateTimeText value={quotation.sentAt} timeZone={timeZone} />
            </DescriptionItem>
          ) : null}
          {quotation.expiredAt !== null ? (
            <DescriptionItem term="Expired">
              <DateTimeText value={quotation.expiredAt} timeZone={timeZone} />
            </DescriptionItem>
          ) : null}
          {quotation.voided !== null ? (
            <DescriptionItem term="Voided by">
              {quotation.voided.by?.name ?? "The system"},{" "}
              <DateTimeText value={quotation.voided.at} timeZone={timeZone} />
              <span className="mt-1 block text-ink-secondary">
                Reason (internal):{" "}
                <span className="whitespace-pre-line">{quotation.voided.reason}</span>
              </span>
            </DescriptionItem>
          ) : null}
          <DescriptionItem term="Request">
            <Link
              href={`/app/requests/${encodeURIComponent(quotation.requestId)}`}
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              {quotation.requestReference}
            </Link>{" "}
            <StatusBadge kind="request" status={quotation.requestStatus} />
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
    </Card>
  );
}

/** Everything that happened to this quotation, oldest first, with what the customer was shown. */
export function QuotationHistoryCard({ quotation, timeZone }: CardProps) {
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle as="h2">History</CardTitle>
        <CardDescription>Everything that happened, oldest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActivityTimeline
          variant="admin"
          events={quotation.timeline}
          timeZone={timeZone}
          label="Quotation history"
          emptyMessage="Nothing has happened yet."
        />
      </CardContent>
    </Card>
  );
}
